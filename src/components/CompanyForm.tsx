import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useRefData } from '@/lib/hooks';
import { Button, Field, Input, Modal, Select, Textarea, toast, Alert } from './ui';

const empty = { name: '', website: '', industry: '', country_code: '', hq_city: '', linkedin_url: '', employee_count: '', revenue_text: '', classification: 'unknown', ownership: 'unknown', parent_company_name: '', description: '', source_url: '' };

/** Manual research fallback — every manual record must carry a source URL. */
export default function CompanyForm({ open, onClose, onSaved, initial }: { open: boolean; onClose: () => void; onSaved: (id: string) => void; initial?: any }) {
  const { demo, profile } = useAuth();
  const ref = useRefData();
  const [f, setF] = useState<any>(initial ? { ...empty, ...initial, employee_count: initial.employee_count ?? '' } : empty);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (!f.name.trim()) throw new Error('Company name is required');
      if (!initial && !/^https?:\/\//.test(f.source_url)) throw new Error('Add the source URL where you verified this company (e.g. its website or annual report).');
      const ind = ref.data?.industries.find(i => i.name === f.industry);
      let domain: string | null = null;
      try { domain = f.website ? new URL(f.website.startsWith('http') ? f.website : `https://${f.website}`).hostname.replace(/^www\./, '') : null; } catch { throw new Error('Website is not a valid URL'); }
      const row: any = {
        name: f.name.trim(), website: f.website || null, domain, industry: f.industry || null, industry_segment: ind?.segment ?? null,
        country_code: f.country_code || null, hq_city: f.hq_city || null, linkedin_url: f.linkedin_url || null,
        employee_count: f.employee_count === '' ? null : Number(f.employee_count), revenue_text: f.revenue_text || null,
        classification: f.classification, ownership: f.ownership, parent_company_name: f.parent_company_name || null,
        description: f.description || null, last_verified_at: new Date().toISOString(),
      };
      if (row.parent_company_name) {
        const { data } = await supabase.rpc('find_company_by_name', { p_name: row.parent_company_name, p_country: null, p_demo: demo });
        row.parent_company_id = (data as any[])?.[0]?.id ?? null;
      }
      let id = initial?.id;
      if (id) {
        const { error } = await supabase.from('companies').update(row).eq('id', id); if (error) throw error;
      } else {
        const { data: dup } = await supabase.rpc('find_company_by_name', { p_name: row.name, p_country: row.country_code, p_demo: demo });
        if ((dup as any[])?.length) throw new Error(`Possible duplicate: "${(dup as any[])[0].name}" already exists. Open it instead or use a more specific name.`);
        const { data, error } = await supabase.from('companies').insert({ ...row, data_provider: 'manual', is_demo: demo, created_by: profile?.id }).select('id').single();
        if (error) throw new Error(error.code === '23505' ? 'A company with this domain or name already exists.' : error.message);
        id = data.id;
        await supabase.from('company_sources').insert({ company_id: id, url: f.source_url, source_type: 'manual', provider: 'manual', title: 'Manually verified source' });
        await supabase.from('leads').insert({ company_id: id, stage: 'research_pending', source: 'manual', is_demo: demo, created_by: profile?.id });
      }
      toast.success(initial ? 'Company updated' : 'Company added');
      onSaved(id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit company' : 'Add company manually'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Company name *"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Official website"><Input value={f.website} onChange={set('website')} placeholder="https://" /></Field>
        <Field label="Industry"><Select value={f.industry} onChange={set('industry')}><option value="">—</option>
          {['FMCG', 'FMCD', 'Related'].map(seg => <optgroup key={seg} label={seg}>{ref.data?.industries.filter(i => i.segment === seg && i.is_active).map(i => <option key={i.id}>{i.name}</option>)}</optgroup>)}
        </Select></Field>
        <Field label="Country"><Select value={f.country_code} onChange={set('country_code')}><option value="">—</option>{ref.data?.countries.filter(c => c.is_active).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
        <Field label="Headquarters city"><Input value={f.hq_city} onChange={set('hq_city')} /></Field>
        <Field label="Company LinkedIn page"><Input value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="https://www.linkedin.com/company/…" /></Field>
        <Field label="Estimated employees"><Input type="number" min={0} value={f.employee_count} onChange={set('employee_count')} /></Field>
        <Field label="Estimated revenue (public sources)"><Input value={f.revenue_text} onChange={set('revenue_text')} placeholder="e.g. US$1.2bn FY2025" /></Field>
        <Field label="Classification"><Select value={f.classification} onChange={set('classification')}>{['manufacturer', 'distributor', 'retailer', 'ecommerce', 'mixed', 'unknown'].map(o => <option key={o}>{o}</option>)}</Select></Field>
        <Field label="Ownership"><Select value={f.ownership} onChange={set('ownership')}>{['public', 'private', 'subsidiary', 'unknown'].map(o => <option key={o}>{o}</option>)}</Select></Field>
        <Field label="Parent company"><Input value={f.parent_company_name} onChange={set('parent_company_name')} /></Field>
        {!initial && <Field label="Source URL *" hint="Where you verified this information"><Input value={f.source_url} onChange={set('source_url')} placeholder="https://" /></Field>}
        <Field label="Business description" className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={set('description')} /></Field>
      </div>
    </Modal>
  );
}
