import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutList, Columns3, Database } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, useRefData, q, fmtDate, fmtMoney } from '@/lib/hooks';
import { DEPARTMENTS, DEPT_LABEL, STAGES, STAGE_LABEL, type Stage } from '@/lib/constants';
import { Alert, Badge, Button, Card, EmailStatusBadge, EmptyState, Input, PageHeader, ScoreBadge, Select, Spinner, StageBadge, Table, Td, Th, toast, cx } from '@/components/ui';
import { ExportButton } from '@/components/ExportModal';

export async function updateLeadStage(ids: string[], stage: Stage): Promise<boolean> {
  const patch: any = { stage };
  if (stage === 'lost') {
    const reason = prompt('Reason this opportunity was lost (required):');
    if (!reason) return false;
    patch.lost_reason = reason;
  }
  const { error } = await supabase.from('leads').update(patch).in('id', ids);
  if (error) { toast.error(error.message); return false; }
  return true;
}

export default function Leads() {
  const { demo } = useAuth(); const ref = useRefData(); const nav = useNavigate();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [text, setText] = useState(''); const [stage, setStage] = useState(''); const [prio, setPrio] = useState(''); const [country, setCountry] = useState('');
  const [dept, setDept] = useState(''); const [owner, setOwner] = useState(''); const [seg, setSeg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const list = useAsync(() => {
    let x = supabase.from('v_lead_overview').select('*').eq('is_demo', demo).order('score', { ascending: false, nullsFirst: false }).limit(1000);
    if (stage) x = x.eq('stage', stage);
    if (prio) x = x.eq('priority', prio);
    if (country) x = x.eq('country_code', country);
    if (dept) x = x.eq('contact_department', dept);
    if (seg) x = x.eq('industry_segment', seg);
    if (owner === 'none') x = x.is('assigned_to', null); else if (owner) x = x.eq('assigned_to', owner);
    if (text) x = x.or(`company_name.ilike.%${text}%,contact_name.ilike.%${text}%,contact_title.ilike.%${text}%`);
    return q(x);
  }, [demo, stage, prio, country, dept, owner, text, seg]);
  const rows = useMemo(() => (list.data as any[]) ?? [], [list.data]);
  const users = (ref.data?.users ?? []).filter(u => u.is_active);

  const bulkStage = async (s: string) => { if (!s) return; if (await updateLeadStage([...sel], s as Stage)) { toast.success(`${sel.size} lead(s) moved`); setSel(new Set()); list.reload(); } };
  const bulkAssign = async (uid: string) => {
    if (!uid) return;
    const { error } = await supabase.from('leads').update({ assigned_to: uid === 'none' ? null : uid }).in('id', [...sel]);
    if (error) toast.error(error.message); else { toast.success('Assigned'); setSel(new Set()); list.reload(); }
  };

  return (
    <>
      <PageHeader title="Lead Database" subtitle="Every prospect from discovery to conversion. Scores recalculate when research, contacts or signals change."
        actions={<><div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          <button onClick={() => setView('table')} className={cx('px-2.5 h-8 rounded-md text-xs flex items-center gap-1', view === 'table' && 'bg-navy-800 text-white')}><LayoutList className="h-3.5 w-3.5" />Table</button>
          <button onClick={() => setView('kanban')} className={cx('px-2.5 h-8 rounded-md text-xs flex items-center gap-1', view === 'kanban' && 'bg-navy-800 text-white')}><Columns3 className="h-3.5 w-3.5" />Kanban</button>
        </div><ExportButton /></>} />
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 p-4 border-b border-slate-100">
          <Input placeholder="Company, contact or title…" value={text} onChange={e => setText(e.target.value)} className="max-w-xs" />
          <Select value={stage} onChange={e => setStage(e.target.value)} className="w-44"><option value="">All stages</option>{STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
          <Select value={prio} onChange={e => setPrio(e.target.value)} className="w-36"><option value="">All priorities</option><option value="A">Priority A</option><option value="B">Priority B</option><option value="C">Priority C</option><option value="R">Research req.</option></Select>
          <Select value={seg} onChange={e => setSeg(e.target.value)} className="w-52"><option value="">All sector groups</option>{ref.data?.segments.map(s => <option key={s}>{s}</option>)}</Select>
          <Select value={country} onChange={e => setCountry(e.target.value)} className="w-40"><option value="">All countries</option>{ref.data?.countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
          <Select value={dept} onChange={e => setDept(e.target.value)} className="w-48"><option value="">All functions</option>{DEPARTMENTS.map(d => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}</Select>
          <Select value={owner} onChange={e => setOwner(e.target.value)} className="w-44"><option value="">Any owner</option><option value="none">Unassigned</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select>
        </div>
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-navy-50 border-b border-navy-100 text-sm">
            <b>{sel.size} selected</b>
            <Select className="w-48 h-8" value="" onChange={e => bulkStage(e.target.value)}><option value="">Move to stage…</option>{STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
            <Select className="w-48 h-8" value="" onChange={e => bulkAssign(e.target.value)}><option value="">Assign to…</option><option value="none">Unassign</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
          </div>
        )}
        {list.loading ? <Spinner /> : list.error ? <div className="p-4"><Alert tone="error">{list.error}</Alert></div> : !rows.length ? <EmptyState icon={<Database className="h-5 w-5" />} title="No leads match these filters" /> :
          view === 'table' ? (
            <Table><thead><tr><Th><input type="checkbox" className="accent-navy-700" checked={sel.size === rows.length} onChange={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))} /></Th><Th>Score</Th><Th>Company</Th><Th>Decision-maker</Th><Th>Email</Th><Th>Stage</Th><Th>Owner</Th><Th>Next follow-up</Th><Th>Deal</Th></tr></thead>
              <tbody>{rows.map(l => (
                <tr key={l.id} className="hover:bg-slate-50/60 cursor-pointer" onClick={() => nav(`/leads/${l.id}`)}>
                  <Td><input type="checkbox" className="accent-navy-700" checked={sel.has(l.id)} onClick={e => e.stopPropagation()} onChange={() => { const s = new Set(sel); s.has(l.id) ? s.delete(l.id) : s.add(l.id); setSel(s); }} /></Td>
                  <Td><ScoreBadge score={l.score} priority={l.priority} /></Td>
                  <Td><div className="font-medium">{l.company_name}</div><div className="text-[11px] text-ink-faint">{[l.industry_segment, l.industry, l.country_code].filter(Boolean).join(' · ')}</div></Td>
                  <Td className="text-xs">{l.contact_name ? <><div className="font-medium text-ink text-sm">{l.contact_name}{l.do_not_contact && <Badge tone="red" className="ml-1">DNC</Badge>}</div><div className="text-ink-soft">{l.contact_title}</div></> : <span className="text-ink-faint">Not identified</span>}</Td>
                  <Td className="text-xs">{l.contact_email && <div>{l.contact_email}</div>}{l.contact_name && <EmailStatusBadge status={l.email_status} />}</Td>
                  <Td><StageBadge stage={l.stage} /></Td>
                  <Td className="text-xs">{l.assigned_name ?? <span className="text-ink-faint">—</span>}</Td>
                  <Td className={cx('text-xs', l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date() && 'text-red-600 font-medium')}>{fmtDate(l.next_follow_up_at)}</Td>
                  <Td className="text-xs tabular-nums">{l.deal_value ? fmtMoney(l.deal_value, l.currency) : '—'}</Td>
                </tr>))}</tbody></Table>
          ) : <Kanban rows={rows} onMoved={list.reload} />}
      </Card>
    </>
  );
}

function Kanban({ rows, onMoved }: { rows: any[]; onMoved: () => void }) {
  const [drag, setDrag] = useState<string | null>(null); const [over, setOver] = useState<string | null>(null);
  const drop = async (s: Stage) => { setOver(null); if (!drag) return; const l = rows.find(r => r.id === drag); if (l?.stage === s) return; if (await updateLeadStage([drag], s)) onMoved(); setDrag(null); };
  return (
    <div className="flex gap-3 overflow-x-auto p-4 scrollbar-thin">
      {STAGES.map(s => { const items = rows.filter(r => r.stage === s); return (
        <div key={s} onDragOver={e => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={() => drop(s)}
          className={cx('w-64 shrink-0 rounded-xl bg-slate-50 border border-slate-100 flex flex-col max-h-[70vh]', over === s && 'ring-2 ring-navy-300')}>
          <div className="px-3 py-2.5 text-xs font-semibold text-ink-soft flex justify-between"><span>{STAGE_LABEL[s]}</span><span className="tabular-nums">{items.length}</span></div>
          <div className="px-2 pb-2 space-y-2 overflow-y-auto">{items.map(l => (
            <Link key={l.id} to={`/leads/${l.id}`} draggable onDragStart={() => setDrag(l.id)}
              className="block rounded-lg bg-white border border-slate-200 p-2.5 shadow-card hover:shadow-lift transition cursor-grab">
              <div className="flex justify-between gap-2"><div className="text-[13px] font-medium leading-tight">{l.company_name}</div><ScoreBadge score={l.score} priority={l.priority} /></div>
              <div className="text-[11px] text-ink-soft mt-1 truncate">{l.contact_name ? `${l.contact_name} · ${l.contact_title ?? ''}` : 'No contact yet'}</div>
              <div className="text-[10px] text-ink-faint mt-1 flex justify-between"><span>{l.assigned_name ?? 'Unassigned'}</span>{l.next_follow_up_at && <span>↻ {fmtDate(l.next_follow_up_at)}</span>}</div>
            </Link>))}</div>
        </div>); })}
    </div>
  );
}
