// UI → Lua transport. One place builds every callback, bounds its size, times it out and
// validates the envelope, so each call resolves exactly once with { ok } or { ok:false, error }.

import { PROTOCOL } from './types';

declare global {
  interface Window { GetParentResourceName?: () => string }
}

export type CallbackName = 'boot' | 'ready' | 'began' | 'complete' | 'cancel' | 'fault';
export type Reply = { ok: true; data?: Record<string, unknown> } | { ok: false; error: string };

export const CALLBACK_TIMEOUT_MS = 4000;
const MAX_BODY_BYTES = 8192;

export const isNui = (): boolean => typeof window !== 'undefined' && typeof window.GetParentResourceName === 'function';

/** Development hook: the playground installs a local handler; production never sets this. */
let localHandler: ((name: CallbackName, body: Record<string, unknown>) => Promise<Reply>) | null = null;
export function setLocalHandler(handler: typeof localHandler): void {
  localHandler = handler;
}

export async function call(name: CallbackName, gen: number, body: Record<string, unknown> = {}): Promise<Reply> {
  const payload = { ...body, protocol: PROTOCOL, gen };
  const text = JSON.stringify(payload);
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false, error: 'too_large' };
  if (!isNui()) return localHandler ? localHandler(name, payload) : { ok: false, error: 'offline' };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${window.GetParentResourceName!()}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: text,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `http_${response.status}` };
    const reply: unknown = await response.json();
    if (!reply || typeof reply !== 'object' || typeof (reply as { ok?: unknown }).ok !== 'boolean') return { ok: false, error: 'bad_reply' };
    return reply as Reply;
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'timeout' : 'unavailable' };
  } finally {
    window.clearTimeout(timer);
  }
}
