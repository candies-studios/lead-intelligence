// "Generate AI Company Intelligence Report" — grounded in retrieved information only.
import { getContext, handler, json, HttpError, logUsage } from '../_shared/context.ts';
import { getClaudeConfig } from '../_shared/ai.ts';
import { getCreds } from '../_shared/secrets.ts';
import { claudeMessage, extractJson, wasRetrieved, WOT_CONTEXT } from '../_shared/providers/claude.ts';
import { readWebsite } from '../_shared/providers/website.ts';
import { googleSearch } from '../_shared/providers/google.ts';
import type { WebResult } from '../_shared/providers/types.ts';
import { computeLeadScore } from '../_shared/pipeline.ts';

Deno.serve(handler(async (req, body) => {
  const ctx = await getContext(req);
  const { company_id } = body;
  const { data: company } = await ctx.userClient.from('companies').select('*').eq('id', company_id).single();
  if (!company) throw new HttpError(404, 'Company not found');
  const cfg = (await getClaudeConfig(ctx.admin))!;

  const [{ data: contacts }, { data: signals }, { data: sources }, { data: brands }] = await Promise.all([
    ctx.admin.from('contacts').select('id, full_name, title, department, seniority, email_status, linkedin_url, confidence').eq('company_id', company_id),
    ctx.admin.from('buying_signals').select('*').eq('company_id', company_id).order('published_at', { ascending: false }),
    ctx.admin.from('company_sources').select('url, title, source_type, excerpt').eq('company_id', company_id),
    ctx.admin.from('company_brands').select('brand_name, category').eq('company_id', company_id),
  ]);

  // Gather evidence
  const evidence: (WebResult & { text?: string })[] = [];
  const site = company.website ? await readWebsite(company.website) : null;
  if (site) {
    evidence.push({ url: site.url, title: site.title ?? company.name, snippet: site.text.slice(0, 4000), provider: 'website' });
    await ctx.admin.from('company_sources').upsert({ company_id, url: site.url, title: site.title, source_type: 'website', provider: 'website', excerpt: site.text.slice(0, 500) }, { onConflict: 'company_id,url' });
  }
  const google = await getCreds(ctx.admin, 'google_cse');
  if (google) {
    for (const q of [`"${company.name}" annual report talent OR capability OR leadership`, `"${company.name}" news ${new Date().getFullYear()}`]) {
      try { evidence.push(...await googleSearch(google.apiKey, google.extra.cx, q, { num: 6 })); } catch { /* optional */ }
    }
  }
  for (const s of sources ?? []) evidence.push({ url: s.url, title: s.title ?? s.url, snippet: s.excerpt ?? '', provider: 'stored_source' });
  for (const s of signals ?? []) evidence.push({ url: s.source_url, title: s.source_title ?? s.signal_type, snippet: s.description, provider: 'stored_signal', published: s.published_at });

  const sys = `You are a senior B2B sales-intelligence analyst for World of Trade. Write ONLY from the evidence supplied and pages you retrieve with web search in this conversation.
Rules: never invent facts, names, numbers or quotes; if something isn't supported, say "Not found in available sources". Business challenges and training needs are HYPOTHESES — label them so.
Every factual section must list the source URLs it relies on. Recommended contacts must be chosen from the supplied contact list only (by id).`;
  const user = `${WOT_CONTEXT}

COMPANY RECORD (from database): ${JSON.stringify({ name: company.name, website: company.website, industry: company.industry, segment: company.industry_segment, country: company.country_code, hq_city: company.hq_city, employees: company.employee_count, revenue: company.revenue_text ?? company.revenue_usd, ownership: company.ownership, parent: company.parent_company_name, description: company.description })}
KNOWN BRANDS: ${JSON.stringify(brands ?? [])}
IDENTIFIED CONTACTS: ${JSON.stringify(contacts ?? [])}
EVIDENCE:
${evidence.map((e, i) => `[${i + 1}] ${e.title} — ${e.url}${e.published ? ` (${e.published})` : ''}\n${(e.snippet ?? '').slice(0, 1500)}`).join('\n\n') || '(none stored — use web search)'}

Produce ONLY JSON with this shape:
{"overview":{"text":"","sources":[]},
 "market_position":{"text":"","sources":[]},
 "brands_and_categories":{"items":[{"brand":"","category":""}],"sources":[]},
 "size_and_footprint":{"text":"","sources":[]},
 "business_challenges":{"items":[{"hypothesis":"","evidence":"","source":""}]},
 "decision_makers":{"text":"summary of identified contacts"},
 "initiatives":{"items":[{"initiative":"","date":null,"source":""}]},
 "training_use_cases":{"items":[{"use_case":"","why":"","audience":""}]},
 "recommended_first_contact":{"contact_id":null,"reason":""},
 "opening_conversation":"2-4 sentences, specific, no fabricated claims",
 "confidence":{"overall":"high|medium|low","notes":""},
 "new_brands":[{"brand":"","category":"","source":""}]}`;

  const res = await claudeMessage({ ...cfg, maxTokens: 5000 }, sys, user, { webSearch: true, maxSearches: evidence.length > 3 ? 3 : 6 });
  await logUsage(ctx, 'anthropic', 'company_research', (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0), true, { company: company_id });
  const report = extractJson<any>(res.text);
  const allowed = [...evidence, ...res.retrieved];
  // strip any citation that wasn't actually retrieved
  const clean = (arr?: string[]) => (arr ?? []).filter(u => wasRetrieved(u, allowed));
  for (const k of ['overview', 'market_position', 'brands_and_categories', 'size_and_footprint']) if (report[k]) report[k].sources = clean(report[k].sources);
  for (const k of ['business_challenges', 'initiatives']) if (report[k]?.items) report[k].items = report[k].items.filter((i: any) => wasRetrieved(i.source, allowed));
  if (report.recommended_first_contact?.contact_id && !(contacts ?? []).some(c => c.id === report.recommended_first_contact.contact_id)) report.recommended_first_contact.contact_id = null;
  for (const b of (report.new_brands ?? []).filter((b: any) => b.brand && wasRetrieved(b.source, allowed)))
    await ctx.admin.from('company_brands').insert({ company_id, brand_name: b.brand, category: b.category ?? null, source_url: b.source }).then(() => {}, () => {});
  delete report.new_brands;
  for (const r of res.retrieved.slice(0, 15))
    await ctx.admin.from('company_sources').upsert({ company_id, url: r.url, title: r.title, source_type: 'web', provider: 'anthropic_web_search' }, { onConflict: 'company_id,url', ignoreDuplicates: true });

  const usedSources = [...new Map(allowed.map(a => [a.url, { url: a.url, title: a.title, provider: a.provider }])).values()];
  const { data: saved, error } = await ctx.admin.from('research_reports').insert({ company_id, report, sources: usedSources, model: cfg.model, created_by: ctx.user.id }).select('*').single();
  if (error) throw error;
  await ctx.admin.from('companies').update({ last_verified_at: new Date().toISOString() }).eq('id', company_id);
  const { data: leads } = await ctx.admin.from('leads').select('id').eq('company_id', company_id);
  for (const l of leads ?? []) await computeLeadScore(ctx.admin, l.id);
  return json({ report: saved });
}));
