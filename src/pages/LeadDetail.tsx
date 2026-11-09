import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RefreshCw, Send, Plus, Check, Building2 } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, useRefData, q, fmtDate, fmtDateTime } from '@/lib/hooks';
import { CHANNEL_LABEL, DEPT_LABEL, PRIORITY_LABEL, SENIORITY_LABEL, STAGES, STAGE_LABEL, type Stage } from '@/lib/constants';
import { Alert, Badge, Button, Card, ConfidenceBadge, EmailStatusBadge, Field, Input, Modal, PageHeader, ScoreBadge, Select, Spinner, Textarea, toast } from '@/components/ui';
import Notes from '@/components/Notes';
import { updateLeadStage } from './Leads';

export default function LeadDetail() {
  const { id } = useParams(); const { profile } = useAuth(); const ref = useRefData();
  const lead = useAsync(() => q(supabase.from('leads').select('*, company:companies(*), contact:contacts(*, contact_sources(url, provider)), campaign:campaigns(id, name)').eq('id', id!).single()), [id]);
  const score = useAsync(() => q(supabase.from('lead_scores').select('*').eq('lead_id', id!).order('computed_at', { ascending: false }).limit(1).maybeSingle()), [id]);
  const comms = useAsync(() => q(supabase.from('communications').select('*, author:users(full_name)').eq('lead_id', id!).order('occurred_at', { ascending: false })), [id]);
  const fups = useAsync(() => q(supabase.from('follow_ups').select('*, assignee:users!follow_ups_assigned_to_fkey(full_name)').eq('lead_id', id!).order('due_at')), [id]);
  const drafts = useAsync(() => q(supabase.from('outreach_messages').select('id, channel, status, subject, created_at').eq('lead_id', id!).order('created_at', { ascending: false })), [id]);
  const [rescoring, setRescoring] = useState(false); const [logOpen, setLogOpen] = useState(false); const [fuOpen, setFuOpen] = useState(false);

  if (lead.loading) return <Spinner />;
  if (lead.error || !lead.data) return <Alert tone="error">{lead.error ?? 'Lead not found'}</Alert>;
  const l: any = lead.data; const c = l.contact; const co = l.company; const s: any = score.data;
  const patch = async (p: any) => { const { error } = await supabase.from('leads').update(p).eq('id', id!); if (error) toast.error(error.message); else lead.reload(); };
  const rescore = async () => { setRescoring(true); try { await callFn('score-leads', { lead_id: id }); score.reload(); lead.reload(); } catch (e) { toast.error((e as Error).message); } finally { setRescoring(false); } };

  return (
    <>
      <PageHeader title={c ? `${c.full_name} · ${co.name}` : co.name}
        subtitle={<span className="flex flex-wrap gap-2 items-center">{c?.title ?? 'Company-level lead — no decision-maker yet'}{l.campaign && <Link to={`/campaigns/${l.campaign.id}`}><Badge tone="navy">Campaign: {l.campaign.name}</Badge></Link>}{l.is_demo && <Badge tone="amber">DEMO</Badge>}</span>}
        actions={<><Link to={`/companies/${co.id}`}><Button icon={<Building2 className="h-4 w-4" />}>Company profile</Button></Link>
          {c && <Link to={`/outreach?contact=${c.id}&lead=${l.id}`}><Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={c.do_not_contact}>Generate Personalised Outreach</Button></Link>}</>} />
      {c?.do_not_contact && <div className="mb-4"><Alert tone="error" title="Do not contact">This person is on the suppression list. Outreach is blocked.</Alert></div>}
      <div className="grid xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Card title="Pipeline">
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Stage"><Select value={l.stage} onChange={async e => { if (await updateLeadStage([l.id], e.target.value as Stage)) lead.reload(); }}>{STAGES.map(st => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}</Select></Field>
              <Field label="Assigned to"><Select value={l.assigned_to ?? ''} onChange={e => patch({ assigned_to: e.target.value || null })}><option value="">Unassigned</option>{ref.data?.users.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select></Field>
              <Field label="Deal value"><div className="flex gap-1"><Select className="w-20" value={l.currency ?? 'USD'} onChange={e => patch({ currency: e.target.value })}>{['USD', 'INR', 'AED', 'SAR', 'SGD', 'GBP', 'EUR', 'AUD', 'ZAR'].map(cur => <option key={cur}>{cur}</option>)}</Select><Input type="number" defaultValue={l.deal_value ?? ''} onBlur={e => patch({ deal_value: e.target.value === '' ? null : +e.target.value })} /></div></Field>
              <Field label="Meeting outcome" className="sm:col-span-2"><Input defaultValue={l.meeting_outcome ?? ''} onBlur={e => e.target.value !== (l.meeting_outcome ?? '') && patch({ meeting_outcome: e.target.value || null })} placeholder="e.g. Interested; wants proposal for 2 cohorts in Q2" /></Field>
              <Field label="Last contact"><div className="h-9 flex items-center text-sm">{fmtDateTime(l.last_contact_at)}</div></Field>
              {l.stage === 'lost' && <Field label="Lost reason" className="sm:col-span-3"><Input defaultValue={l.lost_reason ?? ''} onBlur={e => e.target.value && patch({ lost_reason: e.target.value })} /></Field>}
            </div>
          </Card>

          <Card title="Communication history" pad={false} action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLogOpen(true)}>Log activity</Button>}>
            {!(comms.data as any[])?.length ? <p className="p-5 text-sm text-ink-soft">No activity recorded. Log emails, LinkedIn messages, calls and meetings here — the app never sends anything without you.</p> : (
              <ul className="divide-y divide-slate-100">{(comms.data as any[]).map(m => (
                <li key={m.id} className="px-5 py-3 text-sm"><div className="flex items-center gap-2"><Badge tone={m.direction === 'inbound' ? 'green' : 'blue'}>{m.direction === 'inbound' ? '← ' : '→ '}{m.channel}</Badge><span className="font-medium">{m.subject}</span><span className="text-xs text-ink-faint ml-auto">{fmtDateTime(m.occurred_at)} · {m.author?.full_name}</span></div>
                  {m.summary && <p className="text-ink-soft mt-1 whitespace-pre-wrap">{m.summary}</p>}{m.outcome && <p className="text-xs mt-1"><b>Outcome:</b> {m.outcome}</p>}</li>))}</ul>
            )}
          </Card>

          <Card title="Follow-ups & reminders" pad={false} action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setFuOpen(true)}>Schedule</Button>}>
            {!(fups.data as any[])?.length ? <p className="p-5 text-sm text-ink-soft">No follow-ups scheduled.</p> : (
              <ul className="divide-y divide-slate-100">{(fups.data as any[]).map(f => (
                <li key={f.id} className="px-5 py-3 text-sm flex items-center gap-3">
                  <div className="flex-1"><div className={f.status === 'done' ? 'line-through text-ink-faint' : ''}>{f.title}</div><div className={`text-xs ${f.status === 'open' && new Date(f.due_at) < new Date() ? 'text-red-600' : 'text-ink-faint'}`}>{fmtDateTime(f.due_at)} · {f.assignee?.full_name ?? 'Unassigned'}{f.notes ? ` · ${f.notes}` : ''}</div></div>
                  {f.status === 'open' && <Button size="sm" variant="subtle" icon={<Check className="h-3.5 w-3.5" />} onClick={async () => { await supabase.from('follow_ups').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', f.id); fups.reload(); lead.reload(); }}>Done</Button>}
                </li>))}</ul>
            )}
          </Card>

          {(drafts.data as any[])?.length > 0 && <Card title="Outreach drafts" pad={false}><ul className="divide-y divide-slate-100">{(drafts.data as any[]).map(d => <li key={d.id} className="px-5 py-2.5 text-sm flex justify-between"><span>{CHANNEL_LABEL[d.channel]}{d.subject ? ` — ${d.subject}` : ''}</span><span className="flex gap-2 items-center"><Badge tone={d.status === 'approved' ? 'green' : d.status === 'sent' ? 'blue' : 'slate'}>{d.status}</Badge><span className="text-xs text-ink-faint">{fmtDate(d.created_at)}</span></span></li>)}</ul>
            <div className="px-5 py-2 border-t border-slate-100"><Link to={`/outreach?contact=${c?.id}&lead=${l.id}`} className="text-xs text-navy-600">Open in Outreach →</Link></div></Card>}
        </div>

        <div className="space-y-4">
          <Card title="Lead score" action={<Button size="sm" variant="ghost" loading={rescoring} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={rescore}>Recalculate</Button>}>
            {!s ? <p className="text-sm text-ink-soft">Not scored yet.</p> : (
              <>
                <div className="flex items-baseline gap-3 mb-1"><span className="font-display text-4xl font-bold text-navy-950">{s.total}</span><span className="text-sm text-ink-soft">/ 100</span><ScoreBadge score={s.total} priority={s.priority} /></div>
                <div className="text-xs text-ink-soft mb-4">{PRIORITY_LABEL[s.priority]} · computed {fmtDateTime(s.computed_at)}</div>
                <ul className="space-y-3">{(s.breakdown as any[]).map(f => (
                  <li key={f.key}><div className="flex justify-between text-xs"><span className="font-medium">{f.label}</span><span className="tabular-nums text-ink-soft">{f.points} / {f.max}</span></div>
                    <div className="h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden"><div className="h-full bg-navy-600 rounded-full" style={{ width: `${f.max ? (f.points / f.max) * 100 : 0}%` }} /></div>
                    <div className="text-[11px] text-ink-faint mt-0.5">{f.reason}</div></li>))}</ul>
              </>
            )}
          </Card>
          {c && <Card title="Decision-maker">
            <dl className="grid grid-cols-[96px_1fr] gap-y-2 text-sm">
              <dt className="text-ink-soft">Function</dt><dd>{DEPT_LABEL[c.department]} · {SENIORITY_LABEL[c.seniority]}</dd>
              <dt className="text-ink-soft">Email</dt><dd className="break-all">{c.email ?? '—'} <div className="mt-1"><EmailStatusBadge status={c.email_status} /></div></dd>
              <dt className="text-ink-soft">Phone</dt><dd>{c.phone ?? '—'}</dd>
              <dt className="text-ink-soft">LinkedIn</dt><dd>{c.linkedin_url ? <a className="text-navy-600" href={c.linkedin_url} target="_blank" rel="noreferrer">Profile</a> : '—'}</dd>
              <dt className="text-ink-soft">Confidence</dt><dd><ConfidenceBadge level={c.confidence} /></dd>
              <dt className="text-ink-soft">Sources</dt><dd className="text-xs">{(c.contact_sources ?? []).map((x: any, i: number) => x.url ? <a key={i} href={x.url} target="_blank" rel="noreferrer" className="block text-navy-600 truncate">{x.url}</a> : <div key={i}>{x.provider}</div>)}</dd>
              <dt className="text-ink-soft">Verified</dt><dd>{fmtDate(c.last_verified_at)}</dd>
              <dt className="text-ink-soft">Lawful basis</dt><dd className="text-xs">{c.lawful_basis?.replace(/_/g, ' ')}</dd>
            </dl>
            {c.bio && <p className="text-xs text-ink-soft mt-3">{c.bio}</p>}
          </Card>}
          <Notes leadId={id!} />
        </div>
      </div>
      {logOpen && <LogActivity lead={l} userId={profile!.id} onClose={() => setLogOpen(false)} onSaved={() => { setLogOpen(false); comms.reload(); lead.reload(); }} />}
      {fuOpen && <FollowUpForm leadId={l.id} defaultAssignee={l.assigned_to ?? profile!.id} userId={profile!.id} onClose={() => setFuOpen(false)} onSaved={() => { setFuOpen(false); fups.reload(); lead.reload(); }} />}
    </>
  );
}

function LogActivity({ lead, userId, onClose, onSaved }: { lead: any; userId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ channel: 'email', direction: 'outbound', subject: '', summary: '', outcome: '', occurred_at: new Date().toISOString().slice(0, 16), advance: true });
  const [warn, setWarn] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const save = async (force = false) => {
    setBusy(true);
    if (!force && f.direction === 'outbound' && lead.primary_contact_id) {
      // duplicate-outreach guard: someone else contacted this person in the last 14 days?
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const { data } = await supabase.from('communications').select('occurred_at, author:users(full_name)').eq('contact_id', lead.primary_contact_id).eq('direction', 'outbound').gte('occurred_at', since).neq('created_by', userId).limit(1);
      if (data?.length) { setWarn(`${(data[0] as any).author?.full_name ?? 'A colleague'} already contacted this person on ${fmtDate(data[0].occurred_at)}. Log anyway?`); setBusy(false); return; }
    }
    const { error } = await supabase.from('communications').insert({ lead_id: lead.id, contact_id: lead.primary_contact_id, channel: f.channel, direction: f.direction, subject: f.subject || null, summary: f.summary || null, outcome: f.outcome || null, occurred_at: new Date(f.occurred_at).toISOString(), created_by: userId });
    if (error) { toast.error(error.message); setBusy(false); return; }
    if (f.advance && f.direction === 'outbound') {
      const next: Record<string, Stage> = { email: 'first_email_sent', linkedin: 'linkedin_contacted', meeting: 'meeting_scheduled' };
      const early = ['newly_discovered', 'research_pending', 'qualified', 'contact_identified', 'outreach_pending'];
      if (next[f.channel] && (early.includes(lead.stage) || f.channel === 'meeting')) await supabase.from('leads').update({ stage: next[f.channel] }).eq('id', lead.id);
    }
    setBusy(false); onSaved();
  };
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="Log activity" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => save(!!warn)}>{warn ? 'Log anyway' : 'Save'}</Button></>}>
      {warn && <div className="mb-3"><Alert tone="warn">{warn}</Alert></div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel"><Select value={f.channel} onChange={set('channel')}>{['email', 'linkedin', 'whatsapp', 'phone', 'meeting', 'other'].map(c => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Direction"><Select value={f.direction} onChange={set('direction')}><option value="outbound">Outbound</option><option value="inbound">Inbound (reply)</option></Select></Field>
        <Field label="When" className="col-span-2"><Input type="datetime-local" value={f.occurred_at} onChange={set('occurred_at')} /></Field>
        <Field label="Subject" className="col-span-2"><Input value={f.subject} onChange={set('subject')} /></Field>
        <Field label="Summary" className="col-span-2"><Textarea rows={3} value={f.summary} onChange={set('summary')} /></Field>
        <Field label="Outcome" className="col-span-2"><Input value={f.outcome} onChange={set('outcome')} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm mt-3"><input type="checkbox" checked={f.advance} onChange={e => setF({ ...f, advance: e.target.checked })} className="accent-navy-700" />Advance lead stage automatically</label>
    </Modal>
  );
}

