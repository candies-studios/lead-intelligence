// Orchestration: discovery → dedupe/persist → contact finding → signals → scoring.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getCreds } from './secrets.ts';
import { aiMessage, aiAvailable } from './ai.ts';
import { getSetting } from './context.ts';
import { domainFromUrl } from './http.ts';
import { classifyTitle, matchesTargets } from './titles.ts';
import { scoreLead, DEFAULT_WEIGHTS, DEFAULT_BANDS, type ScoringWeights, type PriorityBands } from './scoring.ts';
import type { CompanyCandidate, CompanyQuery, ContactCandidate, ContactQuery, WebResult } from './providers/types.ts';
import { apolloSearchCompanies, apolloSearchPeople } from './providers/apollo.ts';
import { pdlSearchCompanies, pdlSearchPeople } from './providers/pdl.ts';
import { hunterDomainSearch, hunterVerify, inferEmail } from './providers/hunter.ts';
import { googleSearch } from './providers/google.ts';
import { extractJson, wasRetrieved, filterToRetrieved, WOT_CONTEXT } from './providers/claude.ts';

export type Log = (level: 'info' | 'warn' | 'error' | 'success', message: string, meta?: Record<string, unknown>) => PromiseLike<void> | void;
const noop: Log = () => {};

// ---------------------------------------------------------------- countries
let countryCache: { code: string; name: string; is_focus: boolean }[] | null = null;
const ALIASES: Record<string, string> = { usa: 'US', 'united states of america': 'US', uk: 'GB', 'great britain': 'GB', england: 'GB', uae: 'AE', ksa: 'SA', 'viet nam': 'VN', holland: 'NL' };
export async function countries(admin: SupabaseClient) {
  if (!countryCache) countryCache = (await admin.from('countries').select('code,name,is_focus')).data ?? [];
  return countryCache;
}
export async function countryCode(admin: SupabaseClient, name?: string | null): Promise<string | null> {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (ALIASES[n]) return ALIASES[n];
  const list = await countries(admin);
  return list.find(c => c.name.toLowerCase() === n || c.code.toLowerCase() === n)?.code ?? null;
}

// ---------------------------------------------------------------- company discovery
export async function aiDiscoverCompanies(admin: SupabaseClient, q: CompanyQuery): Promise<{ items: CompanyCandidate[]; exhausted: boolean; retrieved: WebResult[]; aiProvider: string }> {
  const where = q.cities.length ? `${q.cities.join(', ')} (${q.countries.map(c => c.name).join(', ')})` : q.countries.map(c => c.name).join(', ');
  const sys = `You are a B2B market researcher. Only report companies you found in web search results during this conversation. Never invent companies, websites or numbers. If a value is not stated in a source, use null.`;
  const user = `${WOT_CONTEXT}

Find real companies in these sectors: ${q.segments.join(', ')}${q.industries.length ? ` (industries: ${q.industries.slice(0, 25).join(', ')})` : ''}, headquartered or with a significant operating entity in ${where}.
Prioritise companies with sizeable sales, distribution, dealer/channel-partner or trade-marketing teams — the audience for World of Trade.
${q.minEmployees ? `Prefer companies with at least ${q.minEmployees} employees.` : ''} ${q.keyword ? `Keyword: ${q.keyword}.` : ''}
This is result page ${q.page}; return up to ${Math.min(q.perPage, 15)} companies${q.page > 1 ? ' that are different from the most obvious market leaders (skip the top ' + (q.page - 1) * 15 + ' most famous ones)' : ''}.
Return ONLY JSON: {"companies":[{"name":"","website":"https://...","industry":"","country":"","hq_city":null,"employee_count":null,"description":"one factual sentence","brands":[],"parent_company":null,"ownership":"public|private|subsidiary|unknown","source_url":"URL of the search result that supports this entry"}]}`;
  const res = await aiMessage(admin, sys, user, { webSearch: true, maxSearches: 5, blockedDomains: ['linkedin.com'], maxTokens: 4000 });
  const parsed = extractJson<{ companies: any[] }>(res.text);
  const items: CompanyCandidate[] = [];
  for (const c of parsed.companies ?? []) {
    if (!c?.name || !wasRetrieved(c.source_url, res.retrieved)) continue; // ungrounded → dropped
    const website = c.website && /^https?:\/\//.test(c.website) ? c.website : null;
    items.push({
      name: String(c.name).trim(), domain: domainFromUrl(website), website, linkedin_url: null,
      industry: c.industry ?? null, country_code: null, country_name: c.country ?? null, hq_city: c.hq_city ?? null,
      employee_count: Number.isFinite(c.employee_count) ? c.employee_count : null, employee_range: null,
      revenue_usd: null, revenue_text: null, ownership: ['public', 'private', 'subsidiary'].includes(c.ownership) ? c.ownership : 'unknown',
      description: c.description ?? null, parent_company_name: c.parent_company ?? null,
      brands: Array.isArray(c.brands) ? c.brands.slice(0, 15).map(String) : [], provider: `${res.provider}_web_search`, external_id: null,
      source_urls: [{ url: c.source_url, type: 'web', title: res.retrieved.find(r => wasRetrieved(c.source_url, [r]))?.title }],
    });
  }
  return { items, exhausted: items.length === 0, retrieved: res.retrieved, aiProvider: res.provider };
}

