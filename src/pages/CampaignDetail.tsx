import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Play, Pause, Square, RotateCcw } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAsync, q, fmtDateTime } from '@/lib/hooks';
import { DEPT_LABEL, SENIORITY_LABEL } from '@/lib/constants';
import { Alert, Badge, Button, Card, PageHeader, ScoreBadge, Spinner, Stat, Table, Td, Th, toast, cx } from '@/components/ui';
import { STATUS_TONE } from './Campaigns';
import { ExportButton } from '@/components/ExportModal';

export default function CampaignDetail() {
  const { id } = useParams();
  const camp = useAsync(() => q(supabase.from('campaigns').select('*').eq('id', id!).single()), [id]);
  const events = useAsync(() => q(supabase.from('campaign_events').select('*').eq('campaign_id', id!).order('created_at', { ascending: false }).limit(80)), [id]);
  const companies = useAsync(() => q(supabase.from('campaign_companies').select('id, status, error, company:companies(id, name, country_code, employee_count, leads(id, score, priority, primary_contact_id))').eq('campaign_id', id!).order('created_at')), [id]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const c: any = camp.data;

  const refresh = () => { camp.reload(); events.reload(); companies.reload(); };
  // Step loop: each call performs one real unit of server-side work.
  const loop = async () => {
    if (running) return;
    setRunning(true); stopRef.current = false;
    try {
      while (!stopRef.current) {
        const r = await callFn('campaign-runner', { campaign_id: id, action: 'step' });
        events.reload(); camp.reload();
        if (r.done || r.status !== 'running') break;
        if (r.phase === 'enrichment') companies.reload();
        await new Promise(res => setTimeout(res, r.busy ? 4000 : 400));
      }
    } catch (e) { toast.error((e as Error).message); }
    finally { setRunning(false); refresh(); }
  };
  useEffect(() => { if (c?.status === 'running' && !running) loop(); /* resume loop if page opened while running */ // eslint-disable-next-line
  }, [c?.status]);
  useEffect(() => () => { stopRef.current = true; }, []);

  const act = async (action: string) => {
    try {
      if (action === 'pause' || action === 'cancel') stopRef.current = true;
      await callFn('campaign-runner', { campaign_id: id, action });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  if (camp.loading && !c) return <Spinner />;
  if (!c) return <Alert tone="error">{camp.error ?? 'Campaign not found'}</Alert>;
  const p = c.progress ?? {};
  const pct = c.target_companies ? Math.min(100, Math.round(((p.companies_processed ?? 0) / Math.max(1, Math.min(c.target_companies, p.discovery_exhausted ? p.companies_found || 1 : c.target_companies))) * 100)) : 0;
  const rows = (companies.data as any[]) ?? [];

  return (
    <>
      <PageHeader title={c.name} subtitle={<span className="flex flex-wrap gap-2 items-center"><Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>{c.segments.join(', ')} · {c.countries.join(', ')}{c.min_employees ? ` · ${c.min_employees}+ employees` : ''} · {c.departments.map((d: string) => DEPT_LABEL[d]).join(', ')} · {c.seniorities.map((s: string) => SENIORITY_LABEL[s]).join('/')}</span>}
        actions={<>
          {c.status === 'draft' && <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={async () => { await act('start'); }}>Start AI Lead Discovery</Button>}
          {(c.status === 'paused' || c.status === 'failed') && <Button variant="primary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => act('resume')}>Resume</Button>}
          {c.status === 'running' && <Button icon={<Pause className="h-4 w-4" />} onClick={() => act('pause')}>Pause</Button>}
          {['running', 'paused', 'draft', 'failed'].includes(c.status) && <Button variant="danger" icon={<Square className="h-4 w-4" />} onClick={() => confirm('Cancel this campaign? Saved records are kept.') && act('cancel')}>Cancel</Button>}
          <ExportButton defaultScope="campaign" />
        </>} />
      {c.last_error && <div className="mb-4"><Alert tone="error" title="Last error">{c.last_error} {c.last_error.includes('connect') && <Link className="underline" to="/integrations">Open Integrations</Link>}</Alert></div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Stat label="Companies linked" value={`${p.companies_found ?? 0}`} sub={`target ${c.target_companies}${p.discovery_exhausted ? ' · provider exhausted' : ''}`} />
        <Stat label="Companies researched" value={p.companies_processed ?? 0} />
        <Stat label="Decision-makers" value={p.contacts_found ?? 0} sub={`up to ${c.contacts_per_company}/company`} />
        <Stat label="Signals" value={p.signals_found ?? 0} />
        <Stat label="Leads created" value={p.leads_created ?? 0} />
      </div>
      <Card className="mb-4"><div className="flex items-center gap-3 text-sm">
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className={cx('h-full rounded-full transition-all', c.status === 'completed' ? 'bg-emerald-500' : 'bg-navy-600')} style={{ width: `${c.status === 'completed' ? 100 : pct}%` }} /></div>
        <span className="tabular-nums text-ink-soft w-56 text-right">{running ? (p.companies_found < c.target_companies && !p.discovery_exhausted ? `Discovering (page ${p.discovery_page ?? 1})…` : 'Researching companies…') : c.status === 'completed' ? 'Completed' : c.status}</span>
      </div><p className="text-[11px] text-ink-faint mt-2">Progress reflects real server-side work recorded in the database. Keep this page open while the campaign runs (or schedule the runner with pg_cron — see README).</p></Card>

      <div className="grid xl:grid-cols-[1fr_420px] gap-4">
        <Card title={`Companies (${rows.length})`} pad={false}>
          {!rows.length ? <p className="p-5 text-sm text-ink-soft">No companies linked yet.</p> : (
            <Table><thead><tr><Th>Company</Th><Th>Status</Th><Th>Contacts</Th><Th>Best score</Th></tr></thead>
              <tbody>{rows.map(r => { const ls = r.company?.leads ?? []; const best = ls.reduce((a: any, b: any) => (b.score ?? -1) > (a?.score ?? -1) ? b : a, null); return (
                <tr key={r.id}><Td><Link to={`/companies/${r.company.id}`} className="font-medium hover:underline">{r.company.name}</Link><div className="text-[11px] text-ink-faint">{r.company.country_code}</div></Td>
                  <Td><Badge tone={r.status === 'enriched' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'enriching' ? 'blue' : 'slate'}>{r.status}</Badge>{r.error && <div className="text-[11px] text-red-600 mt-0.5 max-w-xs">{r.error}</div>}</Td>
                  <Td className="tabular-nums text-xs">{ls.filter((l: any) => l.primary_contact_id).length}</Td>
                  <Td>{best ? <Link to={`/leads/${best.id}`}><ScoreBadge score={best.score} priority={best.priority} /></Link> : '—'}</Td></tr>); })}</tbody></Table>
          )}
        </Card>
        <Card title="Live processing log" pad={false}>
          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100 text-xs font-mono">{(events.data as any[] ?? []).map(e => (
            <li key={e.id} className="px-4 py-2 flex gap-2"><span className="text-ink-faint shrink-0">{fmtDateTime(e.created_at)}</span>
              <span className={cx(e.level === 'error' && 'text-red-600', e.level === 'warn' && 'text-amber-700', e.level === 'success' && 'text-emerald-700')}>{e.message}</span></li>))}
            {!(events.data as any[])?.length && <li className="px-4 py-3 text-ink-faint">No activity yet.</li>}</ul>
        </Card>
      </div>
    </>
  );
}
