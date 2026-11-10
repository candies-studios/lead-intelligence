// Fetch with timeout, retry (429/5xx with backoff), simple per-provider rate limiting and in-memory caching.
export class ProviderError extends Error {
  constructor(public provider: string, public status: number, message: string) { super(`${provider}: ${message}`); }
}

const lastCall = new Map<string, number>();
const cache = new Map<string, { at: number; value: unknown }>();
const MIN_INTERVAL_MS: Record<string, number> = { apollo: 400, hunter: 250, pdl: 300, google_cse: 150, anthropic: 0, gemini: 0, website: 500 };

async function throttle(provider: string) {
  const min = MIN_INTERVAL_MS[provider] ?? 200;
  const prev = lastCall.get(provider) ?? 0;
  const wait = prev + min - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall.set(provider, Date.now());
}

export interface FetchOpts extends RequestInit { timeoutMs?: number; retries?: number; cacheTtlMs?: number; cacheKey?: string }

export async function providerFetch<T = any>(provider: string, url: string, opts: FetchOpts = {}): Promise<T> {
  const { timeoutMs = 30000, retries = 2, cacheTtlMs = 0, cacheKey, ...init } = opts;
  const key = cacheKey ?? `${provider}:${init.method ?? 'GET'}:${url}:${typeof init.body === 'string' ? init.body : ''}`;
  if (cacheTtlMs) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheTtlMs) return hit.value as T;
  }
  let attempt = 0;
  while (true) {
    await throttle(provider);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await new Promise(r => setTimeout(r, (ra > 0 ? ra * 1000 : 800 * 2 ** attempt)));
        attempt++; continue;
      }
      const text = await res.text();
      if (!res.ok) throw new ProviderError(provider, res.status, `HTTP ${res.status} ${text.slice(0, 300)}`);
      const ct = res.headers.get('content-type') ?? '';
      const value = (ct.includes('json') ? JSON.parse(text) : text) as T;
      if (cacheTtlMs) cache.set(key, { at: Date.now(), value });
      return value;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ProviderError) throw e;
      if (attempt < retries) { attempt++; await new Promise(r => setTimeout(r, 800 * 2 ** attempt)); continue; }
      throw new ProviderError(provider, 0, (e as Error).message);
    }
  }
}

export function domainFromUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u.startsWith('http') ? u : `https://${u}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return null; }
}