export async function discoverCompanies(admin: SupabaseClient, q: CompanyQuery, preferred?: string[], log: Log = noop) {
  const order = (preferred?.length ? preferred : ['apollo', 'pdl', 'ai']).map(p => (p === 'anthropic' || p === 'gemini' ? 'ai' : p));
  const tried: string[] = [];
  for (const p of order) {
    const creds = p === 'ai' ? null : await getCreds(admin, p);
    if (p === 'ai' ? !(await aiAvailable(admin)) : !creds) continue;
    tried.push(p);
    try {
      let r: { items: CompanyCandidate[]; exhausted: boolean } | null = null;
      let used = p;
      if (p === 'apollo') r = await apolloSearchCompanies(creds!.apiKey, q);
      else if (p === 'pdl') r = await pdlSearchCompanies(creds!.apiKey, q);
      else if (p === 'ai') { const a = await aiDiscoverCompanies(admin, q); r = a; used = a.aiProvider; }
      if (!r) continue;
      for (const c of r.items) c.country_code = c.country_code ?? await countryCode(admin, c.country_name);
      if (r.items.length || p === order[order.length - 1]) return { ...r, provider: used, tried };
      await log('warn', `${p} returned no companies for this page; trying next provider`);
    } catch (e) {
      await log('warn', `${p} company search failed: ${(e as Error).message}`);
    }
  }
  if (!tried.length) throw Object.assign(new Error('No company-discovery provider is connected. Connect Gemini, Claude, Apollo or People Data Labs on the Integrations page, or add companies manually.'), { status: 412 });
  return { items: [] as CompanyCandidate[], exhausted: true, provider: tried.at(-1)!, tried };
}

// ---------------------------------------------------------------- persistence / dedupe
export async function upsertCompany(admin: SupabaseClient, c: CompanyCandidate, userId: string | null, segment: string | null, isDemo = false): Promise<{ id: string; created: boolean }> {
  let existing: any = null;
  if (c.domain) existing = (await admin.from('companies').select('*').eq('domain', c.domain).eq('is_demo', isDemo).maybeSingle()).data;
  if (!existing) {
    const { data } = await admin.rpc('find_company_by_name', { p_name: c.name, p_country: c.country_code, p_demo: isDemo });
    existing = data?.[0] ?? null;
  }
  let parentId: string | null = null;
  if (c.parent_company_name) {
    const { data } = await admin.rpc('find_company_by_name', { p_name: c.parent_company_name, p_country: null, p_demo: isDemo });
    parentId = data?.[0]?.id ?? null;
  }
  const fields: Record<string, unknown> = {
    name: c.name, domain: c.domain, website: c.website, linkedin_url: c.linkedin_url, industry: c.industry,
    industry_segment: segment, country_code: c.country_code, hq_city: c.hq_city, employee_count: c.employee_count,
    employee_range: c.employee_range, revenue_usd: c.revenue_usd, revenue_text: c.revenue_text, ownership: parentId ? 'subsidiary' : c.ownership,
    description: c.description, parent_company_name: c.parent_company_name, parent_company_id: parentId,
    data_provider: c.provider, last_verified_at: new Date().toISOString(),
  };
  let id: string; let created = false;
  if (existing) {
    // fill gaps only — never overwrite researched values with nulls
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (v != null && (existing[k] == null || k === 'last_verified_at' || k === 'employee_count')) patch[k] = v;
    patch.external_ids = { ...(existing.external_ids ?? {}), ...(c.external_id ? { [c.provider]: c.external_id } : {}) };
    await admin.from('companies').update(patch).eq('id', existing.id);
    id = existing.id;
  } else {
    const { data, error } = await admin.from('companies').insert({ ...fields, external_ids: c.external_id ? { [c.provider]: c.external_id } : {}, created_by: userId, is_demo: isDemo }).select('id').single();
    if (error) throw error;
    id = data.id; created = true;
  }
  if (c.source_urls.length)
    await admin.from('company_sources').upsert(c.source_urls.map(s => ({ company_id: id, url: s.url, title: s.title ?? null, source_type: s.type, provider: c.provider })), { onConflict: 'company_id,url', ignoreDuplicates: true });
  for (const b of c.brands) await admin.from('company_brands').insert({ company_id: id, brand_name: b, source_url: c.source_urls[0]?.url ?? null }).then(() => {}, () => {});
  return { id, created };
}

