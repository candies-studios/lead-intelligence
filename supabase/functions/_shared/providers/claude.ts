// Anthropic Claude Messages API. Model is configurable (app_settings.ai_model or ANTHROPIC_MODEL).
// Grounding rule: when web search is used, every URL the model cites must appear in the
// search results the API actually returned; anything else is dropped by `filterToRetrieved`.
import { providerFetch } from '../http.ts';
import type { WebResult } from './types.ts';

export interface ClaudeConfig { apiKey: string; model: string; maxTokens: number }

export interface ClaudeResponse { text: string; retrieved: WebResult[]; usage: { input_tokens?: number; output_tokens?: number } }

export async function claudeMessage(cfg: ClaudeConfig, system: string, user: string, opts: { webSearch?: boolean; maxSearches?: number; allowedDomains?: string[]; blockedDomains?: string[] } = {}): Promise<ClaudeResponse> {
  const body: Record<string, unknown> = {
    model: cfg.model, max_tokens: cfg.maxTokens, system,
    messages: [{ role: 'user', content: user }],
  };
  if (opts.webSearch) {
    const tool: Record<string, unknown> = { type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxSearches ?? 5 };
    if (opts.allowedDomains?.length) tool.allowed_domains = opts.allowedDomains;
    else tool.blocked_domains = opts.blockedDomains ?? [];
    body.tools = [tool];
  }
  const res = await providerFetch<any>('anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'POST', timeoutMs: 140000, retries: 2,
    headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const retrieved: WebResult[] = [];
  let text = '';
  for (const block of res.content ?? []) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) retrieved.push({ url: r.url, title: r.title ?? r.url, snippet: '', published: r.page_age ?? null, provider: 'anthropic_web_search' });
    }
  }
  return { text, retrieved, usage: res.usage ?? {} };
}

/** Extracts the first JSON object/array from model text (handles ```json fences). */
export function extractJson<T = any>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('Model did not return JSON');
  const open = candidate[start]; const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(candidate.slice(start, i + 1));
  }
  throw new Error('Model returned incomplete JSON');
}

const normUrl = (u: string) => u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();

/** True if `url` was actually retrieved (exact page match, ignoring scheme/www/query/trailing slash). */
export function wasRetrieved(url: string | null | undefined, retrieved: { url: string }[]): boolean {
  if (!url) return false;
  const n = normUrl(url);
  return retrieved.some(r => normUrl(r.url) === n);
}

export function filterToRetrieved<T extends { source_url?: string | null }>(items: T[], retrieved: { url: string }[]): T[] {
  return items.filter(i => wasRetrieved(i.source_url, retrieved));
}

export const WOT_CONTEXT = `World of Trade (https://worldoftrade.pro/) runs a three-day experiential business simulation for
Sales, Trade Marketing, Distribution & Channel Management professionals across industries.
20–30 corporate participants form teams of 4–6 that each run a business with ~$1M virtual budget in a virtual market
(geography, population, demographics, age, gender, income, consumer demand). Teams make decisions on manufacturing,
distribution, retail, HR, operations, marketing, pricing and investment. Manufacturers sell to retailers; retailers sell to consumers.
Teams compete for maximum profitability. It builds commercial acumen, channel and partner economics, distributor/dealer/retailer
management, trade-terms negotiation, pricing, P&L/financial understanding, strategic decision-making and cross-functional collaboration.
The skills transfer to ANY company that sells through sales teams, distributors, dealers, retailers, agents or channel partners —
e.g. FMCG, consumer durables, pharma & healthcare, automotive, building materials, agri-inputs, telecom, technology, industrial,
financial services and insurance, energy, apparel & lifestyle, retail and distribution.
Typical buyers: L&D, HR, Sales, Distribution/Channel and Trade Marketing leaders.`;
