import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Linkedin, MessageCircle, Plus, Trash2, Sparkles, Eye, Send, ShieldCheck, Pause, Play, Save } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { validateSteps, DEFAULT_SEQUENCE, TEMPLATE_VARS, type SequenceStep } from '../../supabase/functions/_shared/mail';
import { toOptions } from '@/lib/options';
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Textarea, toast, MultiSelect, Table, Td, Th, cx } from './ui';

const CH = { email: { label: 'Email', icon: Mail }, linkedin_task: { label: 'LinkedIn to-do', icon: Linkedin }, whatsapp_task: { label: 'WhatsApp to-do', icon: MessageCircle } } as const;
const EN_TONE: Record<string, any> = { active: 'blue', paused: 'amber', completed: 'slate', replied: 'green', bounced: 'red', unsubscribed: 'red', stopped: 'slate', failed: 'red' };

export default function SequencePanel({ campaign }: { campaign: any }) {
  const { profile } = useAuth();
  const seqQ = useAsync(() => q(supabase.from('sequences').select('*').eq('campaign_id', campaign.id).maybeSingle()), [campaign.id]);
  const boxes = useAsync(() => q(supabase.from('mailboxes').select('id, email, status').neq('status', 'disconnected')), []);
  const enr = useAsync(async () => seqQ.data ? q(supabase.from('enrollments').select('id, status, current_step, next_run_at, stop_reason, contact:contacts(full_name, email), lead_id').eq('sequence_id', (seqQ.data as any).id).order('updated_at', { ascending: false }).limit(200)) : [], [seqQ.data]);
  const seq: any = seqQ.data;
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [mailbox, setMailbox] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  useEffect(() => {
    if (seq) { setSteps(seq.steps); setSettings(seq.settings ?? {}); setMailbox(seq.mailbox_id ?? ''); setDirty(false); }
  }, [seq?.id, seq?.updated_at]);

  const create = async (fromAi: boolean) => {
    setBusy(fromAi ? 'gen' : 'create');
    try {
      let s: SequenceStep[] = DEFAULT_SEQUENCE;
      if (fromAi) { const r = await callFn('automation', { action: 'generate_sequence', campaign_id: campaign.id }); s = r.steps; setAiNote(r.note ?? (r.source === 'ai' ? 'Drafted by AI from this campaign’s targeting — review every word before approving.' : null)); }
      const firstBox = ((boxes.data as any[]) ?? []).find(b => b.status === 'connected')?.id ?? null;
      if (seq) { setSteps(s); setDirty(true); }
      else {
        const { error } = await supabase.from('sequences').insert({ campaign_id: campaign.id, name: campaign.name, steps: s, mailbox_id: firstBox, created_by: profile?.id, settings: { priorities: ['A', 'B'], allowed_email_statuses: ['verified'], daily_cap: 30, sender_name: profile?.full_name ?? null } });
        if (error) throw error;
        seqQ.reload();
      }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save');
    const { error } = await supabase.from('sequences').update({ steps, settings, mailbox_id: mailbox || null }).eq('id', seq.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(seq.status === 'active' ? 'Saved — the sequence needs re-approval because its messages changed' : 'Saved'); seqQ.reload();
  };
  const approve = async () => {
    if (dirty) await save();
    setBusy('approve');
    try { await callFn('automation', { action: 'approve_sequence', sequence_id: seq.id }); toast.success('Approved — automated outreach is live for this campaign'); seqQ.reload(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const setStatus = async (status: 'paused' | 'active') => {
    if (status === 'active') return approve();
    const { error } = await supabase.from('sequences').update({ status }).eq('id', seq.id);
    error ? toast.error(error.message) : (toast.success('Paused — no new emails will be sent'), seqQ.reload());
  };
  const doPreview = async () => {
    if (dirty) await save();
    setBusy('preview');
    try { setPreview(await Promise.all(steps.map((_, i) => callFn('automation', { action: 'preview', sequence_id: seq.id, step: i })))); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const testSend = async () => {
    if (dirty) await save();
    setBusy('test');
    try { const r = await callFn('automation', { action: 'test_send', sequence_id: seq.id }); toast.success(`${r.messages.length} preview email(s) sent to ${r.sent_to}`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const upd = (i: number, p: Partial<SequenceStep>) => { setSteps(steps.map((s, j) => j === i ? { ...s, ...p } : s)); setDirty(true); };
  const errs = validateSteps(steps);
  const connected = ((boxes.data as any[]) ?? []).filter(b => b.status === 'connected');
  const counts = ((enr.data as any[]) ?? []).reduce((a: Record<string, number>, e: any) => ({ ...a, [e.status]: (a[e.status] ?? 0) + 1 }), {});

  if (seqQ.loading) return null;
  if (!seq) return (
    <Card title="Email automation">
      <p className="text-sm text-ink-soft mb-4">Approve an email sequence once and every qualifying lead in this campaign is emailed, followed up and handled automatically — replies included. LinkedIn and WhatsApp steps become pre-written to-dos (those platforms don’t allow automated messaging).</p>
      {!connected.length && <div className="mb-4"><Alert tone="warn">Connect a Gmail / Google Workspace mailbox first on the <Link className="underline" to="/integrations">Integrations</Link> page.</Alert></div>}
      <div className="flex gap-2"><Button variant="primary" icon={<Sparkles className="h-4 w-4" />} loading={busy === 'gen'} onClick={() => create(true)}>Draft sequence with AI</Button><Button loading={busy === 'create'} onClick={() => create(false)}>Start from standard sequence</Button></div>
    </Card>
  );

  return (
    <Card title={<span className="flex items-center gap-2">Email automation <Badge tone={seq.status === 'active' ? 'green' : seq.status === 'paused' ? 'amber' : 'slate'}>{seq.status === 'active' ? 'Live' : seq.status === 'paused' ? 'Paused' : 'Draft — needs approval'}</Badge></span>}
      action={<div className="flex gap-2">
        {seq.status === 'active' ? <Button size="sm" icon={<Pause className="h-3.5 w-3.5" />} onClick={() => setStatus('paused')}>Pause</Button>
          : <Button size="sm" variant="primary" icon={seq.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />} loading={busy === 'approve'} disabled={errs.length > 0} onClick={approve}>{seq.status === 'paused' ? 'Resume' : 'Approve & go live'}</Button>}
      </div>}>
      {seq.approved_at && <p className="text-[11px] text-ink-faint -mt-1 mb-3">Approved {fmtDateTime(seq.approved_at)}{seq.status === 'draft' ? ' — messages changed since, re-approval needed' : ''}</p>}
      {aiNote && <div className="mb-3"><Alert tone="info">{aiNote}</Alert></div>}
      <div className="grid md:grid-cols-3 gap-3 mb-5">
        <Field label="Send from mailbox"><Select value={mailbox} onChange={e => { setMailbox(e.target.value); setDirty(true); }}><option value="">Choose…</option>{((boxes.data as any[]) ?? []).map(b => <option key={b.id} value={b.id} disabled={b.status !== 'connected'}>{b.email}{b.status !== 'connected' ? ' (reconnect)' : ''}</option>)}</Select></Field>
        <Field label="Lead priorities to include"><MultiSelect options={toOptions(['A', 'B', 'C', 'R'], { A: 'Priority A', B: 'Priority B', C: 'Priority C', R: 'Research required' })} value={settings.priorities ?? []} placeholder="All priorities" onChange={v => { setSettings({ ...settings, priorities: v }); setDirty(true); }} /></Field>
        <Field label="Email quality required" hint="Inferred/guessed emails are never auto-sent"><MultiSelect options={toOptions(['verified', 'provider_returned'], { verified: 'Verified', provider_returned: 'Provider-returned' })} value={settings.allowed_email_statuses ?? ['verified']} onChange={v => { setSettings({ ...settings, allowed_email_statuses: v.length ? v : ['verified'] }); setDirty(true); }} /></Field>
        <Field label="Sender name"><Input value={settings.sender_name ?? ''} onChange={e => { setSettings({ ...settings, sender_name: e.target.value }); setDirty(true); }} /></Field>
        <Field label="Sender title"><Input value={settings.sender_title ?? ''} onChange={e => { setSettings({ ...settings, sender_title: e.target.value }); setDirty(true); }} placeholder="e.g. Partner, Corporate Programmes" /></Field>
        <Field label="New leads per day (max)"><Input type="number" min={1} max={200} value={settings.daily_cap ?? 30} onChange={e => { setSettings({ ...settings, daily_cap: +e.target.value }); setDirty(true); }} /></Field>
        <Field label="Booking link (optional override)" className="md:col-span-3" hint="Used in {{booking_link}} and when someone asks to meet. Leave empty to use the default from Settings → Automation."><Input value={settings.booking_link ?? ''} onChange={e => { setSettings({ ...settings, booking_link: e.target.value }); setDirty(true); }} placeholder="https://calendly.com/…" /></Field>
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => { const Icon = CH[s.channel].icon; return (
          <div key={i} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="h-6 w-6 rounded-full bg-navy-800 text-white text-xs flex items-center justify-center">{i + 1}</span>
              <Icon className="h-4 w-4 text-navy-600" />
              <div className="w-44"><Select className="h-8" value={s.channel} onChange={e => upd(i, { channel: e.target.value as any })}>{Object.entries(CH).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></div>
              <span className="text-xs text-ink-soft">on day</span>
              <div className="w-20"><Input type="number" min={0} className="h-8" value={s.day} onChange={e => upd(i, { day: +e.target.value })} /></div>
              <div className="flex-1" />
              {steps.length > 1 && <Button size="sm" variant="ghost" onClick={() => { setSteps(steps.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </div>
            {s.channel === 'email' && <Input className="mb-2" placeholder={i === 0 ? 'Subject' : 'Subject (leave empty to reply in the same thread)'} value={s.subject ?? ''} onChange={e => upd(i, { subject: e.target.value })} />}
            <Textarea rows={s.channel === 'email' ? 8 : 3} value={s.body} onChange={e => upd(i, { body: e.target.value })} />
          </div>); })}
        <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { const last = steps[steps.length - 1]; setSteps([...steps, { day: (last?.day ?? 0) + 4, channel: 'email', body: 'Hi {{first_name}},\n\n\n\n{{sender_name}}' }]); setDirty(true); }}>Add step</Button>
      </div>
      <p className="text-[11px] text-ink-faint mt-3">Placeholders: {TEMPLATE_VARS.map(v => `{{${v}}}`).join(' ')} · An unsubscribe link and your postal address are added to every email automatically.</p>
      {errs.length > 0 && <div className="mt-3"><Alert tone="warn">{errs.map((e, i) => <div key={i}>• {e}</div>)}</Alert></div>}

      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
        <Button icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={busy === 'save'} onClick={save}>Save changes</Button>
        <Button icon={<Eye className="h-4 w-4" />} loading={busy === 'preview'} onClick={doPreview}>Preview with a real lead</Button>
        <Button icon={<Send className="h-4 w-4" />} loading={busy === 'test'} disabled={!mailbox} onClick={testSend}>Send me a test</Button>
        <Button variant="ghost" icon={<Sparkles className="h-4 w-4" />} loading={busy === 'gen'} onClick={() => create(true)}>Redraft with AI</Button>
      </div>

      {seq && (enr.data as any[])?.length > 0 && (
        <div className="mt-6">
          <div className="flex flex-wrap gap-2 mb-2 text-xs">{Object.entries(counts).map(([k, v]) => <Badge key={k} tone={EN_TONE[k]}>{k}: {v as number}</Badge>)}</div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100"><Table><thead><tr><Th>Contact</Th><Th>Status</Th><Th>Step</Th><Th>Next send</Th></tr></thead><tbody>
            {(enr.data as any[]).map(e => <tr key={e.id}><Td><Link to={`/leads/${e.lead_id}`} className="hover:underline">{e.contact?.full_name}</Link><div className="text-[11px] text-ink-faint">{e.contact?.email}</div></Td>
              <Td><Badge tone={EN_TONE[e.status]}>{e.status}</Badge>{e.stop_reason && <div className="text-[11px] text-ink-faint mt-0.5">{e.stop_reason}</div>}</Td>
              <Td className="text-xs">{Math.min(e.current_step + 1, steps.length)} / {steps.length}</Td><Td className={cx('text-xs', e.status !== 'active' && 'text-ink-faint')}>{e.status === 'active' ? fmtDateTime(e.next_run_at) : '—'}</Td></tr>)}
          </tbody></Table></div>
        </div>
      )}

      {preview && (
        <Modal open wide title="Preview — exactly what will be sent" onClose={() => setPreview(null)}>
          {preview[0]?.sample && <div className="mb-3"><Alert tone="info">No leads with contacts in this campaign yet — showing a sample recipient.</Alert></div>}
          <div className="space-y-4">{preview.map((p, i) => (
            <div key={i} className="rounded-lg border border-slate-200">
              <div className="px-3 py-2 border-b border-slate-100 text-xs flex gap-2 items-center"><Badge tone="navy">Step {i + 1}</Badge>{CH[steps[i].channel].label} · day {steps[i].day}{p.subject && <> · <b>{p.subject}</b></>}<span className="ml-auto text-ink-faint">to {p.to}</span></div>
              <pre className="p-3 text-sm whitespace-pre-wrap font-sans">{p.body}</pre>
            </div>))}</div>
        </Modal>
      )}
    </Card>
  );
}