function mergeContacts(list: ContactCandidate[]): ContactCandidate[] {
  const key = (c: ContactCandidate) => c.full_name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const rank = { verified: 5, provider_returned: 4, inferred_pattern: 2, unverified: 3, invalid: 0, unavailable: 1 } as const;
  const map = new Map<string, ContactCandidate>();
  for (const c of list) {
    const k = key(c); const prev = map.get(k);
    if (!prev) { map.set(k, { ...c }); continue; }
    if (rank[c.email_status] > rank[prev.email_status]) { prev.email = c.email; prev.email_status = c.email_status; prev.email_confidence = c.email_confidence; }
    prev.title ??= c.title; prev.linkedin_url ??= c.linkedin_url; prev.phone ??= c.phone; prev.bio ??= c.bio;
    prev.source_urls = [...new Set([...prev.source_urls, ...c.source_urls])];
    prev.provider = `${prev.provider}+${c.provider}`;
    if (c.confidence === 'high' || (c.confidence === 'medium' && prev.confidence === 'low')) prev.confidence = c.confidence;
  }
  return [...map.values()];
}

export async function aiFindContacts(admin: SupabaseClient, q: ContactQuery): Promise<{ items: ContactCandidate[]; retrieved: WebResult[]; aiProvider: string }> {
  const sys = `You are a B2B research assistant. Report ONLY people explicitly named in web search results you retrieved in this conversation as CURRENTLY holding the role at the company. Never guess names, emails or phone numbers. Do not output emails or phone numbers at all.`;
  const user = `Company: ${q.companyName}${q.domain ? ` (${q.domain})` : ''}${q.countryName ? `, ${q.countryName}` : ''}.
Find current leaders in: ${q.departments.join(', ')} (e.g. CHRO, Head of L&D, Head of Capability, Sales Director, Head of Trade Marketing, Category Director).
Use the company's leadership page, press releases, annual reports and reputable business news. Up to ${q.limit} people.
Return ONLY JSON: {"people":[{"full_name":"","title":"","source_url":"page that names them in this role","published":"YYYY-MM-DD or null","linkedin_url":"only if a linkedin.com/in URL appeared verbatim in your search results, else null","bio":"one factual sentence from the source or null"}]}`;
  const res = await aiMessage(admin, sys, user, { webSearch: true, maxSearches: 4, maxTokens: 2500 });
  const parsed = extractJson<{ people: any[] }>(res.text);
  const items: ContactCandidate[] = [];
  for (const p of parsed.people ?? []) {
    if (!p?.full_name || !p.title || !wasRetrieved(p.source_url, res.retrieved)) continue;
    const [first, ...rest] = String(p.full_name).trim().split(/\s+/);
    const old = p.published && Date.now() - new Date(p.published).getTime() > 2 * 365 * 864e5;
    items.push({
      full_name: String(p.full_name).trim(), first_name: first ?? null, last_name: rest.join(' ') || null, title: p.title,
      email: null, email_status: 'unavailable', email_confidence: null, phone: null,
      linkedin_url: p.linkedin_url && wasRetrieved(p.linkedin_url, res.retrieved) ? p.linkedin_url : null,
      city: null, country_name: q.countryName ?? null, bio: p.bio ?? null, provider: `${res.provider}_web_search`, external_id: null,
      source_urls: [p.source_url], confidence: old ? 'low' : 'medium',
    });
  }
  return { items, retrieved: res.retrieved, aiProvider: res.provider };
}

