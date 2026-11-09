import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { classifyTitle } from '../../supabase/functions/_shared/titles';
import { DEPARTMENTS, DEPT_LABEL, SENIORITIES, SENIORITY_LABEL } from '@/lib/constants';
import { Alert, Button, Field, Input, Modal, Select, Textarea, toast } from './ui';

/** Manual contact entry / edit. Manually entered emails can never be marked "verified" here. */
export default function ContactForm({ companyId, companyCountry, initial, onClose, onSaved }: { companyId: string; companyCountry?: string | null; initial?: any; onClose: () => void; onSaved: () => void }) {
  const { profile, demo } = useAuth();
  const [f, setF] = useState<any>(initial ?? { full_name: '', title: '', department: '', seniority: '', email: '', email_status: 'unverified', phone: '', linkedin_url: '', bio: '', source_url: '', confidence: 'medium' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const auto = classifyTitle(f.title);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (!f.full_name.trim() || !f.title.trim()) throw new Error('Name and current designation are required');
      if (!initial && !/^https?:\/\//.test(f.source_url)) throw new Error('A source URL is required (company leadership page, press release, etc.).');
      if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw new Error('Email format is invalid');
      const [first, ...rest] = f.full_name.trim().split(/\s+/);
      const row: any = {
        company_id: companyId, full_name: f.full_name.trim(), first_name: first, last_name: rest.join(' ') || null, title: f.title.trim(),
        department: f.department || auto.department, seniority: f.seniority || auto.seniority, designation_priority: auto.priority,
        email: f.email ? f.email.toLowerCase().trim() : null,
        email_status: f.email ? (f.email_status === 'verified' && initial?.email_status === 'verified' ? 'verified' : f.email_status) : 'unavailable',
        email_provider: f.email ? (f.email_status === 'inferred_pattern' ? 'pattern_inference' : initial?.email_provider ?? 'manual') : null,
        phone: f.phone || null, linkedin_url: f.linkedin_url || null, bio: f.bio || null, confidence: f.confidence,
        country_code: initial?.country_code ?? companyCountry ?? null, last_verified_at: new Date().toISOString(),
      };
      if (initial) {
        const { error } = await supabase.from('contacts').update(row).eq('id', initial.id); if (error) throw error;
      } else {
        const { data, error } = await supabase.from('contacts').insert({ ...row, data_provider: 'manual', is_demo: demo, created_by: profile?.id }).select('id').single();
        if (error) throw new Error(error.code === '23505' ? 'This person or email already exists in the database.' : error.message);
        await supabase.from('contact_sources').insert({ contact_id: data.id, url: f.source_url, provider: 'manual', field: 'profile' });
        await supabase.from('leads').insert({ company_id: companyId, primary_contact_id: data.id, stage: 'contact_identified', source: 'manual', is_demo: demo, created_by: profile?.id });
      }
      toast.success('Contact saved'); onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={initial ? 'Edit contact' : 'Add decision-maker manually'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Full name *"><Input value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Current designation *" hint={f.title ? `Auto-classified: ${DEPT_LABEL[auto.department]} · ${SENIORITY_LABEL[auto.seniority]}` : undefined}><Input value={f.title} onChange={set('title')} /></Field>
        <Field label="Department (override)"><Select value={f.department} onChange={set('department')}><option value="">Auto</option>{DEPARTMENTS.map(d => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}</Select></Field>
        <Field label="Seniority (override)"><Select value={f.seniority} onChange={set('seniority')}><option value="">Auto</option>{SENIORITIES.map(s => <option key={s} value={s}>{SENIORITY_LABEL[s]}</option>)}</Select></Field>
        <Field label="Professional email"><Input value={f.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Email status" hint="Verified status can only come from a verification provider"><Select value={f.email_status} onChange={set('email_status')}>
          {initial?.email_status === 'verified' && <option value="verified">Verified (provider)</option>}
          <option value="unverified">Found publicly – unverified</option><option value="inferred_pattern">Inferred from pattern</option>
          {initial?.email_status === 'provider_returned' && <option value="provider_returned">Provider-returned</option>}
        </Select></Field>
        <Field label="Business phone (lawfully available)"><Input value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="LinkedIn profile URL"><Input value={f.linkedin_url ?? ''} onChange={set('linkedin_url')} placeholder="https://www.linkedin.com/in/…" /></Field>
        <Field label="Confidence"><Select value={f.confidence} onChange={set('confidence')}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select></Field>
        {!initial && <Field label="Source URL *"><Input value={f.source_url} onChange={set('source_url')} placeholder="https://" /></Field>}
        <Field label="Professional summary" className="sm:col-span-2"><Textarea rows={2} value={f.bio ?? ''} onChange={set('bio')} /></Field>
      </div>
    </Modal>
  );
}
