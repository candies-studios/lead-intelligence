import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Spinner, Table, Td, Th, toast, cx, MultiSelect } from '@/components/ui';
import { toOptions } from '@/lib/options';

export default function FollowUps() {
  const { demo, profile } = useAuth();
  const [scope, setScope] = useState<'mine' | 'all'>('mine'); const [status, setStatus] = useState<string[]>(['open']);
  const list = useAsync(() => {
    let x = supabase.from('follow_ups').select('*, assignee:users!follow_ups_assigned_to_fkey(full_name), lead:leads!inner(id, stage, is_demo, company:companies(name), contact:contacts(full_name, title))').eq('lead.is_demo', demo).order('due_at').limit(500);
    if (status.length) x = x.in('status', status);
    if (scope === 'mine') x = x.eq('assigned_to', profile!.id);
    return q(x);
  }, [demo, scope, status.join(), profile?.id]);
  const rows = (list.data as any[]) ?? [];
  const now = new Date(); const endToday = new Date(); endToday.setHours(23, 59, 59);
  const overdue = rows.filter(r => r.status === 'open' && new Date(r.due_at) < now).length;
  const today = rows.filter(r => r.status === 'open' && new Date(r.due_at) >= now && new Date(r.due_at) <= endToday).length;
  const complete = async (id: string, s: 'done' | 'cancelled') => {
    const { error } = await supabase.from('follow_ups').update({ status: s, completed_at: new Date().toISOString() }).eq('id', id);
    error ? toast.error(error.message) : list.reload();
  };
  return (
    <>
      <PageHeader title="Follow-ups" subtitle={<>{overdue > 0 && <span className="text-red-600 font-medium">{overdue} overdue · </span>}{today} due today</>}
        actions={<><Select className="w-36" value={scope} onChange={e => setScope(e.target.value as any)}><option value="mine">Assigned to me</option><option value="all">Whole team</option></Select>
          <div className="w-48"><MultiSelect options={toOptions(['open', 'done', 'cancelled'], { open: 'Open', done: 'Done', cancelled: 'Cancelled' })} value={status} onChange={setStatus} placeholder="All statuses" /></div></>} />
      <Card pad={false}>
        {list.loading ? <Spinner /> : !rows.length ? <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No follow-ups">Schedule reminders from any lead page.</EmptyState> : (
          <Table><thead><tr><Th>Due</Th><Th>Task</Th><Th>Lead</Th><Th>Assigned</Th><Th></Th></tr></thead>
            <tbody>{rows.map(f => { const late = f.status === 'open' && new Date(f.due_at) < now; return (
              <tr key={f.id} className={cx(late && 'bg-red-50/40')}>
                <Td className={cx('text-xs whitespace-nowrap', late && 'text-red-600 font-medium')}>{fmtDateTime(f.due_at)}</Td>
                <Td><div className="text-sm">{f.title}</div>{f.notes && <div className="text-xs text-ink-soft">{f.notes}</div>}</Td>
                <Td className="text-xs"><Link to={`/leads/${f.lead.id}`} className="font-medium text-navy-700 hover:underline">{f.lead.company?.name}</Link><div className="text-ink-soft">{f.lead.contact?.full_name}</div></Td>
                <Td className="text-xs">{f.assignee?.full_name ?? '—'}</Td>
                <Td className="whitespace-nowrap">{f.status === 'open' ? <><Button size="sm" variant="subtle" icon={<Check className="h-3.5 w-3.5" />} onClick={() => complete(f.id, 'done')}>Done</Button><Button size="sm" variant="ghost" onClick={() => complete(f.id, 'cancelled')}>Cancel</Button></> : <Badge>{f.status}</Badge>}</Td>
              </tr>); })}</tbody></Table>
        )}
      </Card>
    </>
  );
}
