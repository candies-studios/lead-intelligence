// Automated outreach engine: enrol → send → poll replies → auto-handle routine replies → queue the rest for approval.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getSetting } from './context.ts';
import { ProviderError } from './http.ts';
import { aiMessage, aiAvailable } from './ai.ts';
import { extractJson, WOT_CONTEXT } from './providers/claude.ts';
import * as gmail from './gmail.ts';
import {
  buildMime, buildFooter, renderTemplate, firstNameOf, nextSendTime, jitter, warmupLimit, COUNTRY_TZ,
  classifyByRules, failedRecipient, stripQuoted, type SequenceStep, type ReplyCategory, type TemplateVars,
} from './mail.ts';
import { unsubscribeUrl } from './unsub.ts';

export interface AutomationSettings {
  enabled: boolean; company_name: string; physical_address: string; booking_link: string;
  send_window_start: string; send_window_end: string; weekdays_only: boolean; default_timezone: string;
  auto_reply_meetings: boolean; auto_reply_not_interested: boolean; min_days_between_touches: number; max_sends_per_tick: number;
}
export const DEFAULT_AUTOMATION: AutomationSettings = {
  enabled: true, company_name: 'World of Trade', physical_address: '', booking_link: '', send_window_start: '09:30', send_window_end: '17:30',
  weekdays_only: true, default_timezone: 'Asia/Kolkata', auto_reply_meetings: true, auto_reply_not_interested: true,
  min_days_between_touches: 3, max_sends_per_tick: 15,
};
export const EARLY_STAGES = ['newly_discovered', 'research_pending', 'qualified', 'contact_identified', 'outreach_pending'];
const OPEN_STAGES = [...EARLY_STAGES, 'first_email_sent', 'linkedin_contacted', 'follow_up_required'];
const SENDABLE = new Set(['verified', 'provider_returned']); // inferred / unverified / invalid are never auto-emailed

export async function loadSettings(db: SupabaseClient): Promise<AutomationSettings> {
  return { ...DEFAULT_AUTOMATION, ...(await getSetting<Partial<AutomationSettings>>(db, 'automation', {})) };
}
const tzFor = (country: string | null | undefined, s: AutomationSettings) => (country && COUNTRY_TZ[country]) || s.default_timezone;
const windowFor = (s: AutomationSettings, country?: string | null) => ({ start: s.send_window_start, end: s.send_window_end, weekdaysOnly: s.weekdays_only, country });

export type Log = (msg: string) => void;
export interface TickResult { enrolled: number; sent: number; tasks: number; received: number; autoReplied: number; drafts: number; errors: string[]; skipped?: string }

// =====================================================================================================
export async function tick(db: SupabaseClient, opts: { now?: Date; log?: Log } = {}): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const res: TickResult = { enrolled: 0, sent: 0, tasks: 0, received: 0, autoReplied: 0, drafts: 0, errors: [] };
  const { data: locked } = await db.rpc('acquire_job_lock', { p_name: 'automation', p_seconds: 240 });
  if (!locked) return { ...res, skipped: 'Another automation run is in progress' };
  try {
    const s = await loadSettings(db);
    if (!s.enabled) return { ...res, skipped: 'Automation is switched off in Settings' };
    await pollReplies(db, s, now, res, log);           // replies first, so we never send a follow-up to someone who just answered
    await enrol(db, s, now, res, log);
    await sendDue(db, s, now, res, log);
  } catch (e) {
    res.errors.push((e as Error).message);
  } finally {
    await db.rpc('release_job_lock', { p_name: 'automation' });
  }
  return res;
}

