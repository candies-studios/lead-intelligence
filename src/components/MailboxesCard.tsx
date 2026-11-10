import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, Unplug, RefreshCw } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth, ADMINS } from '@/lib/auth';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { warmupLimit } from '../../supabase/functions/_shared/mail';
import { Alert, Badge, Button, Card, Field, Input, Textarea, toast } from './ui';

export default function MailboxesCard() {
  const { profile, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useAsync(() => q(supabase.from('mailboxes').select('*').order('created_at')), []);
  const sentToday = useAsync<Record<string, number>>(async () => {
    const { data } = await supabase.from('email_messages').select('mailbox_id').eq('direction', 'outbound').eq('status', 'sent').gte('sent_at', new Date(Date.now() - 864e5).toISOString()).limit(5000);
    return (data ?? []).reduce((a: Record<string, number>, r: any) => ({ ...a, [r.mailbox_id]: (a[r.mailbox_id] ?? 0) + 1 }), {} as Record<string, number>);
  }, []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ok = params.get('gmail'), err = params.get('gmail_error');
    if (ok === 'connected') { toast.success(`Gmail connected: ${params.get('mailbox') ?? ''}`); list.reload(); }
    if (err) toast.error(err);
    if (ok || err) { params.delete('gmail'); params.delete('gmail_error'); params.delete('mailbox'); setParams(params, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}#/integrations`;
      const r = await callFn('gmail-oauth', { action: 'start', return_url: returnUrl, login_hint: profile?.email });
      window.location.href = r.url;
    } catch (e) { toast.error((e as Error).message); setBusy(false); }
  };
  const upd = async (id: string, patch: any) => {
    const { error } = await supabase.from('mailboxes').update(patch).eq('id', id);
    error ? toast.error(error.message) : (toast.success('Saved'), list.reload());
  };
  const disconnect = async (id: string) => {
    if (!confirm('Disconnect this mailbox? Active sequences that send from it will be paused.')) return;
    try { await callFn('automation', { action: 'disconnect_mailbox', mailbox_id: id }); list.reload(); } catch (e) { toast.error((e as Error).message); }
  };
  const rows = (list.data as any[]) ?? [];

  return (
    <Card className="mb-6" title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-navy-600" />Gmail / Google Workspace — automated outreach</span>}
      action={<Button variant="primary" size="sm" loading={busy} onClick={connect}>Connect Gmail</Button>}>
      <p className="text-sm text-ink-soft mb-4">Sequences are sent from these mailboxes and replies are read from their inbox. Only emails from prospects are stored; everything else in the mailbox is ignored. Daily volume ramps up gradually (warm-up) to protect your domain’s reputation.</p>
      {!rows.length && <Alert tone="info">No mailbox connected yet. You’ll need the Google OAuth client set up once (see the setup guide), then click <b>Connect Gmail</b>.</Alert>}
      <div className="space-y-3">{rows.map(mb => {
        const limit = warmupLimit(mb); const used = (sentToday.data ?? {})[mb.id as string] ?? 0; const mine = mb.user_id === profile?.id || can(...ADMINS);
        return (
          <div key={mb.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium">{mb.email}</div>
              <Badge tone={mb.status === 'connected' ? 'green' : mb.status === 'error' ? 'red' : 'slate'}>{mb.status === 'connected' ? 'Connected' : mb.status === 'error' ? 'Needs reconnect' : 'Disconnected'}</Badge>
              <span className="text-xs text-ink-soft">Sent in last 24h: <b>{used}</b> / today’s limit <b>{limit}</b> (max {mb.daily_limit})</span>
              <span className="text-[11px] text-ink-faint">Inbox checked {fmtDateTime(mb.last_polled_at)}</span>
              <div className="flex-1" />
              {mb.status !== 'connected' && <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={connect}>Reconnect</Button>}
              {mine && mb.status !== 'disconnected' && <Button size="sm" variant="ghost" icon={<Unplug className="h-3.5 w-3.5" />} onClick={() => disconnect(mb.id)}>Disconnect</Button>}
            </div>
            {mb.last_error && <p className="text-xs text-red-600 mt-2">{mb.last_error}</p>}
            {mine && (
              <div className="grid md:grid-cols-4 gap-3 mt-3">
                <Field label="Max emails / day" hint="Google Workspace allows ~2,000; keep it modest for cold outreach"><Input type="number" min={1} max={500} defaultValue={mb.daily_limit} onBlur={e => +e.target.value !== mb.daily_limit && upd(mb.id, { daily_limit: +e.target.value })} /></Field>
                <Field label="Warm-up: start volume"><Input type="number" min={1} defaultValue={mb.warmup_start_volume} onBlur={e => +e.target.value !== mb.warmup_start_volume && upd(mb.id, { warmup_start_volume: +e.target.value })} /></Field>
                <Field label="Warm-up: +per day"><Input type="number" min={0} defaultValue={mb.warmup_increment} onBlur={e => +e.target.value !== mb.warmup_increment && upd(mb.id, { warmup_increment: +e.target.value })} /></Field>
                <Field label="Sender title"><Input defaultValue={mb.sender_title ?? ''} onBlur={e => e.target.value !== (mb.sender_title ?? '') && upd(mb.id, { sender_title: e.target.value || null })} /></Field>
                <Field label="Email signature (optional)" className="md:col-span-4" hint="Replaces the default signature (name, title, company)."><Textarea rows={3} defaultValue={mb.signature ?? ''} onBlur={e => e.target.value !== (mb.signature ?? '') && upd(mb.id, { signature: e.target.value || null })} /></Field>
              </div>
            )}
          </div>);
      })}</div>
    </Card>
  );
}
