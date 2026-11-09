// Find decision-makers for one company using connected providers.
import { getContext, handler, json, HttpError, logUsage } from '../_shared/context.ts';
import { findContacts, upsertContact, ensureLead, computeLeadScore, countries, detectSignals } from '../_shared/pipeline.ts';

Deno.serve(handler(async (req, body) => {
  const ctx = await getContext(req);
  const { company_id, departments, seniorities, limit = 5, enrich_emails = false, detect_signals = false } = body;
  if (!company_id) throw new HttpError(400, 'company_id required');
  const { data: company } = await ctx.userClient.from('companies').select('*').eq('id', company_id).single();
  if (!company) throw new HttpError(404, 'Company not found');
  const all = await countries(ctx.admin);
  const logs: { level: string; message: string }[] = [];
  const log = (level: any, message: string) => { logs.push({ level, message }); };
  if (body.signals_only) {
    const n = await detectSignals(ctx.admin, company, log);
    await logUsage(ctx, 'anthropic', 'signal_detection', 1, true, { company: company_id });
    const { data: leads } = await ctx.admin.from('leads').select('id').eq('company_id', company_id);
    for (const l of leads ?? []) await computeLeadScore(ctx.admin, l.id);
    return json({ signals: n, logs });
  }
  const { contacts, providers } = await findContacts(ctx.admin, {
    companyName: company.name, domain: company.domain, externalIds: company.external_ids ?? {},
    departments: departments?.length ? departments : ['learning_development', 'human_resources', 'sales', 'trade_marketing'],
    seniorities: seniorities?.length ? seniorities : ['cxo', 'vp', 'director', 'head'],
    limit: Math.min(15, Math.max(1, Number(limit))), countryName: all.find(c => c.code === company.country_code)?.name ?? null,
  }, { enrichEmails: !!enrich_emails, log });
  for (const p of providers) await logUsage(ctx, p, 'contact_search', 1, true, { company: company_id });
  if (!providers.length && !logs.length) throw new HttpError(412, 'No contact provider is connected (Apollo, Hunter, People Data Labs or Claude). Add contacts manually or connect a provider on the Integrations page.');
  let signals = 0;
  if (detect_signals) { try { signals = await detectSignals(ctx.admin, company, log); } catch (e) { log('warn', (e as Error).message); } }
  const saved: string[] = [];
  for (const c of contacts) {
    const id = await upsertContact(ctx.admin, company.id, company.country_code, c, ctx.user.id, company.is_demo);
    const lead = await ensureLead(ctx.admin, company.id, id, null, ctx.user.id, `find-contacts:${c.provider}`, company.is_demo);
    await computeLeadScore(ctx.admin, lead.id);
    saved.push(id);
  }
  // re-score the company-level placeholder lead if one exists
  const { data: placeholder } = await ctx.admin.from('leads').select('id').eq('company_id', company.id).is('primary_contact_id', null).maybeSingle();
  if (placeholder) {
    if (saved.length) await ctx.admin.from('leads').delete().eq('id', placeholder.id).eq('stage', 'research_pending');
    else await computeLeadScore(ctx.admin, placeholder.id);
  }
  return json({ found: contacts.length, saved: saved.length, providers, signals, logs });
}));
