// Google Programmable Search (Custom Search JSON API). Docs: https://developers.google.com/custom-search/v1/overview
import { providerFetch } from '../http.ts';
import type { WebResult } from './types.ts';

export async function googleSearch(key: string, cx: string, q: string, opts: { num?: number; dateRestrict?: string; gl?: string } = {}): Promise<WebResult[]> {
  const params = new URLSearchParams({ key, cx, q, num: String(Math.min(opts.num ?? 10, 10)) });
  if (opts.dateRestrict) params.set('dateRestrict', opts.dateRestrict);
  if (opts.gl) params.set('gl', opts.gl.toLowerCase());
  const res = await providerFetch<any>('google_cse', `https://www.googleapis.com/customsearch/v1?${params}`, { cacheTtlMs: 12 * 3600e3 });
  return (res.items ?? []).map((i: any) => ({
    url: i.link, title: i.title, snippet: i.snippet ?? '', provider: 'google_cse',
    published: i.pagemap?.metatags?.[0]?.['article:published_time'] ?? null,
  }));
}

export async function googlePing(key: string, cx: string) { await googleSearch(key, cx, 'World of Trade business simulation', { num: 1 }); }
