// Campaign runner: start / pause / resume / cancel / step.
// Each `step` performs ONE real unit of work (a discovery page or one company's enrichment)
// so it fits inside Edge Function limits. The UI calls `step` in a loop while status = running;
// optionally schedule pg_cron to call it server-side with x-cron-secret (see README).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getContext, handler, json, HttpError, logUsage, type Ctx } from '../_shared/context.ts';
import { discoverCompanies, upsertCompany, findContacts, upsertContact, ensureLead, computeLeadScore, detectSignals, countries } from '../_shared/pipeline.ts';
import type { CompanyQuery } from '../_shared/providers/types.ts';

type EventFn = (l: 'info' | 'warn' | 'error' | 'success', m: string, meta?: Record<string, unknown>) => PromiseLike<void>;

Deno.serve(handler(async (req, body) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) return json(await cronTick());
  const ctx = await getContext(req, ['super_admin', 'admin', 'sales_manager', 'sales_executive', 'researcher']);
  const { campaign_id, action } = body as { campaign_id: string; action: 'start' | 'pause' | 'resume' | 'cancel' | 'step' };
  if (!campaign_id || !action) throw new HttpError(400, 'campaign_id and action are required');
  // permission check via RLS: the caller must be able to see this campaign
  const { data: visible } = await ctx.userClient.from('campaigns').select('id').eq('id', campaign_id).maybeSingle();
  if (!visible) throw new HttpError(404, 'Campaign not found');
  const { data: camp } = await ctx.admin.from('campaigns').select('*').eq('id', campaign_id).single();
  const event = eventFor(ctx, campaign_id);

  if (action === 'start' || action === 'resume') {
    if (!['draft', 'paused', 'failed'].includes(camp.status)) throw new HttpError(409, `Cannot ${action} a ${camp.status} campaign`);
    await ctx.admin.from('campaigns').update({ status: 'running', started_at: camp.started_at ?? new Date().toISOString(), last_error: null }).eq('id', campaign_id);
    await event('info', action === 'start' ? 'Campaign started' : 'Campaign resumed', { by: ctx.user.email });
    return json({ status: 'running' });
  }
  if (action === 'pause' || action === 'cancel') {
    const status = action === 'pause' ? 'paused' : 'cancelled';
    await ctx.admin.from('campaigns').update({ status, step_lock_until: null }).eq('id', campaign_id);
    await event('info', `Campaign ${status}`, { by: ctx.user.email });
    return json({ status });
  }
  if (action !== 'step') throw new HttpError(400, 'Unknown action');
  if (camp.status !== 'running') return json({ status: camp.status, done: true });
  return json(await lockedStep(ctx, camp, event));
}));

function eventFor(ctx: Ctx, campaign_id: string, via?: string): EventFn {
  return (level, message, meta = {}) =>
    ctx.admin.from('campaign_events').insert({ campaign_id, level, message, meta: via ? { ...meta, via } : meta }).then(() => {});
}

/** Acquire a short lock (prevents two tabs / cron processing the same campaign at once), then do one step. */
async function lockedStep(ctx: Ctx, camp: any, event: EventFn) {
  const lockUntil = new Date(Date.now() + 150_000).toISOString();
  const { data: locked } = await ctx.admin.from('campaigns').update({ step_lock_until: lockUntil })
    .eq('id', camp.id).eq('status', 'running')
    .or(`step_lock_until.is.null,step_lock_until.lt.${new Date().toISOString()}`).select('id');
  if (!locked?.length) return { status: 'running', busy: true };
  try {
    const result = await step(ctx, camp, event);
    await ctx.admin.from('campaigns').update({ step_lock_until: null }).eq('id', camp.id);
    return result;
  } catch (e) {
    const msg = (e as Error).message;
    await event('error', msg);
    await ctx.admin.from('campaigns').update({ status: (e as any).status === 412 ? 'paused' : 'failed', last_error: msg, step_lock_until: null }).eq('id', camp.id);
    throw new HttpError((e as any).status === 412 ? 412 : 500, msg);
  }
}

async function cronTick() {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: running } = await admin.from('campaigns').select('*').eq('status', 'running').limit(5);
  const results: Record<string, unknown> = {};
  for (const camp of running ?? []) {
    const ownerId = camp.owner_id ?? camp.created_by;
    const { data: owner } = await admin.from('users').select('email, role, is_active').eq('id', ownerId).maybeSingle();
    if (!owner?.is_active) continue;
    const ctx = { admin, userClient: admin, user: { id: ownerId, email: owner.email, role: owner.role } } as Ctx;
    try { results[camp.id] = await lockedStep(ctx, camp, eventFor(ctx, camp.id, 'cron')); } catch (e) { results[camp.id] = { error: (e as Error).message }; }
  }
  return { ticked: Object.keys(results).length, results };
}

