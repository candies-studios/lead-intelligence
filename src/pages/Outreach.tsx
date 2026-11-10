import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles, Copy, Check, Mail, Send, Save } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { CHANNEL_LABEL, DEPT_LABEL } from '@/lib/constants';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Spinner, Textarea, toast, EmailStatusBadge, MultiSelect } from '@/components/ui';
import { toOptions } from '@/lib/options';

export default function Outreach() {
  const [params] = useSearchParams();
  const contactId = params.get('contact'); const leadId = params.get('lead');
  return contactId ? <Composer contactId={contactId} leadId={leadId} /> : <AllDrafts />;
}

function Composer({ contactId, leadId }: { contactId: string; leadId: string | null }) {
  const { profile } = useAuth();
  const contact = useAsync(() => q(supabase.from('contacts').select('*, company:companies(id, name, industry, country_code)').eq('id', contactId).single()), [contactId]);
  const lead = useAsync(async () => leadId ? { id: leadId } : (await supabase.from('leads').select('id').eq('primary_contact_id', contactId).limit(1).maybeSingle()).data, [contactId, leadId]);
  const drafts = useAsync(() => q(supabase.from('outreach_messages').select('*').eq('contact_id', contactId).neq('status', 'archived').order('created_at', { ascending: false })), [contactId]);
  const [sender, setSender] = useState(profile?.full_name ?? ''); const [title, setTitle] = useState(''); const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false); const [points, setPoints] = useState<string[]>([]);
  const c: any = contact.data;
  const gen = async () => {
    setBusy(true);
    try { const r = await callFn('generate-outreach', { contact_id: contactId, lead_id: (lead.data as any)?.id ?? null, sender_name: sender, sender_title: title, extra_context: extra }); setPoints(r.personalisation_points); drafts.reload(); toast.success('Six drafts generated — review and approve before sending'); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  if (contact.loading) return <Spinner />;
  if (!c) return <Alert tone="error">Contact not found</Alert>;
  const list = (drafts.data as any[]) ?? [];
  const latestBatch = list.length ? list.filter(d => Math.abs(new Date(d.created_at).getTime() - new Date(list[0].created_at).getTime()) < 60000) : [];
  const older = list.filter(d => !latestBatch.includes(d));
  return (
    <>
      <PageHeader title="Generate Personalised Outreach" subtitle={<>For <b>{c.full_name}</b>, {c.title} at <Link className="text-navy-700 underline" to={`/companies/${c.company.id}`}>{c.company.name}</Link> · {DEPT_LABEL[c.department]}</>} actions={<Link to="/outreach"><Button variant="ghost">All drafts</Button></Link>} />
      {c.do_not_contact && <div className="mb-4"><Alert tone="error" title="Do not contact">This person is suppressed; generation is blocked.</Alert></div>}
      <div className="grid xl:grid-cols-[340px_1fr] gap-4">
        <Card title="Personalisation">
          <div className="space-y-3">
            <Field label="Your name"><Input value={sender} onChange={e => setSender(e.target.value)} /></Field>
            <Field label="Your title"><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Partner, Corporate Programmes" /></Field>
            <Field label="Extra context (optional)" hint="e.g. met at a conference, mutual connection, preferred cohort dates. Only facts you know to be true."><Textarea rows={3} value={extra} onChange={e => setExtra(e.target.value)} /></Field>
            <div className="text-xs text-ink-soft space-y-1"><div>Email on file: {c.email ?? '—'} <EmailStatusBadge status={c.email_status} /></div>{c.email_status === 'inferred_pattern' && <div className="text-amber-700">This email is inferred from a pattern and may bounce — verify before sending.</div>}</div>
            <Button variant="primary" className="w-full" icon={<Sparkles className="h-4 w-4" />} loading={busy} disabled={c.do_not_contact} onClick={gen}>Generate Personalised Outreach</Button>
            <p className="text-[11px] text-ink-faint">Drafts use only stored company research, signals and the contact’s role. Run an AI Company Intelligence Report first for stronger personalisation.</p>
            {points.length > 0 && <div className="text-xs"><div className="font-medium mb-1">Personalisation used</div><ul className="list-disc pl-4 text-ink-soft">{points.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
          </div>
        </Card>
        <div className="space-y-4">
          {!list.length ? <Card><EmptyState icon={<Send className="h-5 w-5" />} title="No drafts yet">Generate an introductory email, LinkedIn connection request and follow-up, WhatsApp intro, follow-up email and meeting request.</EmptyState></Card> :
            <>{latestBatch.map(d => <DraftCard key={d.id} d={d} contact={c} leadId={(lead.data as any)?.id} onChange={drafts.reload} />)}
              {older.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-ink-soft mb-2">{older.length} earlier drafts</summary><div className="space-y-4">{older.map(d => <DraftCard key={d.id} d={d} contact={c} leadId={(lead.data as any)?.id} onChange={drafts.reload} />)}</div></details>}</>}
        </div>
      </div>
    </>
  );
}

function DraftCard({ d, contact, leadId, onChange }: { d: any; contact: any; leadId?: string; onChange: () => void }) {
  const { profile } = useAuth();
  const [subject, setSubject] = useState(d.subject ?? ''); const [body, setBody] = useState(d.body); const [copied, setCopied] = useState(false);
  const dirty = subject !== (d.subject ?? '') || body !== d.body;
  const save = async (extra: any = {}) => {
    const { error } = await supabase.from('outreach_messages').update({ subject: subject || null, body, ...extra }).eq('id', d.id);
    if (error) { toast.error(error.message); return false; } onChange(); return true;
  };
  const copy = async () => { await navigator.clipboard.writeText(subject ? `Subject: ${subject}\n\n${body}` : body); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const markSent = async () => {
    if (d.status !== 'approved') return toast.error('Approve the message first');
    if (!leadId) return toast.error('No lead linked to this contact');
    const channel = d.channel.includes('linkedin') ? 'linkedin' : d.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const { error } = await supabase.from('communications').insert({ lead_id: leadId, contact_id: contact.id, outreach_message_id: d.id, channel, direction: 'outbound', subject: subject || CHANNEL_LABEL[d.channel], summary: body.slice(0, 2000), created_by: profile?.id });
    if (error) return toast.error(error.message);
    await save({ status: 'sent', sent_at: new Date().toISOString() });
    const stage = channel === 'linkedin' ? 'linkedin_contacted' : d.channel === 'intro_email' ? 'first_email_sent' : d.channel === 'meeting_request' ? 'follow_up_required' : null;
    if (stage) await supabase.from('leads').update({ stage }).eq('id', leadId).in('stage', ['newly_discovered', 'research_pending', 'qualified', 'contact_identified', 'outreach_pending', 'first_email_sent']);
    toast.success('Logged in communication history');
  };
  const isEmail = ['intro_email', 'followup_email', 'meeting_request'].includes(d.channel);
  const mailto = contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;
  return (
    <Card title={<span className="flex items-center gap-2">{CHANNEL_LABEL[d.channel]}<Badge tone={d.status === 'approved' ? 'green' : d.status === 'sent' ? 'blue' : 'slate'}>{d.status}</Badge></span>}
      action={<span className="text-[11px] text-ink-faint">{fmtDateTime(d.created_at)} · {d.ai_model}</span>}>
      {isEmail && <Input className="mb-2 font-medium" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" disabled={d.status === 'sent'} />}
      <Textarea rows={d.channel === 'linkedin_connect' || d.channel === 'whatsapp' ? 4 : 9} value={body} onChange={e => setBody(e.target.value)} disabled={d.status === 'sent'} />
      {d.channel === 'linkedin_connect' && <div className={`text-[11px] mt-1 ${body.length > 300 ? 'text-red-600' : 'text-ink-faint'}`}>{body.length}/300 characters</div>}
      <div className="flex flex-wrap gap-2 mt-3">
        {d.status !== 'sent' && <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} onClick={() => save({ status: 'draft', approved_by: null, approved_at: null }).then(ok => ok && toast.success('Saved'))}>Save edits</Button>}
        {d.status === 'draft' && <Button size="sm" variant="subtle" icon={<Check className="h-3.5 w-3.5" />} onClick={() => save({ status: 'approved', approved_by: profile?.id, approved_at: new Date().toISOString() })}>Approve</Button>}
        <Button size="sm" variant="ghost" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        {isEmail && mailto && d.status === 'approved' && <a href={mailto}><Button size="sm" variant="ghost" icon={<Mail className="h-3.5 w-3.5" />}>Open in mail app</Button></a>}
        {d.status === 'approved' && <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={markSent}>Mark as sent</Button>}
        {d.status !== 'sent' && <Button size="sm" variant="ghost" className="ml-auto text-ink-faint" onClick={() => save({ status: 'archived' })}>Archive</Button>}
      </div>
    </Card>
  );
}

function AllDrafts() {
  const { demo } = useAuth();
  const [status, setStatus] = useState<string[]>(['draft']);
  const list = useAsync(() => {
    let x = supabase.from('outreach_messages').select('id, channel, status, subject, body, created_at, lead_id, contact:contacts!inner(id, full_name, title, is_demo, company:companies(name))').eq('contact.is_demo', demo).order('created_at', { ascending: false }).limit(300);
    if (status.length) x = x.in('status', status);
    return q(x);
  }, [demo, status.join()]);
  const rows = (list.data as any[]) ?? [];
  return (
    <>
      <PageHeader title="Outreach" subtitle="Every AI draft must be reviewed and approved by a person. Nothing is sent automatically; mark messages as sent once you have sent them from your own mailbox or LinkedIn." />
      <Card pad={false}>
        <div className="p-4 border-b border-slate-100 flex gap-2"><div className="w-56"><MultiSelect options={toOptions(['draft', 'approved', 'sent', 'archived'], { draft: 'Drafts', approved: 'Approved', sent: 'Sent', archived: 'Archived' })} value={status} onChange={setStatus} placeholder="All statuses" /></div></div>
        {list.loading ? <Spinner /> : !rows.length ? <EmptyState icon={<Send className="h-5 w-5" />} title="Nothing here">Open a lead or contact and click “Generate Personalised Outreach”.</EmptyState> : (
          <ul className="divide-y divide-slate-100">{rows.map(m => (
            <li key={m.id}><Link to={`/outreach?contact=${m.contact.id}${m.lead_id ? `&lead=${m.lead_id}` : ''}`} className="flex gap-4 px-5 py-3 hover:bg-slate-50">
              <div className="w-56 shrink-0"><div className="text-sm font-medium">{m.contact.full_name}</div><div className="text-[11px] text-ink-faint truncate">{m.contact.company?.name}</div></div>
              <div className="flex-1 min-w-0"><div className="text-xs text-ink-soft">{CHANNEL_LABEL[m.channel]}{m.subject ? ` — ${m.subject}` : ''}</div><div className="text-sm truncate">{m.body}</div></div>
              <div className="flex flex-col items-end gap-1"><Badge tone={m.status === 'approved' ? 'green' : m.status === 'sent' ? 'blue' : 'slate'}>{m.status}</Badge><span className="text-[11px] text-ink-faint">{fmtDateTime(m.created_at)}</span></div>
            </Link></li>))}</ul>
        )}
      </Card>
    </>
  );
}