// ------------------------------------------------------------------------------------------- enrol
async function enrol(db: SupabaseClient, s: AutomationSettings, now: Date, res: TickResult, log: Log) {
  const { data: seqs } = await db.from('sequences').select('*, mailbox:mailboxes(id, status)').eq('status', 'active').not('campaign_id', 'is', null);
  for (const seq of seqs ?? []) {
    if (seq.mailbox?.status !== 'connected') continue;
    const st = seq.settings ?? {};
    const allowed: string[] = (st.allowed_email_statuses ?? ['verified']).filter((x: string) => SENDABLE.has(x));
    const since = new Date(now.getTime() - 864e5).toISOString();
    const { count: today } = await db.from('enrollments').select('id', { count: 'exact', head: true }).eq('sequence_id', seq.id).gte('created_at', since);
    let room = Math.max(0, (st.daily_cap ?? 30) - (today ?? 0));
    if (!room) continue;
    let q = db.from('leads').select('id, stage, priority, primary_contact_id, company:companies(country_code), contact:contacts!inner(id, email, email_status, do_not_contact, country_code)')
      .eq('campaign_id', seq.campaign_id).in('stage', EARLY_STAGES).not('primary_contact_id', 'is', null)
      .not('contact.email', 'is', null).eq('contact.do_not_contact', false).in('contact.email_status', allowed.length ? allowed : ['verified'])
      .order('score', { ascending: false, nullsFirst: false }).limit(200);
    if (Array.isArray(st.priorities) && st.priorities.length) q = q.in('priority', st.priorities);
    const { data: leads } = await q;
    for (const l of leads ?? []) {
      if (!room) break;
      const c: any = l.contact;
      // one active sequence per person; never re-enrol into the same sequence
      const { count: existing } = await db.from('enrollments').select('id', { count: 'exact', head: true })
        .eq('contact_id', c.id).or(`status.in.(active,paused),sequence_id.eq.${seq.id}`);
      if (existing) continue;
      if (await isSuppressed(db, c.email)) continue;
      if (await recentlyContacted(db, c.id, c.email, now, 14)) continue;
      const country = c.country_code ?? (l.company as any)?.country_code;
      const at = jitter(nextSendTime(now, tzFor(country, s), windowFor(s, country)), 20);
      const { error } = await db.from('enrollments').insert({ sequence_id: seq.id, lead_id: l.id, contact_id: c.id, mailbox_id: seq.mailbox_id, next_run_at: at.toISOString() });
      if (!error) { res.enrolled++; room--; }
    }
    if (res.enrolled) log(`Enrolled ${res.enrolled} lead(s) into "${seq.name}"`);
  }
}

async function isSuppressed(db: SupabaseClient, email: string) {
  const domain = email.split('@')[1] ?? '';
  const { count } = await db.from('suppression_list').select('id', { count: 'exact', head: true }).or(`email.eq.${email},domain.eq.${domain}`);
  return (count ?? 0) > 0;
}
async function recentlyContacted(db: SupabaseClient, contactId: string, email: string, now: Date, days: number) {
  const since = new Date(now.getTime() - days * 864e5).toISOString();
  const { count: a } = await db.from('email_messages').select('id', { count: 'exact', head: true }).eq('to_email', email).eq('direction', 'outbound').eq('status', 'sent').gte('sent_at', since);
  if (a) return true;
  const { count: b } = await db.from('communications').select('id', { count: 'exact', head: true }).eq('contact_id', contactId).eq('direction', 'outbound').gte('occurred_at', since);
  return (b ?? 0) > 0;
}

// ------------------------------------------------------------------------------------------- send
interface MailboxCtx { id: string; email: string; name: string | null; senderTitle: string | null; signature: string | null; token: string; remaining: number; dead?: boolean }

async function mailboxCtx(db: SupabaseClient, id: string, now: Date, cache: Map<string, MailboxCtx | null>): Promise<MailboxCtx | null> {
  if (cache.has(id)) return cache.get(id)!;
  const { data: mb } = await db.from('mailboxes').select('*').eq('id', id).maybeSingle();
  const { data: sec } = await db.from('mailbox_secrets').select('refresh_token').eq('mailbox_id', id).maybeSingle();
  if (!mb || mb.status === 'disconnected' || !sec) { cache.set(id, null); return null; }
  try {
    const token = await gmail.accessToken(sec.refresh_token);
    const { count } = await db.from('email_messages').select('id', { count: 'exact', head: true }).eq('mailbox_id', id).eq('direction', 'outbound').eq('status', 'sent').gte('sent_at', new Date(now.getTime() - 864e5).toISOString());
    const ctx = { id, email: mb.email, name: mb.display_name, senderTitle: mb.sender_title, signature: mb.signature, token, remaining: Math.max(0, warmupLimit(mb, now) - (count ?? 0)) };
    if (mb.status !== 'connected') await db.from('mailboxes').update({ status: 'connected', last_error: null }).eq('id', id);
    cache.set(id, ctx); return ctx;
  } catch (e) {
    await db.from('mailboxes').update({ status: 'error', last_error: (e as Error).message.slice(0, 400) }).eq('id', id);
    cache.set(id, null); return null;
  }
}

