import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Rocket, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, useRefData, q, fmtDate } from '@/lib/hooks';
import { DEPARTMENTS, DEPT_LABEL, SENIORITY_LABEL } from '@/lib/constants';
import { Alert, Badge, Button, Card, ChipSelect, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th, Textarea, Select, toast } from '@/components/ui';

export const STATUS_TONE: Record<string, any> = { draft: 'slate', running: 'blue', paused: 'amber', cancelled: 'red', completed: 'green', failed: 'red' };

export default function Campaigns() {
  const { demo } = useAuth();
  const [creating, setCreating] = useState(false);
  const list = useAsync(() => q(supabase.from('campaigns').select('*, owner:users!campaigns_owner_id_fkey(full_name)').eq('is_demo', demo).order('created_at', { ascending: false })), [demo]);
  return (
    <>
      <PageHeader title="Campaigns" subtitle="Define a search campaign and let the platform discover companies, find decision-makers, detect signals and score every prospect — with live, step-by-step status."
        actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New campaign</Button>} />
      <Card pad={false}>
        {list.loading ? <Spinner /> : !(list.data as any[])?.length ? <EmptyState icon={<Rocket className="h-5 w-5" />} title="No campaigns yet" action={<Button variant="primary" onClick={() => setCreating(true)}>Create your first campaign</Button>}>Example: “FMCG Decision Makers – India”, 500+ employees, L&D/HR/Sales/Trade Marketing, Director and above.</EmptyState> : (
          <Table><thead><tr><Th>Campaign</Th><Th>Status</Th><Th>Markets</Th><Th>Companies</Th><Th>Decision-makers</Th><Th>Leads</Th><Th>Owner</Th><Th>Created</Th></tr></thead>
            <tbody>{(list.data as any[]).map(c => (
              <tr key={c.id} className="hover:bg-slate-50/60">
                <Td><Link to={`/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link><div className="text-[11px] text-ink-faint">{c.segments.join(', ')}{c.min_employees ? ` · ${c.min_employees}+ employees` : ''}</div></Td>
                <Td><Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge></Td>
                <Td className="text-xs">{c.countries.join(', ')}</Td>
                <Td className="text-xs tabular-nums">{c.progress.companies_processed ?? 0} / {c.progress.companies_found ?? 0} <span className="text-ink-faint">(target {c.target_companies})</span></Td>
                <Td className="text-xs tabular-nums">{c.progress.contacts_found ?? 0}</Td>
                <Td className="text-xs tabular-nums">{c.progress.leads_created ?? 0}</Td>
                <Td className="text-xs">{c.owner?.full_name ?? '—'}</Td>
                <Td className="text-xs">{fmtDate(c.created_at)}</Td>
              </tr>))}</tbody></Table>
        )}
      </Card>
      {creating && <CampaignForm onClose={() => setCreating(false)} />}
    </>
  );
}

function CampaignForm({ onClose }: { onClose: () => void }) {
  const { profile, demo } = useAuth(); const ref = useRefData(); const nav = useNavigate();
  const [f, setF] = useState({ name: 'FMCG Decision Makers – India', description: '', segments: ['FMCG'], industries: [] as string[], countries: ['IN'], cities: '', min_employees: '500', max_employees: '',
    departments: ['learning_development', 'human_resources', 'sales', 'trade_marketing'], seniorities: ['director', 'vp', 'head', 'cxo'], target_companies: '100', contacts_per_company: '5',
    detect_signals: true, enrich_emails: false, provider: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (!f.name.trim()) throw new Error('Name is required');
      if (!f.countries.length) throw new Error('Pick at least one country');
      const { data, error } = await supabase.from('campaigns').insert({
        name: f.name.trim(), description: f.description || null, segments: f.segments, industries: f.industries, countries: f.countries,
        cities: f.cities ? f.cities.split(',').map(s => s.trim()).filter(Boolean) : [], min_employees: f.min_employees ? +f.min_employees : null, max_employees: f.max_employees ? +f.max_employees : null,
        departments: f.departments, seniorities: f.seniorities, target_companies: +f.target_companies, contacts_per_company: +f.contacts_per_company,
        options: { detect_signals: f.detect_signals, enrich_emails: f.enrich_emails, providers: f.provider ? [f.provider] : [] },
        owner_id: profile?.id, created_by: profile?.id, is_demo: demo,
      }).select('id').single();
      if (error) throw error;
      toast.success('Campaign created'); nav(`/campaigns/${data.id}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const indOpts = (ref.data?.industries ?? []).filter(i => i.is_active && f.segments.includes(i.segment)).map(i => i.name);
  return (
    <Modal open wide onClose={onClose} title="New discovery campaign" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Create campaign</Button></>}>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Campaign name" className="sm:col-span-2"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Industry segments"><ChipSelect options={['FMCG', 'FMCD', 'Related'] as const} value={f.segments as any} onChange={v => setF({ ...f, segments: v, industries: [] })} /></Field>
        <Field label="Specific industries (optional)"><ChipSelect options={indOpts} value={f.industries} onChange={v => setF({ ...f, industries: v })} /></Field>
        <Field label="Countries" className="sm:col-span-2"><ChipSelect options={(ref.data?.countries ?? []).filter(c => c.is_active).map(c => c.code)} value={f.countries} onChange={v => setF({ ...f, countries: v })} labels={Object.fromEntries((ref.data?.countries ?? []).map(c => [c.code, c.name]))} /></Field>
        <Field label="Cities (optional, comma-separated)"><Input value={f.cities} onChange={e => setF({ ...f, cities: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Min employees"><Input type="number" value={f.min_employees} onChange={e => setF({ ...f, min_employees: e.target.value })} /></Field><Field label="Max employees"><Input type="number" value={f.max_employees} onChange={e => setF({ ...f, max_employees: e.target.value })} /></Field></div>
        <Field label="Target departments"><ChipSelect options={DEPARTMENTS.filter(d => d !== 'other')} value={f.departments} onChange={v => setF({ ...f, departments: v })} labels={DEPT_LABEL} /></Field>
        <Field label="Target seniority"><ChipSelect options={['cxo', 'vp', 'director', 'head', 'senior', 'manager'] as const} value={f.seniorities as any} onChange={v => setF({ ...f, seniorities: v })} labels={SENIORITY_LABEL} /></Field>
        <Field label="Number of companies to discover"><Input type="number" min={1} max={1000} value={f.target_companies} onChange={e => setF({ ...f, target_companies: e.target.value })} /></Field>
        <Field label="Contacts per company (up to)"><Input type="number" min={1} max={15} value={f.contacts_per_company} onChange={e => setF({ ...f, contacts_per_company: e.target.value })} /></Field>
        <Field label="Preferred discovery provider"><Select value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })}><option value="">Auto (Apollo → PDL → Claude)</option><option value="apollo">Apollo</option><option value="pdl">People Data Labs</option><option value="anthropic">Claude web search</option></Select></Field>
        <div className="space-y-2 pt-5">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.detect_signals} onChange={e => setF({ ...f, detect_signals: e.target.checked })} className="accent-navy-700" />Detect buying signals for each company</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enrich_emails} onChange={e => setF({ ...f, enrich_emails: e.target.checked })} className="accent-navy-700" />Enrich & verify emails (uses provider credits)</label>
        </div>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