export function FollowUpForm({ leadId, defaultAssignee, userId, onClose, onSaved }: { leadId: string; defaultAssignee: string; userId: string; onClose: () => void; onSaved: () => void }) {
  const ref = useRefData();
  const inThree = new Date(Date.now() + 3 * 864e5); inThree.setHours(10, 0, 0, 0);
  const [f, setF] = useState({ title: 'Follow up on introductory email', due_at: new Date(inThree.getTime() - inThree.getTimezoneOffset() * 6e4).toISOString().slice(0, 16), notes: '', assigned_to: defaultAssignee, markStage: false });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from('follow_ups').insert({ lead_id: leadId, title: f.title, notes: f.notes || null, due_at: new Date(f.due_at).toISOString(), assigned_to: f.assigned_to, created_by: userId });
    if (!error && f.markStage) await supabase.from('leads').update({ stage: 'follow_up_required' }).eq('id', leadId);
    setBusy(false); error ? toast.error(error.message) : (toast.success('Follow-up scheduled'), onSaved());
  };
  return (
    <Modal open onClose={onClose} title="Schedule follow-up" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Schedule</Button></>}>
      <div className="space-y-3">
        <Field label="Task"><Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Due"><Input type="datetime-local" value={f.due_at} onChange={e => setF({ ...f, due_at: e.target.value })} /></Field>
        <Field label="Assign to"><Select value={f.assigned_to} onChange={e => setF({ ...f, assigned_to: e.target.value })}>{ref.data?.users.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.markStage} onChange={e => setF({ ...f, markStage: e.target.checked })} className="accent-navy-700" />Move lead to “Follow-up required”</label>
      </div>
    </Modal>
  );
}
