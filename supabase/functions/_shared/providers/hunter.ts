// Hunter.io official API v2. Docs: https://hunter.io/api-documentation/v2
import { providerFetch } from '../http.ts';
import type { ContactCandidate, ContactQuery, ProviderResult } from './types.ts';

const BASE = 'https://api.hunter.io/v2';
const DEPT: Record<string, string> = { learning_development: 'hr', human_resources: 'hr', sales: 'sales', distribution_channel: 'sales', trade_marketing: 'marketing' };

export interface HunterDomainResult extends ProviderResult<ContactCandidate> { pattern: string | null }

export async function hunterDomainSearch(key: string, q: ContactQuery): Promise<HunterDomainResult> {
  if (!q.domain) return { items: [], exhausted: true, pattern: null, note: 'Hunter needs a company domain' };
  const params = new URLSearchParams({
    domain: q.domain, api_key: key, type: 'personal', limit: String(Math.min(50, q.limit * 5)),
    seniority: 'senior,executive',
    department: [...new Set(q.departments.map(d => DEPT[d]).filter(Boolean)), 'executive'].join(','),
  });
  const res = await providerFetch<any>('hunter', `${BASE}/domain-search?${params}`, { cacheTtlMs: 24 * 3600e3 });
  const data = res.data ?? {};
  const items: ContactCandidate[] = (data.emails ?? [])
    .filter((e: any) => e.first_name && e.last_name)
    .map((e: any): ContactCandidate => {
      const vstatus = e.verification?.status;
      const status: ContactCandidate['email_status'] = vstatus === 'valid' ? 'verified' : vstatus === 'invalid' ? 'invalid' : 'provider_returned';
      return {
        full_name: `${e.first_name} ${e.last_name}`, first_name: e.first_name, last_name: e.last_name,
        title: e.position ?? null, email: e.value ?? null, email_status: status, email_confidence: e.confidence ?? null,
        phone: e.phone_number ?? null, linkedin_url: e.linkedin ?? null, city: null, country_name: null, bio: null,
        provider: 'hunter', external_id: null,
        source_urls: (e.sources ?? []).map((s: any) => s.uri).filter(Boolean).slice(0, 5),
        confidence: status === 'verified' && (e.confidence ?? 0) >= 90 ? 'high' : (e.confidence ?? 0) >= 70 ? 'medium' : 'low',
      };
    });
  return { items, exhausted: true, pattern: data.pattern ?? null };
}

export async function hunterVerify(key: string, email: string): Promise<{ status: ContactCandidate['email_status']; score: number | null }> {
  const res = await providerFetch<any>('hunter', `${BASE}/email-verifier?${new URLSearchParams({ email, api_key: key })}`, { timeoutMs: 45000, cacheTtlMs: 7 * 864e5 });
  const s = res.data?.status;
  return { status: s === 'valid' ? 'verified' : s === 'invalid' ? 'invalid' : 'unverified', score: res.data?.score ?? null };
}

export async function hunterPing(key: string) {
  await providerFetch('hunter', `${BASE}/account?api_key=${encodeURIComponent(key)}`, { retries: 0 });
}

/** Apply a Hunter-style pattern like "{first}.{last}". Result is ALWAYS labelled inferred_pattern. */
export function inferEmail(pattern: string | null, first: string | null, last: string | null, domain: string | null): string | null {
  if (!pattern || !first || !last || !domain) return null;
  const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const f = clean(first), l = clean(last);
  if (!f || !l) return null;
  const local = pattern.replace('{first}', f).replace('{last}', l).replace('{f}', f[0]).replace('{l}', l[0]);
  if (/[{}]/.test(local)) return null;
  return `${local}@${domain}`;
}