export interface FindContactsOptions { enrichEmails: boolean; preferred?: string[]; log?: Log }

export async function findContacts(admin: SupabaseClient, q: ContactQuery, opts: FindContactsOptions) {
  const log = opts.log ?? noop;
  const order = (opts.preferred?.length ? opts.preferred : ['apollo', 'hunter', 'pdl', 'ai']).map(p => (p === 'anthropic' || p === 'gemini' ? 'ai' : p));
  const all: ContactCandidate[] = []; const used: string[] = []; let pattern: string | null = null;
  for (const p of order) {
    const creds = p === 'ai' ? null : await getCreds(admin, p);
    if (p === 'ai' ? !(await aiAvailable(admin)) : !creds) continue;
    try {
      if (p === 'apollo') all.push(...(await apolloSearchPeople(creds!.apiKey, q, opts.enrichEmails)).items);
      if (p === 'hunter') { const r = await hunterDomainSearch(creds!.apiKey, q); pattern = r.pattern; all.push(...r.items); }
      if (p === 'pdl') all.push(...(await pdlSearchPeople(creds!.apiKey, q)).items);
      if (p === 'ai') {
        // Use AI web research only when structured providers found too few decision-makers
        const relevantSoFar = all.filter(c => matchesTargets(classifyTitle(c.title), q.departments, q.seniorities)).length;
        if (relevantSoFar >= q.limit) continue;
        const a = await aiFindContacts(admin, q);
        all.push(...a.items);
        used.push(a.aiProvider);
        continue;
      }
      used.push(p);
    } catch (e) { await log('warn', `${p} contact search failed for ${q.companyName}: ${(e as Error).message}`); }
  }
  const merged = mergeContacts(all)
    .map(c => ({ c, cls: classifyTitle(c.title) }))
    .filter(x => matchesTargets(x.cls, q.departments, q.seniorities))
    .sort((a, b) => (a.cls.priority ?? 9) - (b.cls.priority ?? 9) || seniorityRank(a.cls.seniority) - seniorityRank(b.cls.seniority))
    .slice(0, q.limit);

  // Optional verification / pattern inference via Hunter
  const hunter = await getCreds(admin, 'hunter');
  for (const x of merged) {
    if (hunter && opts.enrichEmails && x.c.email && x.c.email_status === 'provider_returned') {
      try { const v = await hunterVerify(hunter.apiKey, x.c.email); x.c.email_status = v.status === 'verified' ? 'verified' : v.status === 'invalid' ? 'invalid' : 'provider_returned'; if (v.status === 'verified') x.c.confidence = 'high'; } catch { /* keep provider status */ }
    }
    if (!x.c.email && pattern) {
      const inferred = inferEmail(pattern, x.c.first_name, x.c.last_name, q.domain);
      if (inferred) { x.c.email = inferred; x.c.email_status = 'inferred_pattern'; x.c.email_confidence = null; }
    }
  }
  return { contacts: merged.map(x => ({ ...x.c, cls: x.cls })), providers: used };
}
const seniorityRank = (s: string) => ['cxo', 'vp', 'director', 'head', 'senior', 'manager', 'other'].indexOf(s);