async function sendDue(db: SupabaseClient, s: AutomationSettings, now: Date, res: TickResult, log: Log) {
  const { data: due } = await db.from('enrollments')
    .select('*, sequence:sequences(*), lead:leads(*, company:companies(*)), contact:contacts(*)')
    .eq('status', 'active').lte('next_run_at', now.toISOString()).order('next_run_at').limit(s.max_sends_per_tick * 3);
  const boxes = new Map<string, MailboxCtx | null>();
  let budget = s.max_sends_per_tick;
  for (const en of due ?? []) {
    if (budget <= 0) break;
    const seq = en.sequence, lead = en.lead, c = en.contact, co = lead?.company;
    if (!seq || seq.status !== 'active') continue; // paused / re-approval pending → wait
    const stop = async (status: string, reason: string) => { await db.from('enrollments').update({ status, stop_reason: reason, next_run_at: null }).eq('id', en.id); };
    if (!c || c.do_not_contact || !c.email || !SENDABLE.has(c.email_status)) { await stop('stopped', 'Contact no longer eligible (do-not-contact or email not verified)'); continue; }
    if (!lead || !OPEN_STAGES.includes(lead.stage)) { await stop('stopped', `Lead stage is ${lead?.stage}`); continue; }
    if (await isSuppressed(db, c.email)) { await stop('unsubscribed', 'On suppression list'); continue; }
    const steps: SequenceStep[] = seq.steps ?? [];
    const step = steps[en.current_step];
    if (!step) { await stop('completed', 'All steps done'); continue; }
    const country = c.country_code ?? co?.country_code;
    const tz = tzFor(country, s);

    try {
      if (step.channel === 'email') {
        const mb = await mailboxCtx(db, en.mailbox_id ?? seq.mailbox_id, now, boxes);
        if (!mb || mb.dead) continue;
        if (mb.remaining <= 0) continue; // daily warm-up cap reached; try next tick/day
        // spacing between touches from ANY sequence/person
        const { data: last } = await db.from('email_messages').select('sent_at').eq('to_email', c.email).eq('direction', 'outbound').eq('status', 'sent').order('sent_at', { ascending: false }).limit(1).maybeSingle();
        if (last?.sent_at && now.getTime() - new Date(last.sent_at).getTime() < s.min_days_between_touches * 864e5 * (en.current_step === 0 ? 1 : 0.5)) {
          await db.from('enrollments').update({ next_run_at: jitter(nextSendTime(new Date(new Date(last.sent_at).getTime() + s.min_days_between_touches * 864e5), tz, windowFor(s, country)), 30).toISOString() }).eq('id', en.id);
          continue;
        }
        const vars = await buildVars(db, en, seq, lead, c, co, mb, s);
        const body = renderTemplate(step.body, vars).text;
        const subject = step.subject?.trim()
          ? renderTemplate(step.subject, vars).text
          : (en.first_subject ? (/^re:/i.test(en.first_subject) ? en.first_subject : `Re: ${en.first_subject}`) : renderTemplate(steps[0].subject ?? 'Quick question', vars).text);
        if (/\{\{|\}\}/.test(body + subject)) throw new Error('Template still contains unfilled placeholders');
        const unsub = await unsubscribeUrl(c.id, en.id);
        const text = body + buildFooter({ senderName: vars.sender_name, senderTitle: vars.sender_title, company: s.company_name, signature: mb.signature, physicalAddress: s.physical_address, unsubscribeUrl: unsub, body });
        const domain = mb.email.split('@')[1];
        const raw = buildMime({
          from: { name: vars.sender_name || mb.name, email: mb.email }, to: c.email, subject, text,
          messageId: `<${crypto.randomUUID()}@${domain}>`, inReplyTo: en.thread_id ? en.last_rfc_message_id : null,
          listUnsubscribeUrl: unsub, listUnsubscribeMailto: `mailto:${mb.email}?subject=unsubscribe`, date: now,
        });
        const sent = await gmail.sendRaw(mb.token, raw, en.thread_id);
        const rfc = await gmail.messageIdHeader(mb.token, sent.id).catch(() => null);
        mb.remaining--; budget--; res.sent++;
        await db.from('email_messages').insert({
          mailbox_id: mb.id, lead_id: lead.id, contact_id: c.id, enrollment_id: en.id, direction: 'outbound', status: 'sent', kind: 'sequence',
          step: en.current_step, gmail_id: sent.id, thread_id: sent.threadId, rfc_message_id: rfc, in_reply_to: en.last_rfc_message_id,
          from_email: mb.email, to_email: c.email, subject, body_text: text, sent_at: now.toISOString(),
        });
        await db.from('communications').insert({ lead_id: lead.id, contact_id: c.id, channel: 'email', direction: 'outbound', subject, summary: body.slice(0, 2000), occurred_at: now.toISOString(), created_by: seq.created_by, outcome: `Automated: ${seq.name}, step ${en.current_step + 1}` });
        if (EARLY_STAGES.includes(lead.stage)) await db.from('leads').update({ stage: 'first_email_sent' }).eq('id', lead.id);
        await db.from('enrollments').update({ thread_id: sent.threadId, last_rfc_message_id: rfc ?? en.last_rfc_message_id, first_subject: en.first_subject ?? subject, vars: { ...en.vars, personal_line: vars.personal_line ?? '' } }).eq('id', en.id);
        log(`Sent step ${en.current_step + 1} to ${c.email}`);
      } else {
        // LinkedIn / WhatsApp steps become to-dos with the message pre-written (these channels are not automated on purpose)
        const vars = await buildVars(db, en, seq, lead, c, co, null, s);
        const msg = renderTemplate(step.body, vars).text;
        const label = step.channel === 'linkedin_task' ? 'LinkedIn' : 'WhatsApp';
        await db.from('follow_ups').insert({
          lead_id: lead.id, title: `${label}: message ${c.full_name}${step.channel === 'linkedin_task' && c.linkedin_url ? '' : ''}`,
          notes: `${c.linkedin_url && step.channel === 'linkedin_task' ? c.linkedin_url + '\n\n' : ''}${msg}`, due_at: now.toISOString(),
          assigned_to: lead.assigned_to ?? seq.created_by, created_by: seq.created_by,
        });
        res.tasks++;
      }
      // advance
      const next = steps[en.current_step + 1];
      if (!next) await db.from('enrollments').update({ current_step: en.current_step + 1, status: 'completed', next_run_at: null, stop_reason: 'Sequence finished' }).eq('id', en.id);
      else {
        const target = new Date(now.getTime() + Math.max(1, next.day - step.day) * 864e5);
        await db.from('enrollments').update({ current_step: en.current_step + 1, next_run_at: jitter(nextSendTime(target, tz, windowFor(s, country)), 30).toISOString() }).eq('id', en.id);
      }
    } catch (e) {
      const msg = (e as Error).message;
      res.errors.push(`${c.email}: ${msg}`);
      if (e instanceof ProviderError && e.status === 401) {
        await db.from('mailboxes').update({ status: 'error', last_error: msg.slice(0, 400) }).eq('id', en.mailbox_id);
        const mb = boxes.get(en.mailbox_id); if (mb) mb.dead = true;
      } else if (e instanceof ProviderError && (e.status === 429 || e.status >= 500)) {
        const mb = boxes.get(en.mailbox_id); if (mb) mb.dead = true; // back off this mailbox until next tick
      } else {
        await db.from('enrollments').update({ status: 'failed', stop_reason: msg.slice(0, 300), next_run_at: null }).eq('id', en.id);
        await db.from('email_messages').insert({ mailbox_id: en.mailbox_id, lead_id: lead.id, contact_id: c.id, enrollment_id: en.id, direction: 'outbound', status: 'failed', kind: 'sequence', step: en.current_step, to_email: c.email, error: msg.slice(0, 500), needs_attention: true });
      }
    }
  }
}

