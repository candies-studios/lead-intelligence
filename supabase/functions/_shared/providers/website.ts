// Reads a single public company homepage (and optional "about" page) for research grounding.
// Respects robots.txt for our user agent and never crawls beyond a couple of pages.
import { providerFetch } from '../http.ts';

const UA = 'WorldOfTradeLeadIntelligence/1.0 (+https://worldoftrade.pro/)';

async function allowedByRobots(origin: string, path: string): Promise<boolean> {
  try {
    const txt = await providerFetch<string>('website', `${origin}/robots.txt`, { headers: { 'User-Agent': UA }, timeoutMs: 8000, retries: 0, cacheTtlMs: 864e5 });
    if (typeof txt !== 'string') return true;
    let applies = false; const disallow: string[] = [];
    for (const raw of txt.split('\n')) {
      const line = raw.split('#')[0].trim();
      const [k, ...rest] = line.split(':'); const v = rest.join(':').trim();
      if (/^user-agent$/i.test(k)) applies = v === '*' || UA.toLowerCase().includes(v.toLowerCase());
      else if (applies && /^disallow$/i.test(k) && v) disallow.push(v);
    }
    return !disallow.some(d => path.startsWith(d));
  } catch { return true; } // no robots.txt → allowed
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

export async function readWebsite(url: string, maxChars = 8000): Promise<{ url: string; text: string; title: string | null } | null> {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (!(await allowedByRobots(u.origin, u.pathname || '/'))) return null;
    const html = await providerFetch<string>('website', u.toString(), { headers: { 'User-Agent': UA, Accept: 'text/html' }, timeoutMs: 15000, retries: 1, cacheTtlMs: 864e5 });
    if (typeof html !== 'string') return null;
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? '';
    return { url: u.toString(), title, text: `${desc} ${htmlToText(html)}`.slice(0, maxChars) };
  } catch { return null; }
}
