// People Data Labs official API v5. Docs: https://docs.peopledatalabs.com
import { providerFetch, domainFromUrl } from '../http.ts';
import type { CompanyCandidate, CompanyQuery, ContactCandidate, ContactQuery, ProviderResult } from './types.ts';

const BASE = 'https://api.peopledatalabs.com/v5';

// PDL canonical industry values that map to World of Trade targets
// PDL canonical industry values per sector group (unknown groups fall back to keyword search on the industry names)
const PDL_INDUSTRIES: Record<string, string[]> = {
  'FMCG': ['food & beverages', 'consumer goods', 'cosmetics', 'dairy', 'food production', 'tobacco', 'health, wellness and fitness', 'wine and spirits'],
  'FMCD': ['consumer electronics', 'furniture', 'electrical/electronic manufacturing', 'wireless'],
  'Retail & E-commerce': ['retail', 'supermarkets', 'internet'],
  'Distribution & Wholesale': ['wholesale', 'import and export'],
  'Pharma & Healthcare': ['pharmaceuticals', 'medical devices', 'hospital & health care', 'biotechnology', 'veterinary'],
  'Automotive & Mobility': ['automotive'],
  'Building Materials & Construction': ['building materials', 'construction', 'real estate'],
  'Industrial & Engineering': ['machinery', 'industrial automation', 'mechanical or industrial engineering', 'packaging and containers', 'electrical/electronic manufacturing'],
  'Chemicals & Materials': ['chemicals', 'plastics'],
  'Agriculture & Agri-inputs': ['farming', 'dairy', 'ranching'],
  'Technology & Telecom': ['telecommunications', 'computer hardware', 'computer software', 'information technology and services', 'computer networking'],
  'Financial Services & Insurance': ['banking', 'insurance', 'financial services', 'investment management'],
  'Energy & Utilities': ['oil & energy', 'renewables & environment', 'utilities'],
  'Logistics & Supply Chain': ['logistics and supply chain', 'transportation/trucking/railroad', 'package/freight delivery'],
  'Textiles, Apparel & Lifestyle': ['apparel & fashion', 'luxury goods & jewelry', 'textiles', 'sporting goods'],
  'Media, Hospitality & Services': ['media production', 'entertainment', 'hospitality', 'restaurants', 'leisure, travel & tourism', 'education management'],
  'Related': ['retail', 'wholesale', 'supermarkets'],
};
const LEVELS: Record<string, string> = { cxo: 'cxo', vp: 'vp', director: 'director', head: 'director', manager: 'manager', senior: 'senior' };
const ROLES: Record<string, string> = { learning_development: 'human_resources', human_resources: 'human_resources', sales: 'sales', distribution_channel: 'sales', trade_marketing: 'marketing' };

export async function pdlSearchCompanies(key: string, q: CompanyQuery): Promise<ProviderResult<CompanyCandidate>> {
  const must: any[] = [
    { terms: { 'location.country': q.countries.map(c => c.name.toLowerCase()) } },
    { terms: { industry: [...new Set(q.segments.flatMap(s => PDL_INDUSTRIES[s] ?? []))] } },
  ];
  if (q.minEmployees || q.maxEmployees) must.push({ range: { employee_count: { ...(q.minEmployees ? { gte: q.minEmployees } : {}), ...(q.maxEmployees ? { lte: q.maxEmployees } : {}) } } });
  if (q.cities.length) must.push({ terms: { 'location.locality': q.cities.map(c => c.toLowerCase()) } });
  if (q.keyword) must.push({ match: { name: q.keyword } });
  const size = Math.min(q.perPage, 100);
  const body = { query: { bool: { must } }, size, from: (q.page - 1) * size, titlecase: true };
  const res = await providerFetch<any>('pdl', `${BASE}/company/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key }, body: JSON.stringify(body), cacheTtlMs: 24 * 3600e3,
  }).catch((e: any) => { if (e?.status === 404) return { data: [], total: 0 }; throw e; });
  const items = (res.data ?? []).map((c: any): CompanyCandidate => {
    const website = c.website ? (c.website.startsWith('http') ? c.website : `https://${c.website}`) : null;
    const src: CompanyCandidate['source_urls'] = [];
    if (website) src.push({ url: website, type: 'website' });
    if (c.linkedin_url) src.push({ url: `https://${c.linkedin_url.replace(/^https?:\/\//, '')}`, type: 'provider', title: 'Company LinkedIn page (via PDL)' });
    return {
      name: c.display_name ?? c.name, domain: domainFromUrl(website), website,
      linkedin_url: c.linkedin_url ? `https://${c.linkedin_url.replace(/^https?:\/\//, '')}` : null,
      industry: c.industry ?? null, country_code: null, hq_city: c.location?.locality ?? null,
      employee_count: c.employee_count ?? null, employee_range: c.size ?? null,
      revenue_usd: null, revenue_text: c.inferred_revenue ?? null,
      ownership: c.type === 'public' ? 'public' : c.type === 'private' ? 'private' : 'unknown',
      description: c.summary ?? null, parent_company_name: null, brands: [], provider: 'pdl', external_id: c.id ?? null,
      source_urls: src, country_name: c.location?.country ?? null,
    };
  });
  return { items, exhausted: items.length < size || (q.page * size) >= (res.total ?? 0) };
}

export async function pdlSearchPeople(key: string, q: ContactQuery): Promise<ProviderResult<ContactCandidate>> {
  if (!q.domain) return { items: [], exhausted: true, note: 'PDL needs a company domain' };
  const body = {
    query: { bool: { must: [
      { term: { job_company_website: q.domain } },
      { terms: { job_title_role: [...new Set(q.departments.map(d => ROLES[d]).filter(Boolean))] } },
      { terms: { job_title_levels: [...new Set(q.seniorities.map(s => LEVELS[s]).filter(Boolean))] } },
    ] } },
    size: Math.min(25, q.limit * 3), titlecase: true,
  };
  const res = await providerFetch<any>('pdl', `${BASE}/person/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key }, body: JSON.stringify(body), cacheTtlMs: 24 * 3600e3,
  }).catch((e: any) => { if (e?.status === 404) return { data: [] }; throw e; });
  const items = (res.data ?? []).filter((p: any) => p.full_name).map((p: any): ContactCandidate => {
    const email = typeof p.work_email === 'string' ? p.work_email : null;
    return {
      full_name: p.full_name, first_name: p.first_name ?? null, last_name: p.last_name ?? null, title: p.job_title ?? null,
      email, email_status: email ? 'provider_returned' : 'unavailable', email_confidence: null, phone: null,
      linkedin_url: p.linkedin_url ? `https://${String(p.linkedin_url).replace(/^https?:\/\//, '')}` : null,
      city: p.location_locality ?? null, country_name: p.location_country ?? null, bio: p.summary ?? null,
      provider: 'pdl', external_id: p.id ?? null, source_urls: [], confidence: 'medium',
    };
  });
  return { items, exhausted: true };
}

export async function pdlPing(key: string) {
  await providerFetch('pdl', `${BASE}/company/enrich?website=worldoftrade.pro`, { headers: { 'X-Api-Key': key }, retries: 0 })
    .catch((e: any) => { if (e?.status !== 404) throw e; }); // 404 = authenticated but no match
}