async function buildVars(db: SupabaseClient, en: any, seq: any, lead: any, c: any, co: any, mb: MailboxCtx | null, s: AutomationSettings): Promise<TemplateVars> {
  const st = seq.settings ?? {};
  const link = st.booking_link || s.booking_link;
  let personal = en.vars?.personal_line as string | undefined;
  if (personal === undefined && en.current_step === 0) personal = await personalLine(db, c, co).catch(() => '');
  return {
    first_name: firstNameOf(c.full_name, c.first_name) || 'there', last_name: c.last_name ?? '', full_name: c.full_name,
    title: c.title ?? '', company: co?.name ?? '', industry: (co?.industry ?? co?.industry_segment ?? 'similar').toString(), country: co?.country_code ?? '',
    personal_line: personal ?? '', sender_name: st.sender_name || mb?.name || '', sender_title: st.sender_title || mb?.senderTitle || '',
    booking_link: link ? `\n\nIf easier, you can pick a time here: ${link}` : '',
  };
}

/** One or two grounded opening sentences; empty when research has nothing specific. */
async function personalLine(db: SupabaseClient, c: any, co: any): Promise<string> {
  if (!co || !(await aiAvailable(db))) return '';
  const [{ data: rep }, { data: sig }] = await Promise.all([
    db.from('research_reports').select('report').eq('company_id', co.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('buying_signals').select('signal_type, description, published_at').eq('company_id', co.id).order('published_at', { ascending: false, nullsFirst: false }).limit(4),
  ]);
  const facts = { company: co.name, industry: co.industry, description: co.description, recipient_title: c.title, research: rep?.report?.overview?.text ?? null, initiatives: rep?.report?.initiatives?.items ?? [], signals: sig ?? [] };
  if (!facts.research && !(sig ?? []).length && !co.description) return '';
  const r = await aiMessage(db, 'You write the opening line of a B2B email. Use ONLY the FACTS. Never invent news, numbers or claims. No flattery clichés. If nothing specific and recent is in FACTS, return an empty line.',
    `${WOT_CONTEXT}\nFACTS: ${JSON.stringify(facts)}\nReturn ONLY JSON: {"line":"one or two sentences referencing a specific fact relevant to sales/channel capability, or empty string"}`, { maxTokens: 400 });
  const line = String(extractJson<{ line?: string }>(r.text).line ?? '').trim();
  return line.length > 400 ? '' : line;
}

// ------------------------------------------------------------------------------------------- replies
async function pollReplies(db: SupabaseClient, s: AutomationSettings, now: Date, res: TickResult, log: Log) {
  const { data: boxes } = await db.from('mailboxes').select('*').eq('status', 'connected');
  for (const mb of boxes ?? []) {
    const { data: sec } = await db.from('mailbox_secrets').select('refresh_token').eq('mailbox_id', mb.id).maybeSingle();
    if (!sec) continue;
    let token: string;
    try { token = await gmail.accessToken(sec.refresh_token); }
    catch (e) { await db.from('mailboxes').update({ status: 'error', last_error: (e as Error).message.slice(0, 400) }).eq('id', mb.id); res.errors.push(`${mb.email}: ${(e as Error).message}`); continue; }
    try {
      const { ids, historyId } = await gmail.newInboxMessageIds(token, mb.history_id);
      for (const id of ids.slice(0, 25)) {
        const { count } = await db.from('email_messages').select('id', { count: 'exact', head: true }).eq('mailbox_id', mb.id).eq('gmail_id', id);
        if (count) continue;
        const m = await gmail.getMessage(token, id);
        if (m.fromEmail === mb.email) continue;
        await handleInbound(db, s, mb, token, m, now, res, log);
      }
      await db.from('mailboxes').update({ history_id: historyId, last_polled_at: now.toISOString() }).eq('id', mb.id);
    } catch (e) {
      res.errors.push(`${mb.email} inbox: ${(e as Error).message}`);
    }
  }
}

export async function handleInbound(db: SupabaseClient, s: AutomationSettings, mb: any, token: string, m: gmail.ParsedMessage, now: Date, res: TickResult, log: Log) {
  // Match to a prospect: by thread first, then sender address, then bounce recipient. Unrelated mail is ignored (never stored).
  const { data: enByThread } = await db.from('enrollments').select('*, sequence:sequences(*), lead:leads(*, company:companies(*)), contact:contacts(*)').eq('thread_id', m.threadId).limit(1).maybeSingle();
  let en: any = enByThread;
  const rules = classifyByRules({ from: m.from, subject: m.subject, body: m.body, headers: m.headers }, now);
  let contact: any = en?.contact ?? null;
  if (!contact && rules?.category === 'bounce') {
    const failed = failedRecipient({ from: m.from, subject: m.subject, body: m.body, headers: m.headers });
    if (failed) contact = (await db.from('contacts').select('*').eq('email', failed).limit(1).maybeSingle()).data;
  }
  if (!contact && m.fromEmail) contact = (await db.from('contacts').select('*').eq('email', m.fromEmail).limit(1).maybeSingle()).data;
  if (!contact) return; // not a prospect
  if (!en) en = (await db.from('enrollments').select('*, sequence:sequences(*), lead:leads(*, company:companies(*)), contact:contacts(*)').eq('contact_id', contact.id).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  let lead: any = en?.lead;
  if (!lead) lead = (await db.from('leads').select('*, company:companies(*)').eq('primary_contact_id', contact.id).limit(1).maybeSingle()).data;
  if (!lead) return;
  res.received++;

  const fresh = stripQuoted(m.body);
  let category: ReplyCategory = rules?.category ?? 'needs_review';
  let summary = '', returnDate = rules?.returnDate ?? null, draft = '', referral: any = null;
  if (!rules && await aiAvailable(db)) {
    try {
      const r = await aiMessage(db,
        'You triage B2B sales email replies for World of Trade. Classify accurately; never assume interest that is not stated. Draft replies must be short, warm, specific to what they wrote, and must not promise prices, dates, discounts or outcomes.',
        `${WOT_CONTEXT}\nPROSPECT: ${contact.full_name}, ${contact.title ?? ''} at ${lead.company?.name ?? ''}\nTHEIR REPLY:\n"""${fresh.slice(0, 4000)}"""\n` +
        `Return ONLY JSON: {"category":"meeting_request|interested|question|not_interested|referral|unsubscribe|out_of_office|other","summary":"one sentence","return_date":"YYYY-MM-DD or null","referral":{"name":null,"email":null,"title":null},"reply":"email body (no subject, no signature) or empty"}`,
        { maxTokens: 900 });
      const j = extractJson<any>(r.text);
      const allowed: ReplyCategory[] = ['meeting_request', 'interested', 'question', 'not_interested', 'referral', 'unsubscribe', 'out_of_office', 'other'];
      category = allowed.includes(j.category) ? j.category : 'needs_review';
      summary = String(j.summary ?? '').slice(0, 500); returnDate = j.return_date ?? null; draft = String(j.reply ?? '').trim(); referral = j.referral;
    } catch (e) { summary = `AI triage unavailable: ${(e as Error).message.slice(0, 160)}`; }
  }
  if (!summary) summary = ({ bounce: 'Email bounced', out_of_office: `Out of office${returnDate ? ` until ${returnDate}` : ''}`, unsubscribe: 'Asked not to be contacted', needs_review: 'Needs a person to read' } as Record<string, string>)[category] ?? '';

  const humanNeeded = ['question', 'referral', 'other', 'needs_review'].includes(category);
  const { data: inbound } = await db.from('email_messages').insert({
    mailbox_id: mb.id, lead_id: lead.id, contact_id: contact.id, enrollment_id: en?.id ?? null, direction: 'inbound', status: 'received', kind: 'inbound',
    gmail_id: m.id, thread_id: m.threadId, rfc_message_id: m.messageId, in_reply_to: m.inReplyTo, from_email: m.fromEmail, to_email: mb.email,
    subject: m.subject, body_text: m.body.slice(0, 20000), classification: category, ai_summary: summary, needs_attention: humanNeeded,
    received_at: m.date ? new Date(m.date).toISOString() : now.toISOString(),
  }).select('id').single();
  if (category !== 'bounce' && category !== 'out_of_office') {
    await db.from('communications').insert({ lead_id: lead.id, contact_id: contact.id, channel: 'email', direction: 'inbound', subject: m.subject, summary: `${summary}\n\n${fresh.slice(0, 1500)}`, outcome: category.replace(/_/g, ' '), occurred_at: now.toISOString() });
  }
  const owner = lead.assigned_to ?? en?.sequence?.created_by ?? null;
  const setStage = async (stage: string, extra: Record<string, unknown> = {}) => { if (OPEN_STAGES.includes(lead.stage) || stage === 'not_relevant') await db.from('leads').update({ stage, ...extra }).eq('id', lead.id); };
  const stopEn = async (status: string, reason: string) => { if (en && ['active', 'paused'].includes(en.status)) await db.from('enrollments').update({ status, stop_reason: reason, next_run_at: null }).eq('id', en.id); };
  const task = (title: string, notes: string, hours = 0) => db.from('follow_ups').insert({ lead_id: lead.id, title, notes, due_at: new Date(now.getTime() + hours * 3600e3).toISOString(), assigned_to: owner, created_by: owner });
  const first = firstNameOf(contact.full_name, contact.first_name) || 'there';
  const sender = en?.sequence?.settings?.sender_name || mb.display_name || '';
  const link = en?.sequence?.settings?.booking_link || s.booking_link;
  let action = '';

  switch (category) {
    case 'bounce':
      await db.from('contacts').update({ email_status: 'invalid' }).eq('id', contact.id);
      await stopEn('bounced', 'Email bounced');
      action = 'Marked email invalid; sequence stopped';
      break;
    case 'out_of_office': {
      const back = returnDate ? new Date(returnDate + 'T00:00:00Z') : new Date(now.getTime() + 7 * 864e5);
      if (en?.status === 'active') {
        const country = contact.country_code ?? lead.company?.country_code;
        await db.from('enrollments').update({ next_run_at: nextSendTime(new Date(Math.max(back.getTime() + 864e5, now.getTime())), tzFor(country, s), windowFor(s, country)).toISOString() }).eq('id', en.id);
      }
      action = `Paused sequence until ${back.toISOString().slice(0, 10)}`;
      break;
    }
    case 'unsubscribe':
      await db.from('suppression_list').upsert({ email: contact.email, reason: 'unsubscribed', notes: 'Asked by email reply' }, { onConflict: 'email', ignoreDuplicates: true });
      await db.from('contacts').update({ do_not_contact: true, consent_status: 'unsubscribed' }).eq('id', contact.id);
      await stopEn('unsubscribed', 'Asked to stop by reply');
      await setStage('not_relevant');
      action = 'Added to suppression list; sequence stopped';
      break;
    case 'not_interested':
      await stopEn('replied', 'Not interested');
      await setStage('lost', { lost_reason: 'Not interested (email reply)' });
      if (s.auto_reply_not_interested) {
        await sendReply(db, mb, token, m, lead, contact, en, `Hi ${first},\n\nThank you for letting me know — I won't follow up further. If commercial or channel capability comes back onto the agenda, I'd be glad to help.\n\nWishing you and the team a great quarter.\n\n${sender}`, 'auto_reply', now);
        res.autoReplied++; action = 'Polite close sent; lead marked lost';
      } else action = 'Lead marked lost';
      break;
    case 'meeting_request':
    case 'interested':
      await stopEn('replied', category === 'meeting_request' ? 'Wants a meeting' : 'Interested');
      await setStage('follow_up_required');
      if (s.auto_reply_meetings && link) {
        const body = (draft && draft.length > 40 ? draft : `Hi ${first},\n\nThank you — great to hear. The easiest way is to pick a slot that suits you here: ${link}\n\nIf none of those times work, just reply with two or three options and I'll make it happen.`)
          + (draft && !draft.includes(link) ? `\n\nYou can pick a time that suits you here: ${link}` : '') + `\n\n${sender}`;
        await sendReply(db, mb, token, m, lead, contact, en, body, 'auto_reply', now);
        res.autoReplied++; action = 'Booking link sent automatically';
        await task('Interested prospect — confirm the meeting is booked', `${contact.full_name}: ${summary}`, 24);
      } else {
        await queueDraft(db, mb, m, lead, contact, en, draft || `Hi ${first},\n\nThank you — great to hear. Could you share two or three times that suit you for a 20-minute call?\n\n${sender}`, inbound?.id);
        res.drafts++; action = link ? 'Draft queued for approval' : 'Draft queued (no booking link set)';
        await task('Interested prospect — approve reply in Inbox', `${contact.full_name}: ${summary}`);
      }
      break;
    default: // question, referral, other, needs_review
      await stopEn('replied', 'Replied');
      await setStage('follow_up_required');
      if (draft) { await queueDraft(db, mb, m, lead, contact, en, `${draft}\n\n${sender}`, inbound?.id); res.drafts++; }
      action = draft ? 'Reply drafted — awaiting your approval' : 'Needs a person to reply';
      await task(category === 'referral' ? `Referral from ${contact.full_name}${referral?.name ? ` → ${referral.name}` : ''}` : `Reply from ${contact.full_name} needs a response`,
        `${summary}${referral?.email ? `\nReferred: ${referral.name ?? ''} ${referral.title ?? ''} <${referral.email}>` : ''}\nOpen the Inbox to approve or edit the drafted reply.`);
  }
  if (inbound?.id) await db.from('email_messages').update({ auto_action: action }).eq('id', inbound.id);
  log(`${contact.email}: ${category} → ${action}`);
}

async function queueDraft(db: SupabaseClient, mb: any, m: gmail.ParsedMessage, lead: any, contact: any, en: any, body: string, inboundId?: string) {
  await db.from('email_messages').insert({
    mailbox_id: mb.id, lead_id: lead.id, contact_id: contact.id, enrollment_id: en?.id ?? null, direction: 'outbound', status: 'pending_approval', kind: 'approved_reply',
    thread_id: m.threadId, in_reply_to: m.messageId, from_email: mb.email, to_email: contact.email,
    subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, body_text: body, needs_attention: true, ai_summary: inboundId ?? null,
  });
}

export async function sendReply(db: SupabaseClient, mb: any, token: string, m: { threadId: string; messageId: string | null; subject: string; references?: string | null }, lead: any, contact: any, en: any, body: string, kind: 'auto_reply' | 'approved_reply' | 'manual', now: Date, approvedBy?: string) {
  const subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
  const unsub = await unsubscribeUrl(contact.id, en?.id ?? null);
  const raw = buildMime({
    from: { name: mb.display_name, email: mb.email }, to: contact.email, subject, text: body, date: now,
    messageId: `<${crypto.randomUUID()}@${mb.email.split('@')[1]}>`, inReplyTo: m.messageId, references: [m.references, m.messageId].filter(Boolean).join(' ') || null,
    listUnsubscribeUrl: unsub, listUnsubscribeMailto: `mailto:${mb.email}?subject=unsubscribe`,
  });
  const sent = await gmail.sendRaw(token, raw, m.threadId);
  await db.from('email_messages').insert({
    mailbox_id: mb.id, lead_id: lead.id, contact_id: contact.id, enrollment_id: en?.id ?? null, direction: 'outbound', status: 'sent', kind,
    gmail_id: sent.id, thread_id: sent.threadId, in_reply_to: m.messageId, from_email: mb.email, to_email: contact.email, subject, body_text: body,
    sent_at: now.toISOString(), approved_by: approvedBy ?? null,
  });
  await db.from('communications').insert({ lead_id: lead.id, contact_id: contact.id, channel: 'email', direction: 'outbound', subject, summary: body.slice(0, 2000), outcome: kind === 'auto_reply' ? 'Automatic reply' : 'Approved reply', occurred_at: now.toISOString(), created_by: approvedBy ?? null });
  return sent;
}

// ------------------------------------------------------------------------------------------- sequence generation
export async function generateSequence(db: SupabaseClient, campaign: any): Promise<{ steps: SequenceStep[]; source: 'ai' | 'default'; note?: string }> {
  const { DEFAULT_SEQUENCE, validateSteps } = await import('./mail.ts');
  if (!(await aiAvailable(db))) return { steps: DEFAULT_SEQUENCE, source: 'default', note: 'No AI provider connected — loaded the standard sequence.' };
  try {
    const r = await aiMessage(db,
      'You write concise, credible B2B email sequences. No fabricated facts, clients, statistics or testimonials. No unsubscribe text (added automatically). Plain text, no markdown.',
      `${WOT_CONTEXT}\nCAMPAIGN: ${JSON.stringify({ name: campaign.name, sectors: campaign.segments, industries: campaign.industries, countries: campaign.countries, functions: campaign.departments, seniorities: campaign.seniorities })}
Write a 4-step sequence: email (day 0), follow-up email (day 3-5, reply in thread so no subject), LinkedIn connection note under 280 characters (day 6-7, channel "linkedin_task"), final short email (day 10-14).
Use ONLY these placeholders: {{first_name}} {{company}} {{title}} {{industry}} {{personal_line}} {{sender_name}} {{booking_link}}. Put {{personal_line}} on its own line after the greeting in step 1. Append {{booking_link}} at the end of the call-to-action sentence in steps 1 and 4.
Return ONLY JSON: {"steps":[{"day":0,"channel":"email","subject":"...","body":"..."},{"day":4,"channel":"email","body":"..."},{"day":6,"channel":"linkedin_task","body":"..."},{"day":11,"channel":"email","body":"..."}]}`,
      { maxTokens: 2500 });
    const steps = extractJson<{ steps: SequenceStep[] }>(r.text).steps;
    const errs = validateSteps(steps);
    if (errs.length) return { steps: DEFAULT_SEQUENCE, source: 'default', note: `AI draft failed checks (${errs[0]}); loaded the standard sequence instead.` };
    return { steps, source: 'ai' };
  } catch (e) {
    return { steps: DEFAULT_SEQUENCE, source: 'default', note: `AI unavailable (${(e as Error).message.slice(0, 120)}); loaded the standard sequence.` };
  }
}