export async function upsertContact(admin: SupabaseClient, companyId: string, countryCodeVal: string | null, c: ContactCandidate & { cls?: ReturnType<typeof classifyTitle> }, userId: string | null, isDemo = false) {
  const cls = c.cls ?? classifyTitle(c.title);
  const record: Record<string, unknown> = {
    company_id: companyId, full_name: c.full_name, first_name: c.first_name, last_name: c.last_name, title: c.title,
    department: cls.department, seniority: cls.seniority, designation_priority: cls.priority,
    country_code: (await countryCode(admin, c.country_name)) ?? countryCodeVal, city: c.city,
    email: c.email?.toLowerCase() ?? null, email_status: c.email ? c.email_status : 'unavailable',
    email_provider: c.email_status === 'inferred_pattern' ? 'pattern_inference' : c.email ? c.provider : null,
    email_confidence: c.email_confidence, phone: c.phone, phone_source: c.phone ? c.provider : null,
    linkedin_url: c.linkedin_url, bio: c.bio, confidence: c.confidence, data_provider: c.provider, external_id: c.external_id,
    last_verified_at: new Date().toISOString(), is_demo: isDemo,
  };
  const { data: existing } = await admin.rpc('find_contact', { p_company: companyId, p_name: c.full_name, p_email: record.email });
  let id: string;
  if (existing?.[0]) {
    const prev = existing[0];
    const patch: Record<string, unknown> = { last_verified_at: record.last_verified_at, title: record.title ?? prev.title, department: record.department, seniority: record.seniority, designation_priority: record.designation_priority };
    for (const k of ['linkedin_url', 'phone', 'bio', 'city', 'external_id']) if (prev[k] == null && record[k] != null) patch[k] = record[k];
    const rank: Record<string, number> = { verified: 5, provider_returned: 4, unverified: 3, inferred_pattern: 2, unavailable: 1, invalid: 0 };
    if (record.email && rank[record.email_status as string] > rank[prev.email_status]) Object.assign(patch, { email: record.email, email_status: record.email_status, email_provider: record.email_provider, email_confidence: record.email_confidence });
    await admin.from('contacts').update(patch).eq('id', prev.id);
    id = prev.id;
  } else {
    const { data, error } = await admin.from('contacts').insert({ ...record, created_by: userId }).select('id').single();
    if (error) {
      if (error.code === '23505' && record.email) { // email already belongs to another record → store without email
        const { data: d2, error: e2 } = await admin.from('contacts').insert({ ...record, email: null, email_status: 'unavailable', email_provider: null, created_by: userId }).select('id').single();
        if (e2) throw e2; id = d2.id;
      } else throw error;
    } else id = data.id;
  }
  const sources = c.source_urls.length ? c.source_urls : [null];
  await admin.from('contact_sources').upsert(sources.map(url => ({ contact_id: id, url, provider: c.provider, field: 'profile' })), { onConflict: 'contact_id,provider,field,url', ignoreDuplicates: true }).then(() => {}, () => {});
  return id;
}

// ---------------------------------------------------------------- buying signals
const SIGNAL_TYPES = ['leadership_appointment', 'market_expansion', 'product_launch', 'workforce_growth', 'sales_transformation', 'restructuring', 'leadership_programme', 'commercial_excellence', 'distribution_strategy', 'merger_acquisition', 'annual_report_capability', 'sales_conference_academy'];

