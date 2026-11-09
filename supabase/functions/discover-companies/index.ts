// Ad-hoc company discovery from the "Discover Companies" page.
// action=search → returns real provider candidates (flags ones already in the DB)
// action=save   → persists selected candidates with dedupe + source attribution
import { getContext, handler, json, HttpError, logUsage } from '../_shared/context.ts';
import { discoverCompanies, upsertCompany, countries, ensureLead, computeLeadScore } from '../_shared/pipeline.ts';
import type { CompanyCandidate } from '../_shared/providers/types.ts';

Deno.serve(handler(async (req, body) => {
  const ctx = await getContext(req);
  if (body.action === 'search') {
    const f = body.filters ?? {};
    const all = await countries(ctx.admin);
    const { data: inds } = await ctx.admin.from('industries').select('name, keywords, segment').eq('is_active', true);
    const segs: string[] = f.segments?.length ? f.segments : ['FMCG', 'FMCD'];
    const chosen = (inds ?? []).filter(i => f.industries?.length ? f.industries.includes(i.name) : segs.includes(i.segment));
    const sel = all.filter(c => (f.countries ?? []).includes(c.code));
    if (!sel.length) throw new HttpError(400, 'Select at least one country');
    const r = await discoverCompanies(ctx.admin, {
      segments: segs, industries: chosen.map(i => i.name), industryKeywords: [...new Set(chosen.flatMap(i => i.keywords))],
      countries: sel, cities: f.cities ?? [], minEmployees: f.min_employees ?? null, maxEmployees: f.max_employees ?? null,
      keyword: f.keyword ?? null, page: f.page ?? 1, perPage: 25,
    }, f.provider ? [f.provider] : undefined);
    await logUsage(ctx, r.provider, 'company_search', 1, true, { results: r.items.length });
    // flag existing
    const domains = r.items.map(i => i.domain).filter(Boolean) as string[];
    const { data: existing } = domains.length ? await ctx.admin.from('companies').select('id, domain').in('domain', domains).eq('is_demo', false) : { data: [] };
    const byDomain = new Map((existing ?? []).map(e => [e.domain, e.id]));
    const filtered = r.items.filter(i => !f.ownership || i.ownership === f.ownership);
    return json({ provider: r.provider, tried: r.tried, exhausted: r.exhausted, items: filtered.map(i => ({ ...i, existing_id: i.domain ? byDomain.get(i.domain) ?? null : null })) });
  }
  if (body.action === 'save') {
    const items: (CompanyCandidate & { segment?: string })[] = body.items ?? [];
    if (!items.length) throw new HttpError(400, 'Nothing to save');
    const { data: inds } = await ctx.admin.from('industries').select('name, segment');
    const out: { id: string; created: boolean; name: string }[] = [];
    for (const c of items.slice(0, 100)) {
      const seg = c.segment ?? inds?.find(i => i.name.toLowerCase() === (c.industry ?? '').toLowerCase())?.segment ?? null;
      const r = await upsertCompany(ctx.admin, c, ctx.user.id, seg);
      const lead = await ensureLead(ctx.admin, r.id, null, null, ctx.user.id, `discover:${c.provider}`);
      await computeLeadScore(ctx.admin, lead.id);
      out.push({ ...r, name: c.name });
    }
    return json({ saved: out });
  }
  throw new HttpError(400, 'action must be search or save');
}));
