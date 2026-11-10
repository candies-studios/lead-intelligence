import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, Building2, ExternalLink as Ext, CheckSquare } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, useRefData, q, fmtNum, fmtDate } from '@/lib/hooks';
import { providerLabel } from '@/lib/constants';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th, Tabs, toast, ExternalLink, MultiSelect } from '@/components/ui';
import { countryOptions, industryOptions, segmentOptions, toOptions, SIZE_BANDS, sizeOrFilter, PROVIDER_OPTIONS } from '@/lib/options';
import CompanyForm from '@/components/CompanyForm';

export default function Discover() {
  const [tab, setTab] = useState<'search' | 'database'>('search');
  return (
    <>
      <PageHeader title="Discover Companies" subtitle="Search connected providers for companies across 20+ sectors that run sales, distribution, dealer/channel-partner or trade-marketing teams, then save the relevant ones with source attribution." />
      <Tabs tabs={[{ id: 'search', label: 'Provider search' }, { id: 'database', label: 'Company database' }]} value={tab} onChange={setTab} />
      {tab === 'search' ? <ProviderSearch onSaved={() => setTab('database')} /> : <CompanyDatabase />}
    </>
  );
}

function ProviderSearch({ onSaved }: { onSaved: () => void }) {
  const ref = useRefData();
  const [segments, setSegments] = useState<string[]>(['FMCG']);
  const [industries, setIndustries] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>(['IN']);
  const [city, setCity] = useState(''); const [minEmp, setMinEmp] = useState('500'); const [maxEmp, setMaxEmp] = useState('');
  const [keyword, setKeyword] = useState(''); const [ownership, setOwnership] = useState<string[]>([]); const [providers, setProviders] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<any | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set()); const [saving, setSaving] = useState(false);

  const run = async (p = 1) => {
    setBusy(true); setErr(null); setSel(new Set());
    try {
      const r = await callFn('discover-companies', { action: 'search', filters: { segments, industries, countries, cities: city ? city.split(',').map(s => s.trim()).filter(Boolean) : [], min_employees: minEmp ? +minEmp : null, max_employees: maxEmp ? +maxEmp : null, keyword: keyword || null, providers, page: p } });
      if (ownership.length) r.items = r.items.filter((i: any) => ownership.includes(i.ownership));
      setRes(r); setPage(p);
    } catch (e) { setErr((e as Error).message); setRes(null); } finally { setBusy(false); }
  };
  const save = async () => {
    setSaving(true);
    try {
      const items = res.items.filter((_: any, i: number) => sel.has(i));
      const r = await callFn('discover-companies', { action: 'save', items });
      toast.success(`${r.saved.filter((s: any) => s.created).length} new, ${r.saved.filter((s: any) => !s.created).length} updated (duplicates merged)`);
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="grid xl:grid-cols-[360px_1fr] gap-5">
      <Card title="Search criteria">
        <div className="space-y-4">
          <Field label="Sector groups" hint={`${ref.data?.segments.length ?? 0} sector groups · ${ref.data?.industries.filter(i => i.is_active).length ?? 0} industries`}><MultiSelect options={segmentOptions(ref.data)} value={segments} placeholder="Select sector groups" onChange={v => { setSegments(v); setIndustries(industries.filter(n => ref.data?.industries.some(i => i.name === n && v.includes(i.segment)))); }} /></Field>
          <Field label="Industries (optional)" hint="Leave empty to include every industry in the selected sector groups"><MultiSelect options={industryOptions(ref.data, segments)} value={industries} placeholder="All industries in selected groups" onChange={setIndustries} /></Field>
          <Field label="Countries"><MultiSelect options={countryOptions(ref.data)} value={countries} placeholder="Select countries" onChange={setCountries} /></Field>
          <Field label="Cities (comma-separated, optional)"><Input value={city} onChange={e => setCity(e.target.value)} placeholder="Mumbai, Gurugram" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min employees"><Input type="number" value={minEmp} onChange={e => setMinEmp(e.target.value)} /></Field>
            <Field label="Max employees"><Input type="number" value={maxEmp} onChange={e => setMaxEmp(e.target.value)} /></Field>
          </div>
          <Field label="Company name / keyword"><Input value={keyword} onChange={e => setKeyword(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ownership"><MultiSelect options={toOptions(['public', 'private', 'subsidiary'], { public: 'Public', private: 'Private', subsidiary: 'Subsidiary' })} value={ownership} placeholder="Any" onChange={setOwnership} /></Field>
            <Field label="Providers"><MultiSelect options={PROVIDER_OPTIONS} value={providers} placeholder="Auto (best available)" onChange={setProviders} footerNote="Tried in the order shown" /></Field>
          </div>
          <Button variant="primary" className="w-full" icon={<Search className="h-4 w-4" />} loading={busy} onClick={() => run(1)} disabled={!countries.length || !segments.length}>Search companies</Button>
        </div>
      </Card>
      <div>
        {err && <div className="mb-4"><Alert tone={err.includes('connected') ? 'warn' : 'error'} title="Search unavailable">{err} {err.includes('connected') && <Link to="/integrations" className="underline">Open Integrations</Link>}</Alert></div>}
        {busy ? <Card><Spinner label="Querying provider — this is a live request…" /></Card> : !res ? (
          <Card><EmptyState icon={<Building2 className="h-5 w-5" />} title="Run a search to see real provider results">Results come only from connected providers. Nothing is generated to fill the list.</EmptyState></Card>
        ) : (
          <Card pad={false} title={<span>{res.items.length} results from {providerLabel(res.provider)} · page {page}</span>}
            action={<div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSel(sel.size === res.items.length ? new Set() : new Set(res.items.map((_: any, i: number) => i)))} icon={<CheckSquare className="h-3.5 w-3.5" />}>Select all</Button>
              <Button size="sm" variant="primary" disabled={!sel.size} loading={saving} onClick={save}>Save {sel.size || ''} to database</Button>
            </div>}>
            {!res.items.length ? <EmptyState title="No companies matched">Try widening employee range, more countries, or another provider.</EmptyState> : (
              <Table><thead><tr><Th></Th><Th>Company</Th><Th>Industry</Th><Th>Location</Th><Th>Employees</Th><Th>Sources</Th></tr></thead>
                <tbody>{res.items.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <Td><input type="checkbox" className="accent-navy-700" checked={sel.has(i)} onChange={() => { const s = new Set(sel); s.has(i) ? s.delete(i) : s.add(i); setSel(s); }} /></Td>
                    <Td><div className="font-medium">{c.name}</div><div className="text-xs"><ExternalLink href={c.website} /></div>
                      {c.existing_id && <Link to={`/companies/${c.existing_id}`}><Badge tone="navy" className="mt-1">Already in database</Badge></Link>}
                      {c.description && <div className="text-xs text-ink-soft mt-1 max-w-md line-clamp-2">{c.description}</div>}</Td>
                    <Td className="text-xs">{c.industry ?? '—'}{c.parent_company_name && <div className="text-ink-faint">Parent: {c.parent_company_name}</div>}</Td>
                    <Td className="text-xs">{[c.hq_city, c.country_name ?? c.country_code].filter(Boolean).join(', ') || '—'}</Td>
                    <Td className="tabular-nums text-xs">{fmtNum(c.employee_count) !== '—' ? fmtNum(c.employee_count) : c.employee_range ?? '—'}</Td>
                    <Td className="text-xs">{c.source_urls.slice(0, 2).map((s: any) => <div key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="text-navy-600 inline-flex items-center gap-1"><Ext className="h-3 w-3" />{s.title ?? s.type}</a></div>)}</Td>
                  </tr>))}</tbody></Table>
            )}
            {!res.exhausted && <div className="p-3 border-t border-slate-100 text-right"><Button size="sm" onClick={() => run(page + 1)}>Next page</Button></div>}
          </Card>
        )}
      </div>
    </div>
  );
}

