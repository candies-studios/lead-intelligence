import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserSearch, Linkedin, Play } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, useRefData, q, fmtDate } from '@/lib/hooks';
import { DEPARTMENTS, DEPT_LABEL, EMAIL_STATUS_LABEL, SENIORITIES, SENIORITY_LABEL, providerLabel } from '@/lib/constants';
import { Alert, Badge, Button, Card, ConfidenceBadge, EmailStatusBadge, EmptyState, Input, PageHeader, Select, Spinner, Table, Td, Th, Tabs, toast } from '@/components/ui';
import { FindContactsModal } from './CompanyProfile';

export default function DecisionMakers() {
  const [tab, setTab] = useState<'contacts' | 'find'>('contacts');
  return (
    <>
      <PageHeader title="Find Decision Makers" subtitle="L&D, HR, Sales and Trade Marketing leaders with sourced, confidence-rated contact details. Inferred emails are always labelled and never shown as verified." />
      <Tabs tabs={[{ id: 'contacts', label: 'Decision-maker database' }, { id: 'find', label: 'Companies awaiting contacts' }]} value={tab} onChange={setTab} />
      {tab === 'contacts' ? <ContactsTable /> : <Awaiting />}
    </>
  );
}

function ContactsTable() {
  const { demo } = useAuth(); const ref = useRefData();
  const [text, setText] = useState(''); const [dept, setDept] = useState(''); const [sen, setSen] = useState(''); const [country, setCountry] = useState('');
  const [es, setEs] = useState(''); const [conf, setConf] = useState(''); const [dmOnly, setDmOnly] = useState(true);
  const list = useAsync(() => {
    let x = supabase.from('contacts').select('*, company:companies!inner(id, name, country_code, industry_segment), contact_sources(url)').eq('is_demo', demo).order('designation_priority', { nullsFirst: false }).limit(500);
    if (dept) x = x.eq('department', dept);
    if (sen) x = x.eq('seniority', sen);
    else if (dmOnly) x = x.in('seniority', ['cxo', 'vp', 'director', 'head', 'senior']);
    if (country) x = x.eq('company.country_code', country);
    if (es) x = x.eq('email_status', es);
    if (conf) x = x.eq('confidence', conf);
    if (text) x = x.or(`full_name.ilike.%${text}%,title.ilike.%${text}%`);
    return q(x);
  }, [demo, dept, sen, country, es, conf, text, dmOnly]);
  const rows = (list.data as any[]) ?? [];
  return (
    <Card pad={false}>
      <div className="flex flex-wrap gap-2 p-4 border-b border-slate-100 items-center">
        <Input placeholder="Name or designation…" value={text} onChange={e => setText(e.target.value)} className="max-w-xs" />
        <Select value={dept} onChange={e => setDept(e.target.value)} className="w-52"><option value="">All functions</option>{DEPARTMENTS.map(d => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}</Select>
        <Select value={sen} onChange={e => setSen(e.target.value)} className="w-36"><option value="">All seniority</option>{SENIORITIES.map(s => <option key={s} value={s}>{SENIORITY_LABEL[s]}</option>)}</Select>
        <Select value={country} onChange={e => setCountry(e.target.value)} className="w-40"><option value="">All countries</option>{ref.data?.countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
        <Select value={es} onChange={e => setEs(e.target.value)} className="w-44"><option value="">Any email status</option>{Object.entries(EMAIL_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select value={conf} onChange={e => setConf(e.target.value)} className="w-36"><option value="">Any confidence</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
        <label className="text-xs text-ink-soft flex items-center gap-1.5"><input type="checkbox" checked={dmOnly} onChange={e => setDmOnly(e.target.checked)} className="accent-navy-700" />Decision-makers only</label>
      </div>
      {list.loading ? <Spinner /> : list.error ? <div className="p-4"><Alert tone="error">{list.error}</Alert></div> : !rows.length ? <EmptyState icon={<UserSearch className="h-5 w-5" />} title="No decision-makers match">Open a company and use “Find decision-makers”, or run a campaign.</EmptyState> : (
        <Table><thead><tr><Th>Name</Th><Th>Designation</Th><Th>Company</Th><Th>Function</Th><Th>Email</Th><Th>LinkedIn</Th><Th>Confidence</Th><Th>Source</Th></tr></thead>
          <tbody>{rows.map(p => (
            <tr key={p.id} className="hover:bg-slate-50/60">
              <Td className="font-medium">{p.full_name}{p.do_not_contact && <Badge tone="red" className="ml-1">DNC</Badge>}</Td>
              <Td className="text-xs max-w-[220px]">{p.title}</Td>
              <Td className="text-xs"><Link to={`/companies/${p.company.id}`} className="text-navy-700 hover:underline">{p.company.name}</Link><div className="text-ink-faint">{p.company.country_code}</div></Td>
              <Td className="text-xs">{DEPT_LABEL[p.department]}<div className="text-ink-faint">{SENIORITY_LABEL[p.seniority]}</div></Td>
              <Td className="text-xs">{p.email && <div className="mb-1">{p.email}</div>}<EmailStatusBadge status={p.email_status} /></Td>
              <Td>{p.linkedin_url ? <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="text-navy-600"><Linkedin className="h-4 w-4" /></a> : '—'}</Td>
              <Td><ConfidenceBadge level={p.confidence} /></Td>
              <Td className="text-[11px] text-ink-soft">{providerLabel(p.data_provider)}<div>{p.contact_sources?.[0]?.url ? <a href={p.contact_sources[0].url} target="_blank" rel="noreferrer" className="text-navy-600">view</a> : null} · {fmtDate(p.last_verified_at)}</div></Td>
            </tr>))}</tbody></Table>
      )}
    </Card>
  );
}

function Awaiting() {
  const { demo } = useAuth();
  const list = useAsync(() => q(supabase.from('companies').select('id, name, domain, country_code, industry, employee_count, contacts(count)').eq('is_demo', demo).order('employee_count', { ascending: false, nullsFirst: false }).limit(300)), [demo]);
  const rows = ((list.data as any[]) ?? []).filter(c => !c.contacts?.[0]?.count);
  const [one, setOne] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number; current?: string; log: string[] } | null>(null);
  const runBulk = async () => {
    const targets = rows.slice(0, 25);
    const state = { done: 0, total: targets.length, log: [] as string[] }; setBulk({ ...state });
    for (const c of targets) {
      setBulk({ ...state, current: c.name });
      try { const r = await callFn('find-contacts', { company_id: c.id, limit: 5 }); state.log.push(`${c.name}: ${r.saved} found`); }
      catch (e) { state.log.push(`${c.name}: ${(e as Error).message}`); if ((e as any).status === 412) break; }
      state.done++; setBulk({ ...state });
    }
    setBulk({ ...state, current: undefined }); list.reload(); toast.success('Batch finished');
  };
  return (
    <Card pad={false} title={`${rows.length} companies without identified decision-makers`} action={<Button size="sm" variant="primary" icon={<Play className="h-3.5 w-3.5" />} disabled={!rows.length || (!!bulk && bulk.done < bulk.total)} onClick={runBulk}>Find for next {Math.min(25, rows.length)}</Button>}>
      {bulk && <div className="p-4 border-b border-slate-100 text-xs space-y-1"><div className="font-medium">Processed {bulk.done} / {bulk.total}{bulk.current && ` — now: ${bulk.current}`}</div>{bulk.log.slice(-6).map((l, i) => <div key={i} className="text-ink-soft">• {l}</div>)}</div>}
      {list.loading ? <Spinner /> : !rows.length ? <EmptyState title="Every company has at least one contact" /> : (
        <Table><thead><tr><Th>Company</Th><Th>Domain</Th><Th>Country</Th><Th>Industry</Th><Th></Th></tr></thead>
          <tbody>{rows.map(c => <tr key={c.id}><Td><Link to={`/companies/${c.id}`} className="font-medium hover:underline">{c.name}</Link></Td><Td className="text-xs">{c.domain ?? <span className="text-amber-700">no domain — providers need one</span>}</Td><Td className="text-xs">{c.country_code}</Td><Td className="text-xs">{c.industry}</Td><Td><Button size="sm" onClick={() => setOne(c.id)}>Find</Button></Td></tr>)}</tbody></Table>
      )}
      {one && <FindContactsModal companyId={one} onClose={() => setOne(null)} onDone={() => { setOne(null); list.reload(); }} />}
    </Card>
  );
}
