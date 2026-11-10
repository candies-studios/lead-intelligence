// Automated outreach entry point.
//  • Scheduled: pg_cron POSTs {"action":"tick"} with header x-cron-secret every 5 minutes.
//  • From the app (signed-in users): run_now, generate_sequence, approve_sequence, preview, test_send, approve_reply, discard_reply, disconnect_mailbox.
// Deploy with "Verify JWT" OFF (cron has no user token); user actions verify the caller's token themselves.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getContext, json, corsHeaders, HttpError, type Ctx } from '../_shared/context.ts';
import { tick, loadSettings, generateSequence, sendReply, EARLY_STAGES } from '../_shared/automation.ts';
import * as gmail from '../_shared/gmail.ts';
import { renderTemplate, firstNameOf, validateSteps, buildMime, buildFooter, type SequenceStep } from '../_shared/mail.ts';

const MANAGERS = ['super_admin', 'admin', 'sales_manager'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') ?? corsHeaders['Access-Control-Allow-Headers'] } });
  try {
    const body = await req.json().catch(() => ({}));
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
      return json(await tick(admin));
    }
    const ctx = await getContext(req);
    switch (body.action) {
      case 'run_now': {
        if (!MANAGERS.includes(ctx.user.role)) throw new HttpError(403, 'Only managers and admins can run automation manually');
        const logs: string[] = [];
        const r = await tick(ctx.admin, { log: m => logs.push(m) });
        return json({ ...r, logs });
      }
      case 'generate_sequence': {
        const { data: camp } = await ctx.userClient.from('campaigns').select('*').eq('id', body.campaign_id).single();
        if (!camp) throw new HttpError(404, 'Campaign not found');
        return json(await generateSequence(ctx.admin, camp));
      }
      case 'approve_sequence': return json(await approveSequence(ctx, body.sequence_id));
      case 'preview': return json(await preview(ctx, body.sequence_id, body.lead_id, body.step ?? 0));
      case 'test_send': return json(await testSend(ctx, body.sequence_id, body.lead_id));
      case 'approve_reply': return json(await approveReply(ctx, body.message_id, body.body, body.subject));
      case 'discard_reply': {
        await ctx.userClient.from('email_messages').update({ status: 'discarded', needs_attention: false }).eq('id', body.message_id).eq('status', 'pending_approval');
        return json({ ok: true });
      }
      case 'resolve': { // mark an inbound reply as handled
        await ctx.userClient.from('email_messages').update({ needs_attention: false }).eq('id', body.message_id);
        return json({ ok: true });
      }
      case 'disconnect_mailbox': {
        const { data: mb } = await ctx.userClient.from('mailboxes').select('id, user_id').eq('id', body.mailbox_id).single();
        if (!mb || (mb.user_id !== ctx.user.id && !['super_admin', 'admin'].includes(ctx.user.role))) throw new HttpError(403, 'Not allowed');
        await ctx.admin.from('mailbox_secrets').delete().eq('mailbox_id', mb.id);
        await ctx.admin.from('mailboxes').update({ status: 'disconnected', history_id: null }).eq('id', mb.id);
        await ctx.admin.from('sequences').update({ status: 'paused' }).eq('mailbox_id', mb.id).eq('status', 'active');
        return json({ ok: true });
      }
      default: throw new HttpError(400, 'Unknown action');
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : (e as any).status && (e as any).status >= 400 ? (e as any).status : 500);
  }
});

