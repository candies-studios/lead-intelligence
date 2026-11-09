import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth, ADMINS, MANAGERS } from '@/lib/auth';
import { useAsync, q, fmtDateTime, invalidateRefData } from '@/lib/hooks';
import { DEPARTMENTS, DEPT_LABEL, ROLES, ROLE_LABEL, SENIORITIES, SENIORITY_LABEL } from '@/lib/constants';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, Tabs, Textarea, toast } from '@/components/ui';
import { DEFAULT_WEIGHTS } from '../../supabase/functions/_shared/scoring';

type Tab = 'profile' | 'users' | 'scoring' | 'industries' | 'countries' | 'designations' | 'privacy' | 'duplicates' | 'ai' | 'audit' | 'usage';

export default function Settings() {
  const { can } = useAuth(); const admin = can(...ADMINS); const manager = can(...MANAGERS);
  const [tab, setTab] = useState<Tab>('profile');
  const tabs: { id: Tab; label: string }[] = [{ id: 'profile', label: 'My profile' }, { id: 'privacy', label: 'Privacy & suppression' },
    ...(admin ? [{ id: 'users' as Tab, label: 'Users & roles' }, { id: 'scoring' as Tab, label: 'Lead scoring' }, { id: 'industries' as Tab, label: 'Industries' }, { id: 'countries' as Tab, label: 'Countries' }, { id: 'designations' as Tab, label: 'Designations' }, { id: 'duplicates' as Tab, label: 'Duplicates' }, { id: 'ai' as Tab, label: 'AI & outreach' }, { id: 'audit' as Tab, label: 'Audit log' }] : []),
    ...(manager ? [{ id: 'usage' as Tab, label: 'Usage' }] : [])];
  return (
    <>
      <PageHeader title="Settings" subtitle={admin ? 'Administration: users, roles, targeting, scoring, data quality, and audit.' : 'Your profile and privacy tools.'} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'profile' && <Profile />}{tab === 'users' && <Users />}{tab === 'scoring' && <Scoring />}{tab === 'industries' && <Industries />}
      {tab === 'countries' && <Countries />}{tab === 'designations' && <Designations />}{tab === 'privacy' && <Privacy />}{tab === 'duplicates' && <Duplicates />}
      {tab === 'ai' && <AiSettings />}{tab === 'audit' && <Audit />}{tab === 'usage' && <Usage />}
    </>
  );
}

function Profile() {
  const { profile, refreshProfile } = useAuth(); const [name, setName] = useState(profile?.full_name ?? '');
  return <Card className="max-w-md"><div className="space-y-3"><Field label="Email"><Input value={profile?.email ?? ''} disabled /></Field><Field label="Full name"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
    <Field label="Role"><Input value={profile ? ROLE_LABEL[profile.role] : ''} disabled /></Field>
    <Button variant="primary" onClick={async () => { const { error } = await supabase.from('users').update({ full_name: name }).eq('id', profile!.id); error ? toast.error(error.message) : (toast.success('Saved'), refreshProfile(), invalidateRefData()); }}>Save</Button></div></Card>;
}

function Users() {
  const { profile } = useAuth();
  const list = useAsync(() => q(supabase.from('users').select('*').order('created_at')), []);
  const upd = async (id: string, p: any) => { const { error } = await supabase.from('users').update(p).eq('id', id); error ? toast.error(error.message) : (list.reload(), invalidateRefData()); };
  return (
    <Card pad={false}>
      <div className="p-4 text-xs text-ink-soft border-b border-slate-100">New team members sign up from the login page and start as <b>Sales Executive</b>; change their role here. To restrict sign-ups, disable public sign-up in Supabase Auth and invite users from the Supabase dashboard.</div>
      {list.loading ? <Spinner /> : <Table><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Joined</Th></tr></thead><tbody>
        {(list.data as any[]).map(u => <tr key={u.id}><Td>{u.full_name}</Td><Td className="text-xs">{u.email}</Td>
          <Td><Select className="h-8 w-44" value={u.role} disabled={u.id === profile?.id} onChange={e => upd(u.id, { role: e.target.value })}>{ROLES.map(r => <option key={r} value={r} disabled={r === 'super_admin' && profile?.role !== 'super_admin'}>{ROLE_LABEL[r]}</option>)}</Select></Td>
          <Td>{u.id === profile?.id ? <Badge tone="green">You</Badge> : <Button size="sm" variant={u.is_active ? 'ghost' : 'subtle'} onClick={() => upd(u.id, { is_active: !u.is_active })}>{u.is_active ? 'Deactivate' : 'Reactivate'}</Button>}</Td>
          <Td className="text-xs">{fmtDateTime(u.created_at)}</Td></tr>)}</tbody></Table>}
    </Card>
  );
}

