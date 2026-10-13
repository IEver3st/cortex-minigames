// The optional library owns profile parsing, accent derivation and live settings transactions.
// Load its installed browser adapter only after Lua confirms its matching bridge is available.
import { isNui } from './bridge';

declare global {
  interface Window { CortexUI?: unknown; CortexLayout?: unknown }
}

const ASSETS = 'https://cfx-nui-cortex-lib/ui/';
const ASSET_TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 5;

export function startPresentation(): () => void {
  if (!isNui()) return () => {};
  let active = false;
  let stopped = false;
  let loading = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stylesheet: HTMLLinkElement | undefined;
  let statusRevision = 0;
  let initializationFailed = false;
  const requests = new Set<AbortController>();
  const sources = new Map<string, string>();
  const executed = new Set<string>();

  const current = (revision: number) => !stopped && active && revision === statusRevision;

  function reset() {
    if (stylesheet) stylesheet.disabled = true;
    const root = document.documentElement;
    for (const token of ['--cx-accent', '--cx-accent-rgb', '--cx-accent-deep', '--cx-surface-alpha', '--cx-panel', '--cx-safe']) {
      root.style.removeProperty(token);
    }
    root.classList.remove('cortex-shared-style', 'cortex-reduced-motion', 'cortex-modal-active', 'cortex-settings-active');
    delete root.dataset.cxMotion;
  }

  function asset(element: HTMLLinkElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(false), ASSET_TIMEOUT_MS);
      function finish(ok: boolean) {
        clearTimeout(timeout);
        element.onload = element.onerror = null;
        if (!ok) element.remove();
        if (ok) resolve(); else reject(new Error('Cortex presentation asset unavailable'));
      }
      element.onload = () => finish(true);
      element.onerror = () => finish(false);
      document.head.append(element);
    });
  }

  async function request<T>(url: string, options: RequestInit, read: (response: Response) => Promise<T>, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let aborted!: () => void;
    try {
      return await new Promise<T>((resolve, reject) => {
        // Reject locally as well as aborting transport. A late response from a host that ignores
        // cancellation must never resume a timed-out load or leave readiness pending forever.
        aborted = () => reject(new Error('Cortex presentation request cancelled'));
        controller.signal.addEventListener('abort', aborted, { once: true });
        void fetch(url, { ...options, signal: controller.signal }).then(response => {
          if (!response.ok) throw new Error('Cortex presentation request failed');
          return read(response);
        }).then(value => { if (!controller.signal.aborted) resolve(value); }, reject);
      });
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', aborted);
      requests.delete(controller);
    }
  }

  async function script(name: string, global: 'CortexLayout' | 'CortexUI', revision: number) {
    if (window[global]) return;
    let source = sources.get(name);
    if (source === undefined) {
      source = await request(`${ASSETS}${name}`, {}, response => response.text(), ASSET_TIMEOUT_MS);
      if (!current(revision)) return;
      sources.set(name, source);
    }
    if (!current(revision)) return;
    if (!executed.has(name)) {
      // Fetch text first, then synchronously execute the unchanged installed adapter once.
      // Removing an external <script src> after a timeout does not prevent its late execution.
      // Claim execution before append: even a partially failing adapter must not run twice.
      executed.add(name);
      const element = document.createElement('script');
      element.textContent = source;
      document.head.append(element);
    }
    if (!window[global]) {
      initializationFailed = true;
      throw new Error('Cortex presentation adapter did not initialize');
    }
  }

  async function loadAdapter() {
    if (loading || stopped || !active || initializationFailed) return;
    const revision = statusRevision;
    loading = true;
    try {
      if (!stylesheet?.isConnected) {
        stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = `${ASSETS}dynamic-ui.css`;
        await asset(stylesheet);
      }
      if (!current(revision)) return;
      stylesheet.disabled = false;
      await script('dynamic-layout.js', 'CortexLayout', revision);
      if (!current(revision)) return;
      await script('dynamic-ui.js', 'CortexUI', revision);
      if (!current(revision)) return;
      stylesheet.disabled = false;
      // No surfaces are registered: minigame placement and focus stay with its existing lifecycle.
    } catch {
      reset();
      if (current(revision) && !initializationFailed && ++attempts < MAX_ATTEMPTS) {
        timer = setTimeout(() => { void loadAdapter(); }, 1000);
      }
    } finally {
      loading = false;
      if (stopped || !active) reset();
      // A stop/start may arrive during an await. The new start could not load while this attempt
      // was busy; resume it now, instead of leaving its stylesheet disabled.
      else if (revision !== statusRevision) void loadAdapter();
    }
  }

  function availability(available: boolean) {
    active = available;
    clearTimeout(timer);
    attempts = 0;
    if (active) void loadAdapter();
    else {
      for (const controller of requests) controller.abort();
      reset();
    }
  }

  function message(event: MessageEvent) {
    if (event.data?.action !== 'cortex-minigames:presentationAvailability' || typeof event.data.available !== 'boolean') return;
    statusRevision++;
    availability(event.data.available);
  }

  async function ready() {
    const revision = statusRevision;
    try {
      const reply: unknown = await request(`https://${window.GetParentResourceName!()}/cortexMinigamesPresentation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: '{}',
      }, response => response.json(), 2000);
      if (stopped || revision !== statusRevision) return;
      if (!reply || typeof reply !== 'object' || !('available' in reply) || typeof reply.available !== 'boolean') throw new Error('not ready');
      availability(reply.available);
    } catch {
      if (!stopped && revision === statusRevision && ++attempts < MAX_ATTEMPTS) timer = setTimeout(() => { void ready(); }, 500);
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    for (const controller of requests) controller.abort();
    window.removeEventListener('message', message);
    window.removeEventListener('pagehide', stop);
    reset();
  }
  window.addEventListener('message', message);
  window.addEventListener('pagehide', stop, { once: true });
  void ready();
  return stop;
}
