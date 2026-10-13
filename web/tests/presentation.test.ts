import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { startPresentation } from '../src/core/presentation';

const g = globalThis as any;
const originals = { window: g.window, document: g.document, fetch: g.fetch, setTimeout: g.setTimeout, clearTimeout: g.clearTimeout };
let dom: Window;
let stop: () => void;
let clock = 0;
let seq = 0;
let available = false;
let loadAssets = true;
let posts: string[];
let assets: string[];
let timers: Map<number, { at: number; fn: () => void }>;
const layoutSource = 'window.layoutExecutions = (window.layoutExecutions || 0) + 1; window.CortexLayout = {};';
const uiSource = 'window.uiExecutions = (window.uiExecutions || 0) + 1; window.setInterval(() => {}, 5000); window.CortexUI = {};';

async function flush() { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); }
async function advance(ms: number) {
  const end = clock + ms;
  for (;;) {
    await flush();
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    clock = due[1].at;
    timers.delete(due[0]);
    due[1].fn();
  }
  clock = end;
  await flush();
}
function availability(value: boolean) {
  dom.dispatchEvent(new dom.MessageEvent('message', { data: { action: 'cortex-minigames:presentationAvailability', available: value } }));
}

beforeEach(() => {
  // Only the constant fixture adapters below execute; this host never loads arbitrary JS files.
  dom = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true,
    enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  (dom as any).GetParentResourceName = () => 'cortex-minigames';
  (dom as any).intervalStarts = 0;
  dom.setInterval = (() => { (dom as any).intervalStarts++; return 1; }) as any;
  clock = seq = 0;
  available = false;
  loadAssets = true;
  posts = [];
  assets = [];
  timers = new Map();
  const append = dom.document.head.append.bind(dom.document.head);
  dom.document.head.append = (...nodes: any[]) => {
    for (const node of nodes) {
      if (node.tagName === 'SCRIPT' && !node.src) { append(node); continue; }
      // happy-dom reports disabled resource loading as a synchronous error. Drive the load
      // event ourselves so the fixture models real asynchronous success, failure and timeouts.
      const onload = node.onload, onerror = node.onerror;
      node.onload = node.onerror = null;
      append(node);
      node.onload = onload;
      node.onerror = onerror;
      const url = node.src || node.href;
      assets.push(url);
      if (loadAssets) queueMicrotask(() => {
        node.dispatchEvent(new dom.Event('load'));
      });
    }
  };
  Object.assign(g, {
    window: dom, document: dom.document,
    setTimeout: (fn: () => void, ms = 0) => { const id = ++seq; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    fetch: async (url: string) => {
      if (url.startsWith('https://cfx-nui-cortex-lib/ui/')) {
        assets.push(url);
        return { ok: true, text: async () => url.endsWith('dynamic-layout.js') ? layoutSource : uiSource };
      }
      posts.push(url);
      return { ok: true, json: async () => ({ ok: true, available }) };
    },
  });
});
afterEach(async () => { stop?.(); Object.assign(g, originals); await dom.happyDOM.close(); });

test('standalone and old-library fallback request no cross-resource assets', async () => {
  stop = startPresentation();
  await flush();
  expect(posts).toEqual(['https://cortex-minigames/cortexMinigamesPresentation']);
  expect(assets).toEqual([]);
  expect(timers.size).toBe(0);
});

test('late startup loads canonical assets in order; restart never duplicates adapters', async () => {
  stop = startPresentation();
  await flush();
  availability(true);
  await flush();
  expect(assets).toEqual(['dynamic-ui.css', 'dynamic-layout.js', 'dynamic-ui.js'].map((name) => `https://cfx-nui-cortex-lib/ui/${name}`));
  const root = dom.document.documentElement;
  root.style.setProperty('--cx-accent', '#b9a8df');
  root.style.setProperty('--cx-accent-rgb', '185, 168, 223');
  root.classList.add('cortex-shared-style', 'cortex-reduced-motion');
  availability(false);
  expect(root.style.getPropertyValue('--cx-accent')).toBe('');
  expect(root.style.getPropertyValue('--cx-accent-rgb')).toBe('');
  expect(root.classList.contains('cortex-shared-style')).toBe(false);
  expect((dom.document.querySelector('link') as any).disabled).toBe(true);
  availability(true);
  await flush();
  expect(assets.length).toBe(3);
  expect((dom as any).uiExecutions).toBe(1);
  expect((dom as any).intervalStarts).toBe(1);
  expect((dom.document.querySelector('link') as any).disabled).toBe(false);
});

test('older readiness replies cannot override a newer dependency stop', async () => {
  let reply!: (value: unknown) => void;
  g.fetch = async () => ({ ok: true, json: () => new Promise((resolve) => { reply = resolve; }) });
  stop = startPresentation();
  await flush();
  availability(false);
  reply({ ok: true, available: true });
  await flush();
  expect(assets).toEqual([]);
});

test('a missing asset times out and retries only five times', async () => {
  available = true;
  loadAssets = false;
  stop = startPresentation();
  await advance(30_000);
  expect(assets.length).toBe(5);
  expect(dom.document.querySelectorAll('link, script').length).toBe(0);
  expect(timers.size).toBe(0);
  loadAssets = true;
  availability(true);
  await flush();
  expect((dom as any).CortexUI).toBeDefined();
});

test('dependency stop during an asset load cleans up when the load settles', async () => {
  available = true;
  loadAssets = false;
  stop = startPresentation();
  await flush();
  availability(false);
  await advance(10_000);
  expect(assets.length).toBe(1);
  expect(dom.document.querySelectorAll('link, script').length).toBe(0);
  expect(timers.size).toBe(0);
});

test('pagehide ends readiness retry and does not act on later status events', async () => {
  g.fetch = async () => { throw new Error('Lua callback not registered yet'); };
  stop = startPresentation();
  await flush();
  dom.dispatchEvent(new dom.Event('pagehide'));
  availability(true);
  await advance(10_000);
  expect(assets).toEqual([]);
  expect(timers.size).toBe(0);
});

test('quick stop/start during script fetch resumes once and reenables the stylesheet', async () => {
  available = true;
  const fetch = g.fetch;
  const arrivals: Array<(text: string) => void> = [];
  g.fetch = async (url: string, options: unknown) => url.endsWith('dynamic-ui.js')
    ? { ok: true, text: () => new Promise<string>(resolve => { arrivals.push(resolve); }) }
    : fetch(url, options);
  stop = startPresentation();
  await flush();
  expect(arrivals.length).toBe(1);
  availability(false);
  availability(true);
  await flush();
  expect(arrivals.length).toBe(2);
  arrivals[0]!(uiSource); // The old host response ignores abort and still arrives.
  arrivals[1]!(uiSource);
  await flush();
  expect((dom.document.querySelector('link') as any).disabled).toBe(false);
  expect((dom as any).layoutExecutions).toBe(1);
  expect((dom as any).uiExecutions).toBe(1);
  expect((dom as any).intervalStarts).toBe(1);
});

test('timed-out script text cannot execute late or duplicate the retry heartbeat', async () => {
  available = true;
  const fetch = g.fetch;
  let late!: (text: string) => void;
  let uiRequests = 0;
  g.fetch = async (url: string, options: unknown) => {
    if (url.endsWith('dynamic-ui.js') && ++uiRequests === 1) {
      return { ok: true, text: () => new Promise<string>(resolve => { late = resolve; }) };
    }
    return fetch(url, options);
  };
  stop = startPresentation();
  await advance(6000);
  expect(uiRequests).toBe(2);
  expect((dom as any).uiExecutions).toBe(1);
  late(uiSource);
  await flush();
  expect((dom as any).uiExecutions).toBe(1);
  expect((dom as any).intervalStarts).toBe(1);
  expect(dom.document.querySelectorAll('script[src]').length).toBe(0);
  expect(timers.size).toBe(0);
});

test('stopped script responses stay inert and a later library start recovers', async () => {
  available = true;
  const fetch = g.fetch;
  let late!: (text: string) => void;
  g.fetch = async (url: string, options: unknown) => url.endsWith('dynamic-ui.js')
    ? { ok: true, text: () => new Promise<string>(resolve => { late = resolve; }) }
    : fetch(url, options);
  stop = startPresentation();
  await flush();
  availability(false);
  late(uiSource);
  await flush();
  expect((dom as any).CortexUI).toBeUndefined();
  expect((dom as any).uiExecutions).toBeUndefined();
  expect((dom.document.querySelector('link') as any).disabled).toBe(true);
  expect(timers.size).toBe(0);
  g.fetch = fetch;
  availability(true);
  await flush();
  expect((dom as any).uiExecutions).toBe(1);
  expect((dom.document.querySelector('link') as any).disabled).toBe(false);
});

test('partially initialized canonical code is claimed once and fails closed', async () => {
  available = true;
  const fetch = g.fetch;
  g.fetch = async (url: string, options: unknown) => url.endsWith('dynamic-ui.js')
    ? { ok: true, text: async () => 'window.uiExecutions = (window.uiExecutions || 0) + 1; window.setInterval(() => {}, 5000);' }
    : fetch(url, options);
  stop = startPresentation();
  await advance(30_000);
  availability(false);
  availability(true);
  await advance(30_000);
  expect((dom as any).uiExecutions).toBe(1);
  expect((dom as any).intervalStarts).toBe(1);
  expect((dom as any).CortexUI).toBeUndefined();
  expect((dom.document.querySelector('link') as any).disabled).toBe(true);
  expect(timers.size).toBe(0);
});

test('a synchronous failure after partial script execution cannot repeat its effects', async () => {
  available = true;
  const fetch = g.fetch;
  g.fetch = async (url: string, options: unknown) => url.endsWith('dynamic-ui.js')
    ? { ok: true, text: async () => 'window.uiExecutions = (window.uiExecutions || 0) + 1; window.setInterval(() => {}, 5000);' }
    : fetch(url, options);
  const append = dom.document.head.append.bind(dom.document.head);
  dom.document.head.append = (...nodes: any[]) => {
    append(...nodes);
    if (nodes.some(node => node.tagName === 'SCRIPT' && node.textContent.includes('window.uiExecutions'))) {
      throw new Error('host script initialization failed after registering work');
    }
  };
  stop = startPresentation();
  await advance(30_000);
  expect((dom as any).uiExecutions).toBe(1);
  expect((dom as any).intervalStarts).toBe(1);
  expect((dom as any).CortexUI).toBeUndefined();
  expect((dom.document.querySelector('link') as any).disabled).toBe(true);
  expect(timers.size).toBe(0);
});

test('readiness remains bounded when the host ignores abort during response parsing', async () => {
  const arrivals: Array<(value: unknown) => void> = [];
  g.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { arrivals.push(resolve); }) });
  stop = startPresentation();
  await advance(20_000);
  expect(arrivals.length).toBe(5);
  expect(timers.size).toBe(0);
  for (const resolve of arrivals) resolve({ ok: true, available: true });
  await flush();
  expect(assets).toEqual([]);
});