async function approveSequence(ctx: Ctx, id: string) {
  const { data: seq } = await ctx.userClient.from('sequences').select('*, mailbox:mailboxes(status, email), campaign:campaigns(owner_id, created_by)').eq('id', id).single();
  if (!seq) throw new HttpError(404, 'Sequence not found');
  const canApprove = MANAGERS.includes(ctx.user.role) || seq.campaign?.owner_id === ctx.user.id || seq.campaign?.created_by === ctx.user.id;
  if (!canApprove) throw new HttpError(403, 'Only a manager or the campaign owner can approve a sequence');
  const problems = validateSteps(seq.steps as SequenceStep[]);
  if (!seq.mailbox_id || seq.mailbox?.status !== 'connected') problems.push('Choose a connected Gmail mailbox to send from');
  const s = await loadSettings(ctx.admin);
  if (!s.physical_address.trim()) problems.push('Add your company postal address in Settings → Automation (required by anti-spam law in most markets)');
  if (!s.enabled) problems.push('Automation is switched off in Settings → Automation');
  if (problems.length) throw new HttpError(422, problems.join(' • '));
  const { error } = await ctx.userClient.from('sequences').update({ status: 'active', approved_by: ctx.user.id, approved_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new HttpError(403, error.message);
  await ctx.admin.from('audit_logs').insert({ actor_id: ctx.user.id, action: 'approve', entity: 'sequences', entity_id: id, meta: { steps: (seq.steps as any[]).length, mailbox: seq.mailbox?.email } });
  return { ok: true };
}

async function sampleLead(ctx: Ctx, seq: any, leadId?: string) {
  let q = ctx.userClient.from('leads').select('*, company:companies(*), contact:contacts(*)').not('primary_contact_id', 'is', null).limit(1);
  q = leadId ? q.eq('id', leadId) : q.eq('campaign_id', seq.campaign_id).order('score', { ascending: false, nullsFirst: false });
  const { data } = await q.maybeSingle();
  return data;
}

async function preview(ctx: Ctx, sequenceId: string, leadId: string | undefined, stepIdx: number) {
  const { data: seq } = await ctx.userClient.from('sequences').select('*, mailbox:mailboxes(email, display_name, sender_title, signature)').eq('id', sequenceId).single();
  if (!seq) throw new HttpError(404, 'Sequence not found');
  const lead = await sampleLead(ctx, seq, leadId);
  const s = await loadSettings(ctx.admin);
  const steps = seq.steps as SequenceStep[]; const step = steps[stepIdx];
  if (!step) throw new HttpError(400, 'No such step');
  const c = lead?.contact ?? { full_name: 'Anita Rao', first_name: 'Anita', title: 'Head of Sales Capability' };
  const co = lead?.company ?? { name: 'Example Company', industry: 'Consumer Durables' };
  const st = seq.settings ?? {};
  const link = st.booking_link || s.booking_link;
  const vars = {
    first_name: firstNameOf(c.full_name, c.first_name) || 'there', last_name: c.last_name ?? '', full_name: c.full_name, title: c.title ?? '', company: co.name, industry: co.industry ?? co.industry_segment ?? '',
    country: co.country_code ?? '', personal_line: '(A one–two sentence opening based on this company\'s research appears here when available.)',
    sender_name: st.sender_name || seq.mailbox?.display_name || 'Your name', sender_title: st.sender_title || seq.mailbox?.sender_title || '', booking_link: link ? `\n\nIf easier, you can pick a time here: ${link}` : '',
  };
  const body = renderTemplate(step.body, vars).text;
  const subject = step.subject ? renderTemplate(step.subject, vars).text : `Re: ${renderTemplate(steps[0].subject ?? '', vars).text}`;
  const footer = step.channel === 'email' ? buildFooter({ senderName: vars.sender_name, senderTitle: vars.sender_title, company: s.company_name, signature: seq.mailbox?.signature, physicalAddress: s.physical_address || '[Add postal address in Settings → Automation]', unsubscribeUrl: 'https://…/unsubscribe', body }) : '';
  return { to: lead?.contact?.email ?? '(sample recipient)', subject: step.channel === 'email' ? subject : null, body: body + footer, sample: !lead };
}

async function testSend(ctx: Ctx, sequenceId: string, leadId?: string) {
  const { data: seq } = await ctx.userClient.from('sequences').select('*, mailbox:mailboxes(*)').eq('id', sequenceId).single();
  if (!seq?.mailbox) throw new HttpError(400, 'Choose a mailbox first');
  const { data: sec } = await ctx.admin.from('mailbox_secrets').select('refresh_token').eq('mailbox_id', seq.mailbox.id).single();
  if (!sec) throw new HttpError(400, 'Mailbox is not connected');
  const { data: me } = await ctx.admin.from('users').select('email').eq('id', ctx.user.id).single();
  const token = await gmail.accessToken(sec.refresh_token);
  const out: string[] = [];
  for (let i = 0; i < (seq.steps as SequenceStep[]).length; i++) {
    const step = (seq.steps as SequenceStep[])[i];
    const p = await preview(ctx, sequenceId, leadId, i);
    const subject = `[PREVIEW step ${i + 1}${step.channel !== 'email' ? ` — ${step.channel === 'linkedin_task' ? 'LinkedIn to-do' : 'WhatsApp to-do'}` : ''}] ${p.subject ?? ''}`;
    const raw = buildMime({ from: { name: seq.mailbox.display_name, email: seq.mailbox.email }, to: me!.email, subject, text: p.body });
    const sent = await gmail.sendRaw(token, raw);
    await ctx.admin.from('email_messages').insert({ mailbox_id: seq.mailbox.id, direction: 'outbound', status: 'sent', kind: 'test', gmail_id: sent.id, thread_id: sent.threadId, from_email: seq.mailbox.email, to_email: me!.email, subject, body_text: p.body, sent_at: new Date().toISOString() });
    out.push(subject);
  }
  return { sent_to: me!.email, messages: out };
}

async function approveReply(ctx: Ctx, messageId: string, body?: string, subject?: string) {
  const { data: d } = await ctx.userClient.from('email_messages').select('*, lead:leads(*), contact:contacts(*), enrollment:enrollments(*)').eq('id', messageId).single();
  if (!d || d.status !== 'pending_approval') throw new HttpError(409, 'This draft was already handled');
  if (d.contact?.do_not_contact) throw new HttpError(409, 'Contact is on the do-not-contact list');
  const { data: mb } = await ctx.admin.from('mailboxes').select('*').eq('id', d.mailbox_id).single();
  const { data: sec } = await ctx.admin.from('mailbox_secrets').select('refresh_token').eq('mailbox_id', d.mailbox_id).single();
  if (!mb || !sec) throw new HttpError(400, 'The mailbox for this conversation is disconnected — reconnect it first');
  const token = await gmail.accessToken(sec.refresh_token);
  const text = (body ?? d.body_text ?? '').trim();
  if (!text) throw new HttpError(400, 'Reply is empty');
  await sendReply(ctx.admin, mb, token, { threadId: d.thread_id, messageId: d.in_reply_to, subject: subject ?? d.subject ?? '' }, d.lead, d.contact, d.enrollment, text, 'approved_reply', new Date(), ctx.user.id);
  await ctx.admin.from('email_messages').update({ status: 'discarded', needs_attention: false, approved_by: ctx.user.id, error: 'Sent as approved reply' }).eq('id', messageId);
  await ctx.admin.from('email_messages').update({ needs_attention: false }).eq('thread_id', d.thread_id).eq('direction', 'inbound');
  if (d.lead && EARLY_STAGES.concat(['first_email_sent', 'linkedin_contacted']).includes(d.lead.stage)) await ctx.admin.from('leads').update({ stage: 'follow_up_required' }).eq('id', d.lead.id);
  return { ok: true };
}
