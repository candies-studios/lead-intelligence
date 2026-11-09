import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { Button, Card, Textarea, toast } from './ui';

export default function Notes({ leadId, companyId }: { leadId?: string; companyId?: string }) {
  const { profile } = useAuth();
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false);
  const list = useAsync(() => {
    let x = supabase.from('notes').select('*, author:users(full_name)').order('created_at', { ascending: false });
    x = leadId ? x.eq('lead_id', leadId) : x.eq('company_id', companyId!);
    return q(x);
  }, [leadId, companyId]);
  const add = async () => {
    if (!body.trim()) return; setBusy(true);
    const { error } = await supabase.from('notes').insert({ body, lead_id: leadId ?? null, company_id: companyId ?? null, created_by: profile?.id });
    setBusy(false); if (error) return toast.error(error.message);
    setBody(''); list.reload();
  };
  return (
    <Card title="Internal notes">
      <Textarea rows={2} placeholder="Add a note for the team…" value={body} onChange={e => setBody(e.target.value)} />
      <div className="text-right mt-2"><Button size="sm" variant="primary" loading={busy} onClick={add}>Add note</Button></div>
      <ul className="mt-3 space-y-3">{(list.data as any[] ?? []).map(n => (
        <li key={n.id} className="text-sm border-l-2 border-navy-100 pl-3"><p className="whitespace-pre-wrap">{n.body}</p><div className="text-[11px] text-ink-faint mt-0.5">{n.author?.full_name} · {fmtDateTime(n.created_at)}</div></li>
      ))}</ul>
    </Card>
  );
}
