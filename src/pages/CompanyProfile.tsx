import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Sparkles, UserSearch, Radar, Pencil, Plus, Send, Linkedin, Mail } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtNum, fmtDate, fmtDateTime } from '@/lib/hooks';
import { TARGET_DEPARTMENTS, DEPT_LABEL, SENIORITY_LABEL, SIGNAL_LABEL, providerLabel } from '@/lib/constants';
import { Alert, Badge, Button, Card, ConfidenceBadge, EmailStatusBadge, EmptyState, ExternalLink, Field, Input, Modal, PageHeader, ScoreBadge, Spinner, Table, Td, Th, StageBadge, toast, MultiSelect, Select } from '@/components/ui';
import { toOptions } from '@/lib/options';
import CompanyForm from '@/components/CompanyForm';
import ContactForm from '@/components/ContactForm';
import ReportView from '@/components/ReportView';
import Notes from '@/components/Notes';

export default function CompanyProfile() {
  const { id } = useParams();
  const { can } = useAuth();
  const c = useAsync(() => q(supabase.from('companies').select('*, parent:companies!companies_parent_company_id_fkey(id, name), company_brands(*), company_sources(*)').eq('id', id!).single()), [id]);
  const subs = useAsync(() => q(supabase.from('companies').select('id, name, country_code').eq('parent_company_id', id!)), [id]);
  const contacts = useAsync(() => q(supabase.from('contacts').select('*, contact_sources(url, provider)').eq('company_id', id!).order('designation_priority', { nullsFirst: false }).order('seniority')), [id]);
  const signals = useAsync(() => q(supabase.from('buying_signals').select('*').eq('company_id', id!).order('published_at', { ascending: false, nullsFirst: false })), [id]);
  const reports = useAsync(() => q(supabase.from('research_reports').select('*').eq('company_id', id!).order('created_at', { ascending: false }).limit(5)), [id]);
  const leads = useAsync(() => q(supabase.from('leads').select('id, stage, score, priority, primary_contact_id, contact:contacts(full_name)').eq('company_id', id!).order('score', { ascending: false })), [id]);
  const [editing, setEditing] = useState(false); const [addContact, setAddContact] = useState(false); const [editContact, setEditContact] = useState<any>(null);
  const [finding, setFinding] = useState(false); const [researching, setResearching] = useState(false); const [signalBusy, setSignalBusy] = useState(false);
  const [reportIdx, setReportIdx] = useState(0);

  if (c.loading) return <Spinner />;
  if (c.error || !c.data) return <Alert tone="error">{c.error ?? 'Not found'}</Alert>;
  const co: any = c.data;
  const reload = () => { c.reload(); contacts.reload(); signals.reload(); reports.reload(); leads.reload(); };
  const leadFor = (contactId: string) => (leads.data as any[])?.find(l => l.primary_contact_id === contactId);

  const research = async () => {
    setResearching(true);
    try { await callFn('research-company', { company_id: id }); toast.success('Intelligence report generated'); setReportIdx(0); reload(); }
    catch (e) { toast.error((e as Error).message); } finally { setResearching(false); }
  };
  const detect = async () => {
    setSignalBusy(true);
    try { const r = await callFn('find-contacts', { company_id: id, signals_only: true }); toast.success(`${r.signals} sourced signal(s) found`); reload(); }
    catch (e) { toast.error((e as Error).message); } finally { setSignalBusy(false); }
  };
  const report = (reports.data as any[])?.[reportIdx];

  return (
    <>
      <PageHeader title={co.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">{co.industry_segment && <Badge tone="navy">{co.industry_segment}</Badge>}{co.industry}{co.country_code && <> · {co.country_code}</>}{co.hq_city && <> · {co.hq_city}</>}{co.is_demo && <Badge tone="amber">DEMO</Badge>}</span>}
        actions={<>
          <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>
          <Button icon={<Radar className="h-4 w-4" />} loading={signalBusy} onClick={detect}>Detect buying signals</Button>
          <Button icon={<UserSearch className="h-4 w-4" />} onClick={() => setFinding(true)}>Find decision-makers</Button>
          <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} loading={researching} onClick={research}>Generate AI Company Intelligence Report</Button>
        </>} />
      {researching && <div className="mb-4"><Alert tone="info">Researching with live sources (company website, search results, AI web search). This usually takes 30–90 seconds.</Alert></div>}

      <div className="grid xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <Card title={`Decision-makers (${(contacts.data as any[])?.length ?? 0})`} pad={false} action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddContact(true)}>Add manually</Button>}>
            {contacts.loading ? <Spinner /> : !(contacts.data as any[])?.length ? (
              <EmptyState icon={<UserSearch className="h-5 w-5" />} title="No decision-makers identified yet" action={<Button variant="primary" onClick={() => setFinding(true)}>Find decision-makers</Button>}>Search connected providers for L&D, HR, Sales and Trade Marketing leaders, or add a contact you researched manually.</EmptyState>
            ) : (
              <Table><thead><tr><Th>Name & designation</Th><Th>Function</Th><Th>Email</Th><Th>LinkedIn</Th><Th>Confidence</Th><Th>Lead</Th><Th></Th></tr></thead>
                <tbody>{(contacts.data as any[]).map(p => { const l = leadFor(p.id); return (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <Td><div className="font-medium">{p.full_name}{p.do_not_contact && <Badge tone="red" className="ml-1.5">Do not contact</Badge>}</div><div className="text-xs text-ink-soft">{p.title}</div>
                      <div className="text-[11px] text-ink-faint mt-0.5">via {providerLabel(p.data_provider)} · verified {fmtDate(p.last_verified_at)}{p.contact_sources?.[0]?.url && <> · <a className="text-navy-600" href={p.contact_sources[0].url} target="_blank" rel="noreferrer">source</a></>}</div></Td>
                    <Td className="text-xs"><div>{DEPT_LABEL[p.department]}</div><div className="text-ink-faint">{SENIORITY_LABEL[p.seniority]}</div></Td>
                    <Td className="text-xs">{p.email ? <div className="flex flex-col gap-1"><span className="inline-flex items-center gap-1"><Mail className="h-3 w-3 text-ink-faint" />{p.email}</span><EmailStatusBadge status={p.email_status} /></div> : <EmailStatusBadge status="unavailable" />}{p.phone && <div className="mt-1 text-ink-soft">{p.phone}</div>}</Td>
                    <Td>{p.linkedin_url ? <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="text-navy-600"><Linkedin className="h-4 w-4" /></a> : <span className="text-ink-faint text-xs">—</span>}</Td>
                    <Td><ConfidenceBadge level={p.confidence} /></Td>
                    <Td>{l ? <Link to={`/leads/${l.id}`} className="flex flex-col gap-1"><ScoreBadge score={l.score} priority={l.priority} /><StageBadge stage={l.stage} /></Link> : '—'}</Td>
                    <Td className="whitespace-nowrap">
                      <Link to={`/outreach?contact=${p.id}${l ? `&lead=${l.id}` : ''}`}><Button size="sm" variant="subtle" icon={<Send className="h-3.5 w-3.5" />} disabled={p.do_not_contact}>Outreach</Button></Link>
                      <Button size="sm" variant="ghost" onClick={() => setEditContact(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {can('super_admin', 'admin') && <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { if (!confirm(`Permanently erase ${p.full_name} and add their email to the suppression list?`)) return; const { error } = await supabase.rpc('erase_contact', { p_contact_id: p.id }); error ? toast.error(error.message) : (toast.success('Contact erased'), reload()); }}>Erase</Button>}
                    </Td>
                  </tr>); })}</tbody></Table>
            )}
          </Card>

          <Card title="AI Company Intelligence Report" action={(reports.data as any[])?.length > 1 && <Select className="w-40 h-8" value={String(reportIdx)} onChange={e => setReportIdx(+e.target.value)}>{(reports.data as any[]).map((r, i) => <option key={r.id} value={String(i)}>{fmtDateTime(r.created_at)}</option>)}</Select>}>
            {report ? <ReportView report={report} contacts={contacts.data as any[]} /> : <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No report yet" action={<Button variant="primary" loading={researching} onClick={research}>Generate report</Button>}>The report uses only retrieved information and lists every source with a confidence level.</EmptyState>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Company profile">
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <dt className="text-ink-soft">Website</dt><dd><ExternalLink href={co.website} /></dd>
              <dt className="text-ink-soft">LinkedIn</dt><dd><ExternalLink href={co.linkedin_url}>{co.linkedin_url ? 'Company page' : undefined}</ExternalLink></dd>
              <dt className="text-ink-soft">Headquarters</dt><dd>{[co.hq_city, co.country_code].filter(Boolean).join(', ') || '—'}</dd>
              <dt className="text-ink-soft">Employees</dt><dd>{fmtNum(co.employee_count)}{co.employee_range ? ` (${co.employee_range})` : ''}</dd>
              <dt className="text-ink-soft">Revenue</dt><dd>{co.revenue_text ?? (co.revenue_usd ? `US$${fmtNum(co.revenue_usd)}` : '—')}</dd>
              <dt className="text-ink-soft">Classification</dt><dd className="capitalize">{co.classification}</dd>
              <dt className="text-ink-soft">Ownership</dt><dd className="capitalize">{co.ownership}</dd>
              <dt className="text-ink-soft">Parent</dt><dd>{co.parent ? <Link className="text-navy-600" to={`/companies/${co.parent.id}`}>{co.parent.name}</Link> : co.parent_company_name ?? '—'}</dd>
              {(subs.data as any[])?.length ? <><dt className="text-ink-soft">Subsidiaries</dt><dd>{(subs.data as any[]).map(s => <Link key={s.id} className="block text-navy-600" to={`/companies/${s.id}`}>{s.name} ({s.country_code})</Link>)}</dd></> : null}
              <dt className="text-ink-soft">Data provider</dt><dd>{providerLabel(co.data_provider)}</dd>
              <dt className="text-ink-soft">Last verified</dt><dd>{fmtDate(co.last_verified_at)}</dd>
            </dl>
            {co.description && <p className="text-sm text-ink-soft mt-4 leading-relaxed">{co.description}</p>}
            {co.company_brands?.length > 0 && <div className="mt-4"><div className="text-xs font-medium text-ink-soft mb-1.5">Key brands</div><div className="flex flex-wrap gap-1">{co.company_brands.map((b: any) => <Badge key={b.id} tone="navy">{b.brand_name}</Badge>)}</div></div>}
          </Card>

          <Card title={`Buying signals (${(signals.data as any[])?.length ?? 0})`} pad={false}>
            {!(signals.data as any[])?.length ? <p className="p-5 text-sm text-ink-soft">No sourced signals yet. Signals are research-backed hypotheses, not evidence of need.</p> : (
              <ul className="divide-y divide-slate-100">{(signals.data as any[]).map(s => (
                <li key={s.id} className="p-4 text-sm">
                  <div className="flex items-center gap-2 mb-1"><Badge tone="violet">{SIGNAL_LABEL[s.signal_type] ?? s.signal_type}</Badge><span className="text-xs text-ink-faint">{fmtDate(s.published_at)}</span><ConfidenceBadge level={s.confidence} /></div>
                  <p>{s.description}</p>
                  {s.training_opportunity && <p className="text-xs text-ink-soft mt-1"><b>Opportunity hypothesis:</b> {s.training_opportunity}</p>}
                  {s.suggested_approach && <p className="text-xs text-ink-soft mt-0.5"><b>Suggested approach:</b> {s.suggested_approach}</p>}
                  <a href={s.source_url} target="_blank" rel="noreferrer" className="text-[11px] text-navy-600 mt-1 inline-block truncate max-w-full">{s.source_title ?? s.source_url}</a>
                </li>))}</ul>
            )}
          </Card>

          <Card title="Sources">
            <ul className="space-y-1.5 text-xs">{(co.company_sources ?? []).map((s: any) => <li key={s.id}><Badge>{s.source_type}</Badge> <a href={s.url} target="_blank" rel="noreferrer" className="text-navy-600 break-all">{s.title ?? s.url}</a> <span className="text-ink-faint">· {fmtDate(s.retrieved_at)}</span></li>)}</ul>
          </Card>
          <Notes companyId={id!} />
        </div>
      </div>

      {editing && <CompanyForm open initial={co} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {addContact && <ContactForm companyId={id!} companyCountry={co.country_code} onClose={() => setAddContact(false)} onSaved={() => { setAddContact(false); reload(); }} />}
      {editContact && <ContactForm companyId={id!} initial={editContact} onClose={() => setEditContact(null)} onSaved={() => { setEditContact(null); reload(); }} />}
      {finding && <FindContactsModal companyId={id!} onClose={() => setFinding(false)} onDone={() => { setFinding(false); reload(); }} />}
    </>
  );
}

export function FindContactsModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [depts, setDepts] = useState<string[]>(['learning_development', 'human_resources', 'sales', 'distribution_channel', 'trade_marketing']);
  const [sens, setSens] = useState<string[]>(['cxo', 'vp', 'director', 'head']);
  const [limit, setLimit] = useState('5'); const [enrich, setEnrich] = useState(false); const [signals, setSignals] = useState(false);
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await callFn('find-contacts', { company_id: companyId, departments: depts, seniorities: sens, limit: +limit, enrich_emails: enrich, detect_signals: signals }); setResult(r); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={result ? onDone : onClose} title="Find decision-makers"
      footer={result ? <Button variant="primary" onClick={onDone}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={run}>Search providers</Button></>}>
      {err && <div className="mb-3"><Alert tone="warn">{err}</Alert></div>}
      {result ? (
        <div className="space-y-3 text-sm">
          <Alert tone={result.saved ? 'success' : 'warn'}>{result.saved} decision-maker(s) saved from {result.providers.map(providerLabel).join(', ') || 'no provider'}{result.signals ? ` · ${result.signals} signal(s)` : ''}.</Alert>
          {result.logs?.map((l: any, i: number) => <div key={i} className="text-xs text-ink-soft">• {l.message}</div>)}
          {!result.saved && <p className="text-ink-soft">Nobody matching the target functions was found in the connected sources. Try wider seniority, or research manually and add the contact with its source.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Target functions"><MultiSelect options={toOptions(TARGET_DEPARTMENTS, DEPT_LABEL)} value={depts} placeholder="Select functions" onChange={setDepts} /></Field>
          <Field label="Seniority"><MultiSelect options={toOptions(['cxo', 'vp', 'director', 'head', 'senior', 'manager'], SENIORITY_LABEL)} value={sens} placeholder="Select seniority" onChange={setSens} /></Field>
          <Field label="Max contacts"><Input type="number" min={1} max={15} value={limit} onChange={e => setLimit(e.target.value)} className="w-24" /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={enrich} onChange={e => setEnrich(e.target.checked)} className="mt-1 accent-navy-700" /><span>Enrich & verify emails <span className="block text-xs text-ink-faint">Uses Apollo enrichment / Hunter verification credits.</span></span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={signals} onChange={e => setSignals(e.target.checked)} className="mt-1 accent-navy-700" /><span>Also detect buying signals</span></label>
        </div>
      )}
    </Modal>
  );
}
