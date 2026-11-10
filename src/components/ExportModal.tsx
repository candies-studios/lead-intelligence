import { useState } from 'react';
import { Download } from 'lucide-react';
import { exportData, type ExportScope } from '@/lib/export';
import { useAuth } from '@/lib/auth';
import { useAsync, useRefData, q } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { Button, Field, Modal, Select, toast, MultiSelect } from './ui';
import { countryOptions, industryOptions } from '@/lib/options';

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
  const [countries, setCountries] = useState<string[]>(['IN']); const [industries, setIndustries] = useState<string[]>([]); const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const n = await exportData({ scope, format, demo, countries, industries, campaignIds }); toast.success(`Exported ${n} rows`); onClose(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Export data" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={run} disabled={(scope === 'campaign' && !campaignIds.length) || (scope === 'industry' && !industries.length) || (scope === 'country' && !countries.length)}>Download</Button></>}>
      <div className="space-y-4">
        <Field label="What to export"><Select value={scope} onChange={e => setScope(e.target.value as ExportScope)}>{SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        {scope === 'country' && <Field label="Countries"><MultiSelect options={countryOptions(ref.data, false)} value={countries} onChange={setCountries} placeholder="Select countries" /></Field>}
        {scope === 'industry' && <Field label="Sector groups or industries"><MultiSelect options={[...(ref.data?.segments ?? []).map(sg => ({ value: sg, label: `All of ${sg}`, group: 'Whole sector groups' })), ...industryOptions(ref.data)]} value={industries} onChange={setIndustries} placeholder="Select sectors / industries" /></Field>}
        {scope === 'campaign' && <Field label="Campaigns"><MultiSelect options={((camps.data as any[]) ?? []).map(c => ({ value: c.id, label: c.name }))} value={campaignIds} onChange={setCampaignIds} placeholder="Select campaigns" /></Field>}
        <Field label="Format"><Select value={format} onChange={e => setFormat(e.target.value as any)}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></Select></Field>
        <p className="text-xs text-ink-faint">Exports include source URLs, email verification status, scores and last-verified dates. {demo && 'Demo mode is on — only demo records will be exported.'}</p>
      </div>
    </Modal>
  );
}