export async function detectSignals(admin: SupabaseClient, company: { id: string; name: string; domain: string | null; country_code: string | null }, log: Log = noop): Promise<number> {
  if (!(await aiAvailable(admin))) { await log('warn', 'Signal detection skipped: no AI provider (Gemini or Claude) connected'); return 0; }
  const google = await getCreds(admin, 'google_cse');
  const evidence: WebResult[] = [];
  if (google) {
    const qs = [
      `"${company.name}" appoints OR appointed (CHRO OR "sales director" OR "learning" OR "HR director")`,
      `"${company.name}" expansion OR launch OR acquisition OR restructuring`,
      `"${company.name}" "capability building" OR "sales academy" OR "leadership development" OR "commercial excellence"`,
    ];
    for (const q of qs) { try { evidence.push(...await googleSearch(google.apiKey, google.extra.cx, q, { num: 6, dateRestrict: 'y1' })); } catch (e) { await log('warn', `Google search failed: ${(e as Error).message}`); } }
  }
  const sys = `You identify public business signals that may indicate a training opportunity. Use only evidence provided or retrieved by web search in this conversation. Each signal must cite the exact source URL. Frame opportunities as hypotheses, never as facts about what the company needs.`;
  const user = `${WOT_CONTEXT}

Company: ${company.name}${company.domain ? ` (${company.domain})` : ''}.
${evidence.length ? `Search results:\n${evidence.map(e => `- ${e.title} | ${e.url} | ${e.snippet}`).join('\n')}` : 'Search the web for news from the last 12 months.'}
Signal types: ${SIGNAL_TYPES.join(', ')}.
Return ONLY JSON: {"signals":[{"signal_type":"","description":"factual, 1-2 sentences","source_url":"","source_title":"","published_at":"YYYY-MM-DD or null","training_opportunity":"hypothesis","suggested_approach":"","confidence":"high|medium|low"}]} — empty array if nothing relevant.`;
  const res = await aiMessage(admin, sys, user, { webSearch: !evidence.length, maxSearches: 4, maxTokens: 2500 });
  const allowed = [...evidence, ...res.retrieved];
  const parsed = extractJson<{ signals: any[] }>(res.text);
  const signals = filterToRetrieved(parsed.signals ?? [], allowed).filter((s: any) => SIGNAL_TYPES.includes(s.signal_type) && s.description);
  if (signals.length) {
    await admin.from('buying_signals').upsert(signals.map((s: any) => ({
      company_id: company.id, signal_type: s.signal_type, description: s.description, source_url: s.source_url, source_title: s.source_title ?? null,
      published_at: /^\d{4}-\d{2}-\d{2}$/.test(s.published_at ?? '') ? s.published_at : null,
      training_opportunity: s.training_opportunity ?? null, suggested_approach: s.suggested_approach ?? null,
      confidence: ['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium',
    })), { onConflict: 'company_id,source_url,signal_type', ignoreDuplicates: true });
  }
  return signals.length;
}

// ---------------------------------------------------------------- leads & scoring
export async function ensureLead(admin: SupabaseClient, companyId: string, contactId: string | null, campaignId: string | null, userId: string | null, source: string, isDemo = false) {
  let q = admin.from('leads').select('id').eq('company_id', companyId);
  q = contactId ? q.eq('primary_contact_id', contactId) : q.is('primary_contact_id', null);
  const { data: existing } = await q.maybeSingle();
  if (existing) return { id: existing.id as string, created: false };
  const { data, error } = await admin.from('leads').insert({
    company_id: companyId, primary_contact_id: contactId, campaign_id: campaignId, created_by: userId, source,
    stage: contactId ? 'contact_identified' : 'research_pending', is_demo: isDemo,
  }).select('id').single();
  if (error) throw error;
  return { id: data.id as string, created: true };
}

export async function computeLeadScore(admin: SupabaseClient, leadId: string) {
  const [weights, bands] = await Promise.all([
    getSetting<ScoringWeights>(admin, 'scoring_weights', DEFAULT_WEIGHTS),
    getSetting<PriorityBands>(admin, 'priority_bands', DEFAULT_BANDS),
  ]);
  const { data: lead } = await admin.from('leads').select('id, campaign_id, company:companies(*), contact:contacts(*)').eq('id', leadId).single();
  if (!lead) return null;
  const company: any = lead.company; const contact: any = lead.contact;
  const [{ data: ind }, { data: signals }, { count: srcCount }, list, camp] = await Promise.all([
    admin.from('industries').select('relevance').eq('name', company.industry ?? '').maybeSingle(),
    admin.from('buying_signals').select('published_at, confidence').eq('company_id', company.id),
    contact ? admin.from('contact_sources').select('id', { count: 'exact', head: true }).eq('contact_id', contact.id) : Promise.resolve({ count: 0 } as any),
    countries(admin),
    lead.campaign_id ? admin.from('campaigns').select('countries').eq('id', lead.campaign_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ]);
  const result = scoreLead({
    company, industryRelevance: ind?.relevance != null ? Number(ind.relevance) : null,
    contact: contact ? { ...contact, source_count: srcCount ?? 0 } : null,
    signals: signals ?? [], focusCountries: list.filter(c => c.is_focus).map(c => c.code),
    campaignCountries: camp?.data?.countries ?? [],
  }, weights, bands);
  await admin.from('lead_scores').insert({ lead_id: leadId, total: result.total, priority: result.priority, breakdown: result.factors, explanation: result.explanation, weights });
  await admin.from('leads').update({ score: result.total, priority: result.priority }).eq('id', leadId);
  return result;
}