function CompanyDatabase() {
  const { demo } = useAuth();
  const ref = useRefData();
  const nav = useNavigate();
  const [text, setText] = useState(''); const [country, setCountry] = useState<string[]>([]); const [segment, setSegment] = useState<string[]>([]);
  const [industry, setIndustry] = useState<string[]>([]); const [size, setSize] = useState<string[]>([]); const [cls, setCls] = useState<string[]>([]); const [own, setOwn] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const list = useAsync(() => {
    let x = supabase.from('companies').select('id, name, website, industry, industry_segment, country_code, hq_city, employee_count, classification, ownership, parent_company_name, data_provider, last_verified_at, contacts(count), company_brands(brand_name)').eq('is_demo', demo).order('name').limit(500);
    if (country.length) x = x.in('country_code', country);
    if (segment.length) x = x.in('industry_segment', segment);
    if (industry.length) x = x.in('industry', industry);
    if (cls.length) x = x.in('classification', cls);
    if (own.length) x = x.in('ownership', own);
    if (size.length) x = x.or(sizeOrFilter(size));
    if (text) x = x.ilike('name', `%${text}%`);
    return q(x);
  }, [demo, country.join(), segment.join(), industry.join(), size.join(), cls.join(), own.join(), text]);
  const rows = useMemo(() => (list.data as any[]) ?? [], [list.data]);

  return (
    <Card pad={false}>
      <div className="flex flex-wrap gap-2 p-4 border-b border-slate-100">
        <Input placeholder="Search company name…" value={text} onChange={e => setText(e.target.value)} className="max-w-xs" />
        <div className="w-44"><MultiSelect options={countryOptions(ref.data, false)} value={country} onChange={setCountry} placeholder="All countries" /></div>
        <div className="w-52"><MultiSelect options={segmentOptions(ref.data)} value={segment} onChange={setSegment} placeholder="All sector groups" /></div>
        <div className="w-52"><MultiSelect options={industryOptions(ref.data, segment)} value={industry} onChange={setIndustry} placeholder="All industries" /></div>
        <div className="w-36"><MultiSelect options={SIZE_BANDS} value={size} onChange={setSize} placeholder="Any size" /></div>
        <div className="w-40"><MultiSelect options={toOptions(['manufacturer', 'distributor', 'retailer', 'ecommerce', 'mixed', 'unknown'], { manufacturer: 'Manufacturer', distributor: 'Distributor', retailer: 'Retailer', ecommerce: 'E-commerce', mixed: 'Mixed', unknown: 'Unknown' })} value={cls} onChange={setCls} placeholder="Any type" /></div>
        <div className="w-40"><MultiSelect options={toOptions(['public', 'private', 'subsidiary', 'unknown'], { public: 'Public', private: 'Private', subsidiary: 'Subsidiary', unknown: 'Unknown' })} value={own} onChange={setOwn} placeholder="Any ownership" /></div>
        <div className="flex-1" />
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add manually</Button>
      </div>
      {list.loading ? <Spinner /> : list.error ? <div className="p-4"><Alert tone="error">{list.error}</Alert></div> : !rows.length ? (
        <EmptyState icon={<Building2 className="h-5 w-5" />} title="No companies yet">Use Provider search or a Campaign to discover companies, or add one manually with its source.</EmptyState>
      ) : (
        <Table><thead><tr><Th>Company</Th><Th>Segment / industry</Th><Th>Country</Th><Th>Employees</Th><Th>Type</Th><Th>Contacts</Th><Th>Source</Th><Th>Verified</Th></tr></thead>
          <tbody>{rows.map(c => (
            <tr key={c.id} className="hover:bg-slate-50/60 cursor-pointer" onClick={() => nav(`/companies/${c.id}`)}>
              <Td><div className="font-medium">{c.name}</div><div className="text-xs text-ink-faint truncate max-w-[260px]">{(c.company_brands ?? []).slice(0, 4).map((b: any) => b.brand_name).join(' · ') || c.website}</div>{c.parent_company_name && <div className="text-[11px] text-ink-faint">Subsidiary of {c.parent_company_name}</div>}</Td>
              <Td className="text-xs">{c.industry_segment && <Badge tone="navy">{c.industry_segment}</Badge>} <span className="text-ink-soft">{c.industry}</span></Td>
              <Td className="text-xs">{c.country_code ?? '—'}{c.hq_city ? ` · ${c.hq_city}` : ''}</Td>
              <Td className="tabular-nums text-xs">{fmtNum(c.employee_count)}</Td>
              <Td className="text-xs capitalize">{c.classification}{c.ownership !== 'unknown' ? ` · ${c.ownership}` : ''}</Td>
              <Td className="tabular-nums text-xs">{c.contacts?.[0]?.count ?? 0}</Td>
              <Td className="text-xs">{providerLabel(c.data_provider)}</Td>
              <Td className="text-xs text-ink-soft">{fmtDate(c.last_verified_at)}</Td>
            </tr>))}</tbody></Table>
      )}
      {adding && <CompanyForm open onClose={() => setAdding(false)} onSaved={id => nav(`/companies/${id}`)} />}
    </Card>
  );
}
