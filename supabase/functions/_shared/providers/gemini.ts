// Google Gemini API (generateContent) with optional "Grounding with Google Search".
// Docs: https://ai.google.dev/gemini-api/docs/google-search
// Grounding sources arrive as redirect links (vertexaisearch.cloud.google.com/grounding-api-redirect/...).
// We resolve each one to the real page URL so the same "cite only retrieved pages" validation applies.
import { providerFetch, ProviderError } from '../http.ts';
import type { WebResult } from './types.ts';

export interface GeminiConfig { apiKey: string; model: string; maxTokens: number }
export interface GeminiResponse { text: string; retrieved: WebResult[]; usage: { input_tokens?: number; output_tokens?: number } }

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Follow one redirect hop to discover the original page URL (no page content is downloaded). */
export async function resolveGroundingUrl(uri: string, timeoutMs = 6000): Promise<string> {
  if (!/grounding-api-redirect|vertexaisearch\.cloud\.google\.com/.test(uri)) return uri;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(uri, { method: 'GET', redirect: 'manual', signal: ctrl.signal });
    const loc = res.headers.get('location');
    await res.body?.cancel();
    return loc && /^https?:\/\//.test(loc) ? loc : uri;
  } catch { return uri; } finally { clearTimeout(timer); }
}

export function parseGeminiResponse(res: any): { text: string; chunks: { uri: string; title: string }[]; usage: GeminiResponse['usage'] } {
  const cand = res?.candidates?.[0];
  if (!cand) {
    const reason = res?.promptFeedback?.blockReason;
    throw new ProviderError('gemini', 502, reason ? `Request blocked by Gemini safety filter (${reason})` : 'Gemini returned no candidates');
  }
  const text = (cand.content?.parts ?? []).filter((p: any) => typeof p.text === 'string' && !p.thought).map((p: any) => p.text).join('');
  const chunks = (cand.groundingMetadata?.groundingChunks ?? [])
    .map((c: any) => c.web).filter((w: any) => w?.uri)
    .map((w: any) => ({ uri: String(w.uri), title: String(w.title ?? w.uri) }));
  return { text, chunks, usage: { input_tokens: res.usageMetadata?.promptTokenCount, output_tokens: res.usageMetadata?.candidatesTokenCount } };
}

export async function geminiMessage(cfg: GeminiConfig, system: string, user: string, opts: { webSearch?: boolean } = {}): Promise<GeminiResponse> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    // No temperature/top_p/top_k: newer Gemini models (3.5+) reject these deprecated sampling parameters.
    // Floor of 8192 output tokens because Gemini's built-in reasoning tokens count against this limit.
    generationConfig: { maxOutputTokens: Math.max(cfg.maxTokens, 8192) },
  };
  if (opts.webSearch) body.tools = [{ google_search: {} }];
  let res: any;
  try {
    res = await providerFetch<any>('gemini', `${BASE}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST', timeoutMs: 140000, retries: 2,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof ProviderError && opts.webSearch && (e.status === 429 || e.status === 400 || e.status === 403) && /ground|search|quota|billing|RESOURCE_EXHAUSTED/i.test(e.message)) {
      throw new ProviderError('gemini', e.status, `${e.message.slice(0, 300)} — Google Search grounding may need billing enabled on your Google Cloud project (the monthly free search allowance still applies).`);
    }
    throw e;
  }
  const { text, chunks, usage } = parseGeminiResponse(res);
  const seen = new Set<string>();
  const resolved = await Promise.all(chunks.slice(0, 30).map(async c => ({ url: await resolveGroundingUrl(c.uri), title: c.title })));
  const retrieved: WebResult[] = [];
  for (const r of resolved) {
    if (seen.has(r.url)) continue; seen.add(r.url);
    retrieved.push({ url: r.url, title: r.title, snippet: '', published: null, provider: 'gemini_web_search' });
  }
  return { text, retrieved, usage };
}
