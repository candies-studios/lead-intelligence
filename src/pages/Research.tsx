import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { Alert, Button, Card, ConfidenceBadge, EmptyState, PageHeader, Spinner, toast, MultiSelect } from '@/components/ui';
import ReportView from '@/components/ReportView';

export default function Research() {
  const { demo } = useAuth();
  const reports = useAsync(() => q(supabase.from('research_reports').select('*, company:companies!inner(id, name, country_code, is_demo)').eq('company.is_demo', demo).order('created_at', { ascending: false }).limit(100)), [demo]);
  const companies = useAsync(() => q(supabase.from('companies').select('id, name').eq('is_demo', demo).order('name').limit(1000)), [demo]);
  const [pick, setPick] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; current?: string; failed: string[] } | null>(null);
  const gen = async () => {
    setBusy(true);
    const names = new Map(((companies.data as any[]) ?? []).map(c => [c.id, c.name]));
    const st = { done: 0, total: pick.length, failed: [] as string[] };
    setProgress({ ...st });
    for (const id of pick) {
      setProgress({ ...st, current: names.get(id) });
      try { const r = await callFn('research-company', { company_id: id }); setOpen(r.report.id); reports.reload(); }
      catch (e) { st.failed.push(`${names.get(id)}: ${(e as Error).message}`); if ((e as any).status === 412) break; }
      st.done++; setProgress({ ...st });
    }
    setProgress({ ...st, current: undefined });
    st.failed.length ? toast.error(`${st.done - st.failed.length} report(s) generated, ${st.failed.length} failed`) : toast.success(`${st.done} report(s) generated`);
    setBusy(false); setPick([]);
  };
  const list = (reports.data as any[]) ?? [];
  const current = list.find(r => r.id === open) ?? list[0];
  return (
    <>
      <PageHeader title="AI Research" subtitle="Company intelligence reports grounded in retrieved sources. Unsupported claims are removed before saving; challenges and needs are presented as hypotheses." />
      <Card className="mb-5"><div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]"><label className="text-xs text-ink-soft">Companies</label>
          <MultiSelect options={((companies.data as any[]) ?? []).map(c => ({ value: c.id, label: c.name }))} value={pick} onChange={setPick} placeholder="Select one or more companies…" /></div>
        <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} disabled={!pick.length} loading={busy} onClick={gen}>Generate AI Company Intelligence Report{pick.length > 1 ? `s (${pick.length})` : ''}</Button>
      </div>{progress && (busy || progress.failed.length > 0) && <div className="mt-3 space-y-2"><Alert tone={progress.failed.length ? 'warn' : 'info'}>{busy ? <>Researching {progress.current ?? '…'} — {progress.done} of {progress.total} done. Each report takes up to 90 seconds; keep this page open.</> : <>Finished {progress.done} of {progress.total}.</>}{progress.failed.map((f, i) => <div key={i} className="text-xs mt-1">• {f}</div>)}</Alert></div>}</Card>
      {reports.loading ? <Spinner /> : !list.length ? <Card><EmptyState icon={<Sparkles className="h-5 w-5" />} title="No reports yet">Select a company above to generate its first intelligence report.</EmptyState></Card> : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card pad={false} title="Reports"><ul className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">{list.map(r => (
            <li key={r.id}><button onClick={() => setOpen(r.id)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${current?.id === r.id ? 'bg-navy-50/60' : ''}`}>
              <div className="text-sm font-medium">{r.company.name}</div><div className="flex items-center gap-2 text-[11px] text-ink-faint mt-0.5">{fmtDateTime(r.created_at)}<ConfidenceBadge level={r.report?.confidence?.overall} /></div>
            </button></li>))}</ul></Card>
          {current && <Card title={<Link to={`/companies/${current.company.id}`} className="hover:underline">{current.company.name}</Link>}><ReportView report={current} /></Card>}
        </div>
      )}
    </>
  );
}
