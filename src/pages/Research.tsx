import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { Alert, Button, Card, ConfidenceBadge, EmptyState, PageHeader, Select, Spinner, toast } from '@/components/ui';
import ReportView from '@/components/ReportView';

export default function Research() {
  const { demo } = useAuth();
  const reports = useAsync(() => q(supabase.from('research_reports').select('*, company:companies!inner(id, name, country_code, is_demo)').eq('company.is_demo', demo).order('created_at', { ascending: false }).limit(100)), [demo]);
  const companies = useAsync(() => q(supabase.from('companies').select('id, name').eq('is_demo', demo).order('name').limit(1000)), [demo]);
  const [pick, setPick] = useState(''); const [busy, setBusy] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const gen = async () => {
    setBusy(true);
    try { const r = await callFn('research-company', { company_id: pick }); toast.success('Report generated'); setOpen(r.report.id); reports.reload(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const list = (reports.data as any[]) ?? [];
  const current = list.find(r => r.id === open) ?? list[0];
  return (
    <>
      <PageHeader title="AI Research" subtitle="Company intelligence reports grounded in retrieved sources. Unsupported claims are removed before saving; challenges and needs are presented as hypotheses." />
      <Card className="mb-5"><div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]"><label className="text-xs text-ink-soft">Company</label>
          <Select value={pick} onChange={e => setPick(e.target.value)}><option value="">Select a company…</option>{(companies.data as any[] ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} disabled={!pick} loading={busy} onClick={gen}>Generate AI Company Intelligence Report</Button>
      </div>{busy && <div className="mt-3"><Alert>Gathering website content and search results, then drafting the report. This can take up to 90 seconds.</Alert></div>}</Card>
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