const W_LABEL: Record<string, string> = { industry: 'Industry relevance', company_size: 'Company size and scale', seniority: 'Decision-maker seniority', training_relevance: 'Relevance to commercial training', growth_signals: 'Recent growth / organisational signals', contact_quality: 'Contact information quality', geography: 'Geographic relevance' };
function Scoring() {
  const s = useAsync(() => q(supabase.from('app_settings').select('*').in('key', ['scoring_weights', 'priority_bands'])), []);
  const [w, setW] = useState<Record<string, number>>(DEFAULT_WEIGHTS as any); const [b, setB] = useState({ A: 85, B: 70, C: 50 }); const [busy, setBusy] = useState(false);
  useEffect(() => { const rows = (s.data as any[]) ?? []; const ww = rows.find(r => r.key === 'scoring_weights'); const bb = rows.find(r => r.key === 'priority_bands'); if (ww) setW(ww.value); if (bb) setB(bb.value); }, [s.data]);
  const total = Object.values(w).reduce((a, x) => a + Number(x || 0), 0);
  const save = async (rescore: boolean) => {
    setBusy(true);
    const { error } = await supabase.from('app_settings').upsert([{ key: 'scoring_weights', value: w }, { key: 'priority_bands', value: b }]);
    if (error) { toast.error(error.message); setBusy(false); return; }
    if (rescore) { try { const r = await callFn('score-leads', { all: true }); toast.success(`Rescored ${r.rescored} leads`); } catch (e) { toast.error((e as Error).message); } }
    else toast.success('Saved'); setBusy(false);
  };
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Scoring weights">
        <div className="space-y-3">{Object.keys(W_LABEL).map(k => <div key={k} className="flex items-center gap-3"><span className="flex-1 text-sm">{W_LABEL[k]}</span><Input type="number" min={0} max={100} className="w-20" value={w[k] ?? 0} onChange={e => setW({ ...w, [k]: Number(e.target.value) })} /></div>)}</div>
        <div className={`mt-3 text-sm ${total === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>Total: {total}{total !== 100 && ' — weights are normalised to 100 automatically'}</div>
      </Card>
      <Card title="Priority bands">
        <div className="space-y-3">
          <Field label="Priority A – Highly qualified (≥)"><Input type="number" value={b.A} onChange={e => setB({ ...b, A: +e.target.value })} /></Field>
          <Field label="Priority B – Strong prospect (≥)"><Input type="number" value={b.B} onChange={e => setB({ ...b, B: +e.target.value })} /></Field>
          <Field label="Priority C – Potential prospect (≥)"><Input type="number" value={b.C} onChange={e => setB({ ...b, C: +e.target.value })} /></Field>
          <p className="text-xs text-ink-faint">Below C → “Research required”.</p>
        </div>
        <div className="flex gap-2 mt-4"><Button loading={busy} onClick={() => save(false)}>Save</Button><Button variant="primary" loading={busy} onClick={() => save(true)}>Save & rescore all leads</Button></div>
      </Card>
    </div>
  );
}

function Industries() {
  const list = useAsync(() => q(supabase.from('industries').select('*').order('segment').order('name')), []);
  const [n, setN] = useState({ name: '', segment: 'FMCG', relevance: '1', keywords: '' });
  const upd = async (id: string, p: any) => { const { error } = await supabase.from('industries').update(p).eq('id', id); error ? toast.error(error.message) : (list.reload(), invalidateRefData()); };
  const add = async () => { const { error } = await supabase.from('industries').insert({ name: n.name, segment: n.segment, relevance: +n.relevance, keywords: n.keywords.split(',').map(s => s.trim()).filter(Boolean) }); error ? toast.error(error.message) : (setN({ ...n, name: '', keywords: '' }), list.reload(), invalidateRefData()); };
  return (
    <Card pad={false}>
      <div className="flex flex-wrap gap-2 p-4 border-b border-slate-100 items-end">
        <Field label="Industry"><Input value={n.name} onChange={e => setN({ ...n, name: e.target.value })} /></Field>
        <Field label="Segment"><Select value={n.segment} onChange={e => setN({ ...n, segment: e.target.value })}><option>FMCG</option><option>FMCD</option><option>Related</option></Select></Field>
        <Field label="Relevance 0–1"><Input type="number" step="0.05" min={0} max={1} className="w-24" value={n.relevance} onChange={e => setN({ ...n, relevance: e.target.value })} /></Field>
        <Field label="Search keywords (comma-separated)"><Input className="w-72" value={n.keywords} onChange={e => setN({ ...n, keywords: e.target.value })} /></Field>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!n.name} onClick={add}>Add</Button>
      </div>
      {list.loading ? <Spinner /> : <Table><thead><tr><Th>Industry</Th><Th>Segment</Th><Th>Relevance</Th><Th>Keywords</Th><Th>Active</Th></tr></thead><tbody>
        {(list.data as any[]).map(i => <tr key={i.id}><Td>{i.name}</Td><Td><Badge tone="navy">{i.segment}</Badge></Td>
          <Td><Input type="number" step="0.05" min={0} max={1} className="w-20 h-8" defaultValue={i.relevance} onBlur={e => +e.target.value !== +i.relevance && upd(i.id, { relevance: +e.target.value })} /></Td>
          <Td><Input className="h-8 w-80" defaultValue={i.keywords.join(', ')} onBlur={e => upd(i.id, { keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></Td>
          <Td><input type="checkbox" className="accent-navy-700" checked={i.is_active} onChange={e => upd(i.id, { is_active: e.target.checked })} /></Td></tr>)}</tbody></Table>}
    </Card>
  );
}

function Countries() {
  const list = useAsync(() => q(supabase.from('countries').select('*').order('region').order('name')), []);
  const [n, setN] = useState({ code: '', name: '', region: '', cities: '' });
  const upd = async (code: string, p: any) => { const { error } = await supabase.from('countries').update(p).eq('code', code); error ? toast.error(error.message) : (list.reload(), invalidateRefData()); };
  const add = async () => { const { error } = await supabase.from('countries').insert({ code: n.code.toUpperCase(), name: n.name, region: n.region || 'Other', cities: n.cities.split(',').map(s => s.trim()).filter(Boolean) }); error ? toast.error(error.message) : (setN({ code: '', name: '', region: '', cities: '' }), list.reload(), invalidateRefData()); };
  return (
    <Card pad={false}>
      <div className="flex flex-wrap gap-2 p-4 border-b border-slate-100 items-end">
        <Field label="ISO code"><Input className="w-20" maxLength={2} value={n.code} onChange={e => setN({ ...n, code: e.target.value })} /></Field>
        <Field label="Country"><Input value={n.name} onChange={e => setN({ ...n, name: e.target.value })} /></Field>
        <Field label="Region"><Input value={n.region} onChange={e => setN({ ...n, region: e.target.value })} /></Field>
        <Field label="Key cities"><Input className="w-72" value={n.cities} onChange={e => setN({ ...n, cities: e.target.value })} /></Field>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={n.code.length !== 2 || !n.name} onClick={add}>Add country</Button>
      </div>
      {list.loading ? <Spinner /> : <Table><thead><tr><Th>Code</Th><Th>Country</Th><Th>Region</Th><Th>Cities</Th><Th>Focus market</Th><Th>Active</Th></tr></thead><tbody>
        {(list.data as any[]).map(c => <tr key={c.code}><Td className="font-mono text-xs">{c.code}</Td><Td>{c.name}</Td><Td className="text-xs">{c.region}</Td>
          <Td><Input className="h-8 w-80" defaultValue={c.cities.join(', ')} onBlur={e => upd(c.code, { cities: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></Td>
          <Td><input type="checkbox" className="accent-navy-700" checked={c.is_focus} onChange={e => upd(c.code, { is_focus: e.target.checked })} /></Td>
          <Td><input type="checkbox" className="accent-navy-700" checked={c.is_active} onChange={e => upd(c.code, { is_active: e.target.checked })} /></Td></tr>)}</tbody></Table>}
    </Card>
  );
}

function Designations() {
  const list = useAsync(() => q(supabase.from('designations').select('*').order('priority').order('title')), []);
  const [n, setN] = useState({ title: '', department: 'learning_development', seniority: 'head', priority: '1', aliases: '' });
  const upd = async (id: string, p: any) => { const { error } = await supabase.from('designations').update(p).eq('id', id); error ? toast.error(error.message) : list.reload(); };
  const add = async () => { const { error } = await supabase.from('designations').insert({ ...n, priority: +n.priority, aliases: n.aliases.split(',').map(s => s.trim()).filter(Boolean) }); error ? toast.error(error.message) : (setN({ ...n, title: '', aliases: '' }), list.reload()); };
  return (
    <Card pad={false}>
      <div className="p-4 text-xs text-ink-soft border-b border-slate-100">Target designations and their regional variations. Title classification for discovered contacts uses keyword rules for function and seniority; this list documents the priority targets and is used in reporting.</div>
      <div className="flex flex-wrap gap-2 p-4 border-b border-slate-100 items-end">
        <Field label="Designation"><Input value={n.title} onChange={e => setN({ ...n, title: e.target.value })} /></Field>
        <Field label="Function"><Select value={n.department} onChange={e => setN({ ...n, department: e.target.value })}>{DEPARTMENTS.map(d => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}</Select></Field>
        <Field label="Seniority"><Select value={n.seniority} onChange={e => setN({ ...n, seniority: e.target.value })}>{SENIORITIES.map(s => <option key={s} value={s}>{SENIORITY_LABEL[s]}</option>)}</Select></Field>
        <Field label="Priority"><Select value={n.priority} onChange={e => setN({ ...n, priority: e.target.value })}>{[1, 2, 3, 4].map(p => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Aliases / variations"><Input className="w-64" value={n.aliases} onChange={e => setN({ ...n, aliases: e.target.value })} /></Field>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!n.title} onClick={add}>Add</Button>
      </div>
      {list.loading ? <Spinner /> : <Table><thead><tr><Th>P</Th><Th>Designation</Th><Th>Function</Th><Th>Seniority</Th><Th>Variations</Th><Th>Active</Th></tr></thead><tbody>
        {(list.data as any[]).map(d => <tr key={d.id}><Td><Badge tone="navy">P{d.priority}</Badge></Td><Td>{d.title}</Td><Td className="text-xs">{DEPT_LABEL[d.department]}</Td><Td className="text-xs">{SENIORITY_LABEL[d.seniority]}</Td>
          <Td><Input className="h-8 w-80" defaultValue={d.aliases.join(', ')} onBlur={e => upd(d.id, { aliases: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></Td>
          <Td><input type="checkbox" className="accent-navy-700" checked={d.is_active} onChange={e => upd(d.id, { is_active: e.target.checked })} /></Td></tr>)}</tbody></Table>}
    </Card>
  );
}

function Privacy() {
  const { profile, can } = useAuth();
  const list = useAsync(() => q(supabase.from('suppression_list').select('*').order('created_at', { ascending: false })), []);
  const [v, setV] = useState(''); const [reason, setReason] = useState('do_not_contact'); const [notes, setNotes] = useState('');
  const add = async () => {
    const isDomain = !v.includes('@');
    const { error } = await supabase.from('suppression_list').insert({ [isDomain ? 'domain' : 'email']: v.trim().toLowerCase(), reason, notes: notes || null, created_by: profile?.id });
    error ? toast.error(error.code === '23505' ? 'Already suppressed' : error.message) : (toast.success('Added — matching contacts are now marked do-not-contact'), setV(''), setNotes(''), list.reload());
  };
  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-4">
      <Card title="Suppression & do-not-contact list" pad={false}>
        <div className="flex flex-wrap gap-2 p-4 border-b border-slate-100 items-end">
          <Field label="Email or domain"><Input className="w-64" value={v} onChange={e => setV(e.target.value)} placeholder="name@company.com or company.com" /></Field>
          <Field label="Reason"><Select value={reason} onChange={e => setReason(e.target.value)}><option value="do_not_contact">Do not contact</option><option value="unsubscribed">Unsubscribed</option><option value="bounced">Bounced</option><option value="deletion_request">Deletion request</option><option value="legal">Legal</option></Select></Field>
          <Field label="Notes"><Input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
          <Button variant="primary" disabled={!v} onClick={add}>Suppress</Button>
        </div>
        {list.loading ? <Spinner /> : <Table><thead><tr><Th>Email / domain</Th><Th>Reason</Th><Th>Notes</Th><Th>Added</Th><Th></Th></tr></thead><tbody>
          {(list.data as any[]).map(s => <tr key={s.id}><Td className="text-xs">{s.email ?? `*@${s.domain}`}</Td><Td><Badge>{s.reason}</Badge></Td><Td className="text-xs">{s.notes}</Td><Td className="text-xs">{fmtDateTime(s.created_at)}</Td>
            <Td>{can('super_admin', 'admin') && <Button size="sm" variant="ghost" onClick={async () => { await supabase.from('suppression_list').delete().eq('id', s.id); list.reload(); }}><Trash2 className="h-3.5 w-3.5" /></Button>}</Td></tr>)}</tbody></Table>}
      </Card>
      <Card title="Privacy practices">
        <ul className="text-sm text-ink-soft space-y-2 list-disc pl-4">
          <li>Only professional business information is collected; no sensitive personal data.</li>
          <li>Every externally researched record keeps its source URL and provider.</li>
          <li>Contacts default to “legitimate interest (B2B)” lawful basis; consent status is tracked per contact.</li>
          <li>Suppressed emails/domains block outreach generation and are flagged everywhere.</li>
          <li><b>Correction:</b> edit any contact from its company page. <b>Deletion:</b> admins can permanently erase a contact (their email is kept only on the suppression list so they are never re-added).</li>
          <li>Inferred emails are always labelled and are never shown as verified.</li>
        </ul>
        <p className="text-xs text-ink-faint mt-3">Review GDPR, India’s DPDP Act and provider terms with your counsel before running outreach in a new market.</p>
      </Card>
    </div>
  );
}

function Duplicates() {
  const list = useAsync(() => q(supabase.rpc('company_duplicate_candidates', { p_threshold: 0.6 })), []);
  const merge = async (keep: string, drop: string, name: string) => {
    if (!confirm(`Merge "${name}" into the other record? Contacts, leads, sources and signals move to the kept company.`)) return;
    const { error } = await supabase.rpc('merge_companies', { p_keep: keep, p_drop: drop });
    error ? toast.error(error.message) : (toast.success('Merged'), list.reload());
  };
  return (
    <Card pad={false} title="Possible duplicate companies">
      {list.loading ? <Spinner /> : list.error ? <div className="p-4"><Alert tone="error">{list.error}</Alert></div> : !(list.data as any[])?.length ? <p className="p-5 text-sm text-ink-soft">No likely duplicates found. Discovery already merges records by domain and normalised name.</p> : (
        <Table><thead><tr><Th>Record A</Th><Th>Record B</Th><Th>Country</Th><Th>Similarity</Th><Th></Th></tr></thead><tbody>
          {(list.data as any[]).map(d => <tr key={d.a_id + d.b_id}><Td><Link className="text-navy-700 hover:underline" to={`/companies/${d.a_id}`}>{d.a_name}</Link></Td><Td><Link className="text-navy-700 hover:underline" to={`/companies/${d.b_id}`}>{d.b_name}</Link></Td><Td className="text-xs">{d.country_code}</Td><Td className="tabular-nums text-xs">{Math.round(d.similarity * 100)}%</Td>
            <Td className="whitespace-nowrap"><Button size="sm" onClick={() => merge(d.a_id, d.b_id, d.b_name)}>Keep A</Button> <Button size="sm" onClick={() => merge(d.b_id, d.a_id, d.a_name)}>Keep B</Button></Td></tr>)}</tbody></Table>
      )}
    </Card>
  );
}

function AiSettings() {
  const s = useAsync(() => q(supabase.from('app_settings').select('*').in('key', ['ai_model', 'outreach_defaults'])), []);
  const [model, setModel] = useState('claude-sonnet-5-5'); const [max, setMax] = useState('4000'); const [defaults, setDefaults] = useState('');
  useEffect(() => { const rows = (s.data as any[]) ?? []; const m = rows.find(r => r.key === 'ai_model')?.value; const d = rows.find(r => r.key === 'outreach_defaults')?.value; if (m) { setModel(m.model); setMax(String(m.max_tokens)); } if (d) setDefaults(JSON.stringify(d, null, 2)); }, [s.data]);
  const save = async () => {
    let d; try { d = JSON.parse(defaults || '{}'); } catch { return toast.error('Outreach defaults must be valid JSON'); }
    const { error } = await supabase.from('app_settings').upsert([{ key: 'ai_model', value: { model, max_tokens: +max } }, { key: 'outreach_defaults', value: d }]);
    error ? toast.error(error.message) : toast.success('Saved');
  };
  return (
    <Card className="max-w-xl"><div className="space-y-3">
      <Field label="Claude model" hint="Any Messages-API model id. ANTHROPIC_MODEL env var overrides this."><Input value={model} onChange={e => setModel(e.target.value)} /></Field>
      <Field label="Default max tokens"><Input type="number" value={max} onChange={e => setMax(e.target.value)} /></Field>
      <Field label="Outreach defaults (JSON)"><Textarea rows={5} className="font-mono text-xs" value={defaults} onChange={e => setDefaults(e.target.value)} /></Field>
      <Button variant="primary" onClick={save}>Save</Button>
    </div></Card>
  );
}

function Audit() {
  const list = useAsync(() => q(supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300)), []);
  const users = useAsync(() => q(supabase.from('users').select('id, full_name')), []);
  const name = (id: string) => (users.data as any[])?.find(u => u.id === id)?.full_name ?? (id ? id.slice(0, 8) : 'system');
  return <Card pad={false}>{list.loading ? <Spinner /> : <Table><thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Entity</Th><Th>Details</Th></tr></thead><tbody>
    {(list.data as any[]).map(a => <tr key={a.id}><Td className="text-xs whitespace-nowrap">{fmtDateTime(a.created_at)}</Td><Td className="text-xs">{name(a.actor_id)}</Td><Td><Badge>{a.action}</Badge></Td><Td className="text-xs">{a.entity}</Td><Td className="text-[11px] font-mono text-ink-soft max-w-lg truncate">{JSON.stringify(a.meta)}</Td></tr>)}</tbody></Table>}</Card>;
}

function Usage() {
  const list = useAsync(() => q(supabase.from('usage_events').select('provider, operation, units, success, created_at').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString()).limit(5000)), []);
  const agg = new Map<string, { calls: number; units: number; failed: number }>();
  for (const u of (list.data as any[]) ?? []) { const k = `${u.provider} · ${u.operation}`; const a = agg.get(k) ?? { calls: 0, units: 0, failed: 0 }; a.calls++; a.units += u.units; if (!u.success) a.failed++; agg.set(k, a); }
  return <Card pad={false} title="Provider usage — last 30 days">{list.loading ? <Spinner /> : !agg.size ? <p className="p-5 text-sm text-ink-soft">No provider calls yet.</p> : <Table><thead><tr><Th>Provider · operation</Th><Th>Calls</Th><Th>Units (tokens for AI)</Th><Th>Failed</Th></tr></thead><tbody>
    {[...agg.entries()].sort((a, b) => b[1].calls - a[1].calls).map(([k, v]) => <tr key={k}><Td>{k}</Td><Td className="tabular-nums">{v.calls}</Td><Td className="tabular-nums">{v.units.toLocaleString()}</Td><Td className="tabular-nums">{v.failed}</Td></tr>)}</tbody></Table>}</Card>;
}
