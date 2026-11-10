import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox as InboxIcon, Send, Check, Trash2, Bot, CircleAlert } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, Tabs, Textarea, Input, toast, type Tone } from '@/components/ui';

export const CATEGORY: Record<string, { label: string; tone: Tone }> = {
  meeting_request: { label: 'Wants a meeting', tone: 'green' }, interested: { label: 'Interested', tone: 'green' },
  question: { label: 'Question', tone: 'blue' }, referral: { label: 'Referral', tone: 'violet' }, not_interested: { label: 'Not interested', tone: 'slate' },
  unsubscribe: { label: 'Unsubscribe', tone: 'red' }, out_of_office: { label: 'Out of office', tone: 'amber' }, bounce: { label: 'Bounced', tone: 'red' },
  other: { label: 'Other', tone: 'slate' }, needs_review: { label: 'Needs review', tone: 'amber' },
};

export default function Inbox() {
  const [tab, setTab] = useState<'attention' | 'replies' | 'sent'>('attention');
  return (
    <>
      <PageHeader title="Inbox" subtitle="Replies to automated outreach. Routine replies (meeting requests, out-of-office, not interested, unsubscribe, bounces) are handled automatically; anything else waits here for your one-click approval." />
      <Tabs tabs={[{ id: 'attention', label: 'Needs your attention' }, { id: 'replies', label: 'All replies' }, { id: 'sent', label: 'Sent automatically' }]} value={tab} onChange={setTab} />
      {tab === 'attention' ? <Attention /> : tab === 'replies' ? <Replies /> : <SentList />}
    </>
  );
}

function Attention() {
  const list = useAsync(() => q(supabase.from('email_messages').select('*, lead:leads(id, stage, company:companies(name)), contact:contacts(full_name, title)').eq('needs_attention', true).order('created_at', { ascending: false }).limit(100)), []);
  const rows = (list.data as any[]) ?? [];
  const threads = new Map<string, { inbound?: any; draft?: any; failed?: any }>();
  for (const r of rows) {
    const key = r.thread_id ?? r.id;
    const t = threads.get(key) ?? {};
    if (r.direction === 'inbound') t.inbound = t.inbound ?? r;
    else if (r.status === 'pending_approval') t.draft = t.draft ?? r;
    else if (r.status === 'failed') t.failed = r;
    threads.set(key, t);
  }
  if (list.loading) return <Spinner />;
  if (!threads.size) return <Card><EmptyState icon={<InboxIcon className="h-5 w-5" />} title="All caught up">Replies that need a person will appear here with an AI-drafted response ready to approve.</EmptyState></Card>;
  return <div className="space-y-4">{[...threads.entries()].map(([k, t]) => <ThreadCard key={k} t={t} onDone={list.reload} />)}</div>;
}

