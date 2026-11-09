import { useState } from 'react';
import { Download } from 'lucide-react';
import { exportData, type ExportScope } from '@/lib/export';
import { useAuth } from '@/lib/auth';
import { useAsync, useRefData, q } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { Button, Field, Modal, Select, toast } from './ui';

const SCOPES: { id: ExportScope; label: string }[] = [
  { id: 'companies', label: 'All companies' }, { id: 'contacts', label: 'All contacts' }, { id: 'qualified', label: 'Qualified leads' },
  { id: 'priority_a', label: 'Priority A leads' }, { id: 'country', label: 'Country-wise leads' }, { id: 'industry', label: 'Industry-wise leads' },
  { id: 'campaign', label: 'Campaign-wise leads' }, { id: 'decision_makers', label: 'Decision-maker list' },
];

export function ExportButton({ defaultScope = 'qualified' as ExportScope }) {
  const [open, setOpen] = useState(false);
  return <><Button icon={<Download className="h-4 w-4" />} onClick={() => setOpen(true)}>Export</Button>{open && <ExportModal defaultScope={defaultScope} onClose={() => setOpen(false)} />}</>;
}

export default function ExportModal({ onClose, defaultScope }: { onClose: () => void; defaultScope: ExportScope }) {
  const { demo } = useAuth(); const ref = useRefData();
  const camps = useAsync(() => q(supabase.from('campaigns').select('id, name').eq('is_demo', demo).order('created_at', { ascending: false })), [demo]);
  const [scope, setScope] = useState<ExportScope>(defaultScope); const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [country, setCountry] = useState('IN'); const [industry, setIndustry] = useState('FMCG'); const [campaignId, setCampaignId] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const n = await exportData({ scope, format, demo, country, industry, campaignId }); toast.success(`Exported ${n} rows`); onClose(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Export data" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={run} disabled={scope === 'campaign' && !campaignId}>Download</Button></>}>
      <div className="space-y-4">
        <Field label="What to export"><Select value={scope} onChange={e => setScope(e.target.value as ExportScope)}>{SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        {scope === 'country' && <Field label="Country"><Select value={country} onChange={e => setCountry(e.target.value)}>{ref.data?.countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>}
        {scope === 'industry' && <Field label="Segment or industry"><Select value={industry} onChange={e => setIndustry(e.target.value)}><option>FMCG</option><option>FMCD</option><option>Related</option>{ref.data?.industries.map(i => <option key={i.id}>{i.name}</option>)}</Select></Field>}
        {scope === 'campaign' && <Field label="Campaign"><Select value={campaignId} onChange={e => setCampaignId(e.target.value)}><option value="">Select…</option>{(camps.data as any[] ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Format"><Select value={format} onChange={e => setFormat(e.target.value as any)}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></Select></Field>
        <p className="text-xs text-ink-faint">Exports include source URLs, email verification status, scores and last-verified dates. {demo && 'Demo mode is on — only demo records will be exported.'}</p>
      </div>
    </Modal>
  );
}
