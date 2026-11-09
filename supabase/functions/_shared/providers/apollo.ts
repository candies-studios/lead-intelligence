// Apollo.io official REST API. Docs: https://docs.apollo.io/reference
import { providerFetch, domainFromUrl } from '../http.ts';
import type { CompanyCandidate, CompanyQuery, ContactCandidate, ContactQuery, ProviderResult } from './types.ts';
import { TITLE_QUERIES } from '../titles.ts';

const BASE = 'https://api.apollo.io/api/v1';
const headers = (key: string) => ({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key });

function employeeRanges(min?: number | null, max?: number | null): string[] {
  const buckets: [number, number][] = [[1, 10], [11, 50], [51, 200], [201, 500], [501, 1000], [1001, 5000], [5001, 10000], [10001, 1000000]];
  return buckets.filter(([lo, hi]) => (min == null || hi >= min) && (max == null || lo <= max)).map(([lo, hi]) => `${lo},${hi}`);
}

export async function apolloSearchCompanies(key: string, q: CompanyQuery): Promise<ProviderResult<CompanyCandidate>> {
  const body: Record<string, unknown> = {
    page: q.page, per_page: Math.min(q.perPage, 100),
    organization_locations: q.cities.length ? q.cities : q.countries.map(c => c.name),
    q_organization_keyword_tags: q.industryKeywords.length ? q.industryKeywords.slice(0, 20) : ['fmcg', 'consumer goods'],
    organization_num_employees_ranges: employeeRanges(q.minEmployees, q.maxEmployees),
  };
  if (q.keyword) body.q_organization_name = q.keyword;
  const res = await providerFetch<any>('apollo', `${BASE}/mixed_companies/search`, { method: 'POST', headers: headers(key), body: JSON.stringify(body), cacheTtlMs: 6 * 3600e3 });
  const orgs: any[] = [...(res.organizations ?? []), ...(res.accounts ?? [])];
  const items = orgs.map((o): CompanyCandidate => {
    const website = o.website_url ?? null;
    const domain = o.primary_domain ?? domainFromUrl(website);
    const sources = [] as CompanyCandidate['source_urls'];
    if (website) sources.push({ url: website, type: 'website' });
    sources.push({ url: `https://app.apollo.io/#/organizations/${o.id}`, title: 'Apollo organization record', type: 'provider' });
    return {
      name: o.name, domain, website, linkedin_url: o.linkedin_url ?? null,
      industry: o.industry ?? null, country_code: null, hq_city: o.city ?? null,
      employee_count: o.estimated_num_employees ?? null, employee_range: null,
      revenue_usd: o.annual_revenue ?? o.organization_revenue ?? null,
      revenue_text: o.annual_revenue_printed ?? o.organization_revenue_printed ?? null,
      ownership: o.publicly_traded_symbol ? 'public' : 'unknown',
      description: o.short_description ?? null, parent_company_name: o.owned_by_organization?.name ?? null,
      brands: [], provider: 'apollo', external_id: o.id ?? null, source_urls: sources,
      country_name: o.country ?? null,
    };
  });
  const totalPages = res.pagination?.total_pages ?? q.page;
  return { items, exhausted: q.page >= totalPages || items.length === 0 };
}

const APOLLO_SENIORITY: Record<string, string> = { cxo: 'c_suite', vp: 'vp', director: 'director', head: 'head', manager: 'manager', senior: 'senior' };

export async function apolloSearchPeople(key: string, q: ContactQuery, enrichEmails: boolean): Promise<ProviderResult<ContactCandidate>> {
  const titles = q.departments.flatMap(d => TITLE_QUERIES[d as keyof typeof TITLE_QUERIES] ?? []);
  const body: Record<string, unknown> = {
    page: 1, per_page: Math.min(25, q.limit * 4),
    person_titles: titles, include_similar_titles: true,
    person_seniorities: q.seniorities.map(s => APOLLO_SENIORITY[s]).filter(Boolean),
  };
  if (q.externalIds.apollo) body.organization_ids = [q.externalIds.apollo];
  else if (q.domain) body.q_organization_domains_list = [q.domain];
  else return { items: [], exhausted: true, note: 'Apollo needs a company domain or Apollo organization id' };

  let res: any;
  try {
    res = await providerFetch<any>('apollo', `${BASE}/mixed_people/api_search`, { method: 'POST', headers: headers(key), body: JSON.stringify(body), cacheTtlMs: 6 * 3600e3 });
  } catch (e: any) {
    if (e?.status !== 404) throw e;
    res = await providerFetch<any>('apollo', `${BASE}/mixed_people/search`, { method: 'POST', headers: headers(key), body: JSON.stringify(body), cacheTtlMs: 6 * 3600e3 });
  }
  const people: any[] = res.people ?? [];
  const out: ContactCandidate[] = [];
  for (const p of people) {
    let email: string | null = null; let status: ContactCandidate['email_status'] = 'unavailable';
    let linkedin = p.linkedin_url ?? null; let lastName = p.last_name ?? null; let full = p.name ?? null;
    if (enrichEmails && p.id) {
      // Enrichment consumes Apollo credits — only when the campaign enables it.
      const m = await providerFetch<any>('apollo', `${BASE}/people/match`, { method: 'POST', headers: headers(key), body: JSON.stringify({ id: p.id, reveal_personal_emails: false }) });
      const person = m.person ?? {};
      if (person.email && !String(person.email).includes('email_not_unlocked')) {
        email = person.email;
        status = person.email_status === 'verified' ? 'verified' : 'provider_returned';
      }
      linkedin = person.linkedin_url ?? linkedin; lastName = person.last_name ?? lastName; full = person.name ?? full;
    }
    if (!full && !(p.first_name && lastName)) continue; // search sometimes obfuscates last names; skip incomplete names
    out.push({
      full_name: full ?? `${p.first_name} ${lastName}`, first_name: p.first_name ?? null, last_name: lastName,
      title: p.title ?? null, email, email_status: status, email_confidence: null, phone: null,
      linkedin_url: linkedin, city: p.city ?? null, country_name: p.country ?? null, bio: p.headline ?? null,
      provider: 'apollo', external_id: p.id ?? null,
      source_urls: [`https://app.apollo.io/#/people/${p.id}`],
      confidence: status === 'verified' ? 'high' : 'medium',
    });
  }
  return { items: out, exhausted: true };
}

export async function apolloPing(key: string) {
  await providerFetch('apollo', `${BASE}/auth/health`, { headers: headers(key), retries: 0 });
}