function ThreadCard({ t, onDone }: { t: { inbound?: any; draft?: any; failed?: any }; onDone: () => void }) {
  const base = t.inbound ?? t.draft ?? t.failed;
  const [body, setBody] = useState<string>(t.draft?.body_text ?? '');
  const [subject, setSubject] = useState<string>(t.draft?.subject ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const cat = CATEGORY[t.inbound?.classification ?? ''];
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try { await callFn('automation', { action, ...extra }); toast.success(action === 'approve_reply' ? 'Reply sent' : 'Done'); onDone(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{base.contact?.full_name ?? base.from_email}{base.contact?.title && <span className="font-normal text-ink-soft"> · {base.contact.title}</span>}</div>
          <div className="text-xs text-ink-soft">{base.lead?.company?.name} {base.lead && <Link to={`/leads/${base.lead.id}`} className="text-navy-600 ml-1">Open lead →</Link>}</div>
        </div>
        {cat && <Badge tone={cat.tone}>{cat.label}</Badge>}
        {t.failed && <Badge tone="red">Send failed</Badge>}
        <span className="text-[11px] text-ink-faint">{fmtDateTime(base.received_at ?? base.created_at)}</span>
      </div>
      <div className="p-5 space-y-4">
        {t.failed && <div className="text-sm text-red-700 flex gap-2"><CircleAlert className="h-4 w-4 mt-0.5" />{t.failed.error}</div>}
        {t.inbound && (
          <div>
            {t.inbound.ai_summary && <div className="text-xs text-ink-soft mb-2 flex items-center gap-1"><Bot className="h-3.5 w-3.5" />{t.inbound.ai_summary}</div>}
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto"><div className="text-xs font-medium mb-1">{t.inbound.subject}</div>{t.inbound.body_text}</div>
          </div>
        )}
        {t.draft ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-ink-soft">AI-drafted reply — edit if needed, then send</div>
            <Input value={subject} onChange={e => setSubject(e.target.value)} />
            <Textarea rows={7} value={body} onChange={e => setBody(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={busy === 'approve_reply'} onClick={() => act('approve_reply', { message_id: t.draft.id, body, subject })}>Approve & send</Button>
              <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} loading={busy === 'discard_reply'} onClick={() => act('discard_reply', { message_id: t.draft.id })}>Discard draft</Button>
              {t.inbound && <Button variant="ghost" icon={<Check className="h-4 w-4" />} loading={busy === 'resolve'} onClick={() => act('resolve', { message_id: t.inbound.id }).then(() => act('discard_reply', { message_id: t.draft.id }))}>I replied myself</Button>}
            </div>
          </div>
        ) : t.inbound && (
          <div className="flex gap-2"><Button icon={<Check className="h-4 w-4" />} loading={busy === 'resolve'} onClick={() => act('resolve', { message_id: t.inbound.id })}>Mark as handled</Button>
            <span className="text-xs text-ink-faint self-center">No AI draft (AI unavailable or not needed) — reply from Gmail, then mark handled.</span></div>
        )}
        {t.failed && !t.inbound && <Button icon={<Check className="h-4 w-4" />} onClick={() => act('resolve', { message_id: t.failed.id })}>Dismiss</Button>}
      </div>
    </Card>
  );
}

function Replies() {
  const list = useAsync(() => q(supabase.from('email_messages').select('*, lead:leads(id, company:companies(name)), contact:contacts(full_name)').eq('direction', 'inbound').order('received_at', { ascending: false }).limit(200)), []);
  if (list.loading) return <Spinner />;
  const rows = (list.data as any[]) ?? [];
  if (!rows.length) return <Card><EmptyState icon={<InboxIcon className="h-5 w-5" />} title="No replies yet" /></Card>;
  return (
    <Card pad={false}><ul className="divide-y divide-slate-100">{rows.map(r => { const c = CATEGORY[r.classification ?? ''] ?? CATEGORY.other; return (
      <li key={r.id} className="px-5 py-3 flex gap-4 items-start">
        <div className="w-48 shrink-0"><div className="text-sm font-medium truncate">{r.contact?.full_name ?? r.from_email}</div><div className="text-[11px] text-ink-faint truncate">{r.lead?.company?.name}</div></div>
        <div className="flex-1 min-w-0"><div className="text-sm truncate">{r.subject}</div><div className="text-xs text-ink-soft truncate">{r.ai_summary}</div>{r.auto_action && <div className="text-[11px] text-emerald-700 mt-0.5 flex items-center gap-1"><Bot className="h-3 w-3" />{r.auto_action}</div>}</div>
        <div className="flex flex-col items-end gap-1"><Badge tone={c.tone}>{c.label}</Badge><span className="text-[11px] text-ink-faint">{fmtDateTime(r.received_at)}</span>{r.lead && <Link to={`/leads/${r.lead.id}`} className="text-[11px] text-navy-600">Lead →</Link>}</div>
      </li>); })}</ul></Card>
  );
}

function SentList() {
  const list = useAsync(() => q(supabase.from('email_messages').select('id, kind, subject, to_email, sent_at, step, lead:leads(id, company:companies(name)), contact:contacts(full_name)').eq('direction', 'outbound').eq('status', 'sent').neq('kind', 'test').order('sent_at', { ascending: false }).limit(200)), []);
  if (list.loading) return <Spinner />;
  const rows = (list.data as any[]) ?? [];
  if (!rows.length) return <Card><EmptyState icon={<Send className="h-5 w-5" />} title="Nothing sent yet">Approve a sequence on a campaign to start automated outreach.</EmptyState></Card>;
  const KIND: Record<string, string> = { sequence: 'Sequence', auto_reply: 'Auto-reply', approved_reply: 'Approved reply', manual: 'Manual' };
  return (
    <Card pad={false}><ul className="divide-y divide-slate-100">{rows.map(r => (
      <li key={r.id} className="px-5 py-2.5 flex gap-4 items-center text-sm">
        <div className="w-48 shrink-0 truncate">{r.contact?.full_name ?? r.to_email}</div>
        <div className="flex-1 min-w-0 truncate">{r.subject}</div>
        <Badge tone={r.kind === 'auto_reply' ? 'green' : r.kind === 'approved_reply' ? 'blue' : 'slate'}>{KIND[r.kind] ?? r.kind}{r.kind === 'sequence' && r.step != null ? ` · step ${r.step + 1}` : ''}</Badge>
        <span className="text-[11px] text-ink-faint w-28 text-right">{fmtDateTime(r.sent_at)}</span>
      </li>))}</ul></Card>
  );
}