async function step(ctx: Ctx, camp: any, event: EventFn) {
  const progress = { companies_found: 0, companies_processed: 0, contacts_found: 0, leads_created: 0, discovery_page: 1, discovery_exhausted: false, signals_found: 0, ...camp.progress };
  const options = { detect_signals: true, enrich_emails: false, providers: [], ...camp.options };
  const save = (p: typeof progress, extra: Record<string, unknown> = {}) => ctx.admin.from('campaigns').update({ progress: p, ...extra }).eq('id', camp.id);

  // ---- Phase A: discovery
  const { count: linked } = await ctx.admin.from('campaign_companies').select('id', { count: 'exact', head: true }).eq('campaign_id', camp.id);
  if ((linked ?? 0) < camp.target_companies && !progress.discovery_exhausted) {
    const allCountries = await countries(ctx.admin);
    const { data: inds } = await ctx.admin.from('industries').select('name, keywords, segment').eq('is_active', true);
    const chosen = (inds ?? []).filter(i => camp.industries.length ? camp.industries.includes(i.name) : camp.segments.includes(i.segment));
    const q: CompanyQuery = {
      segments: camp.segments, industries: chosen.map(i => i.name), industryKeywords: [...new Set(chosen.flatMap(i => i.keywords))],
      countries: allCountries.filter(c => camp.countries.includes(c.code)), cities: camp.cities ?? [],
      minEmployees: camp.min_employees, maxEmployees: camp.max_employees, page: progress.discovery_page, perPage: 25,
    };
    if (!q.countries.length) throw Object.assign(new Error('Campaign has no countries selected'), { status: 412 });
    await event('info', `Searching companies — page ${q.page}`);
    const r = await discoverCompanies(ctx.admin, q, options.providers, event);
    await logUsage(ctx, r.provider, 'company_search', 1, true, { campaign: camp.id, results: r.items.length });
    let added = 0;
    for (const c of r.items) {
      if ((linked ?? 0) + added >= camp.target_companies) break;
      if (camp.min_employees && c.employee_count != null && c.employee_count < camp.min_employees) continue;
      if (camp.countries.length && c.country_code && !camp.countries.includes(c.country_code)) continue;
      const segment = chosen.find(i => i.name.toLowerCase() === (c.industry ?? '').toLowerCase())?.segment ?? (camp.segments.length === 1 ? camp.segments[0] : null);
      const { id } = await upsertCompany(ctx.admin, c, ctx.user.id, segment, camp.is_demo);
      const { error } = await ctx.admin.from('campaign_companies').insert({ campaign_id: camp.id, company_id: id });
      if (!error) added++;
    }
    progress.companies_found = (linked ?? 0) + added;
    progress.discovery_page += 1;
    if (r.exhausted || r.items.length === 0) progress.discovery_exhausted = true;
    await save(progress);
    await event(added ? 'success' : 'info', `Page ${q.page} via ${r.provider}: ${r.items.length} results, ${added} new companies linked${r.exhausted ? ' (provider has no more results)' : ''}`);
    return { status: 'running', phase: 'discovery', progress };
  }

  // ---- Phase B: per-company enrichment
  const { data: next } = await ctx.admin.from('campaign_companies').select('id, company:companies(*)').eq('campaign_id', camp.id).eq('status', 'pending').order('created_at').limit(1).maybeSingle();
  if (!next) {
    await save(progress, { status: 'completed', completed_at: new Date().toISOString() });
    await event('success', `Campaign completed: ${progress.companies_found} companies, ${progress.contacts_found} decision-makers, ${progress.leads_created} leads`);
    return { status: 'completed', done: true, progress };
  }
  const company: any = next.company;
  await ctx.admin.from('campaign_companies').update({ status: 'enriching' }).eq('id', next.id);
  try {
    const allCountries = await countries(ctx.admin);
    const { contacts, providers } = await findContacts(ctx.admin, {
      companyName: company.name, domain: company.domain, externalIds: company.external_ids ?? {},
      departments: camp.departments, seniorities: camp.seniorities, limit: camp.contacts_per_company,
      countryName: allCountries.find(c => c.code === company.country_code)?.name ?? null,
    }, { enrichEmails: options.enrich_emails, log: event });
    for (const p of providers) await logUsage(ctx, p, 'contact_search', 1, true, { company: company.id });
    if (options.detect_signals) {
      try { progress.signals_found += await detectSignals(ctx.admin, company, event); } catch (e) { await event('warn', `Signals for ${company.name} failed: ${(e as Error).message}`); }
    }
    const leadIds: string[] = [];
    for (const c of contacts) {
      const contactId = await upsertContact(ctx.admin, company.id, company.country_code, c, ctx.user.id, camp.is_demo);
      const l = await ensureLead(ctx.admin, company.id, contactId, camp.id, ctx.user.id, `campaign:${camp.name}`, camp.is_demo);
      leadIds.push(l.id); if (l.created) progress.leads_created++;
    }
    if (!contacts.length) {
      const l = await ensureLead(ctx.admin, company.id, null, camp.id, ctx.user.id, `campaign:${camp.name}`, camp.is_demo);
      leadIds.push(l.id); if (l.created) progress.leads_created++;
    }
    for (const id of leadIds) await computeLeadScore(ctx.admin, id);
    progress.contacts_found += contacts.length;
    progress.companies_processed += 1;
    await ctx.admin.from('campaign_companies').update({ status: 'enriched', processed_at: new Date().toISOString() }).eq('id', next.id);
    await save(progress);
    await event(contacts.length ? 'success' : 'warn', `${company.name}: ${contacts.length} decision-maker${contacts.length === 1 ? '' : 's'} found${providers.length ? ` via ${providers.join(', ')}` : ' (no contact provider connected — manual research needed)'}`);
  } catch (e) {
    await ctx.admin.from('campaign_companies').update({ status: 'failed', error: (e as Error).message, processed_at: new Date().toISOString() }).eq('id', next.id);
    progress.companies_processed += 1; await save(progress);
    await event('error', `${company.name}: ${(e as Error).message}`);
  }
  return { status: 'running', phase: 'enrichment', progress };
}
