import { Link } from 'react-router-dom';
import { Building2, Users, MailCheck, Star, Send, CalendarCheck, FileText, TrendingUp, Target } from 'lucide-react';
import { supabase, callFn } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtMoney, fmtDate } from '@/lib/hooks';
import { DEPT_LABEL, providerLabel } from '@/lib/constants';
import { Card, PageHeader, Stat, Spinner, Alert, ScoreBadge, Badge, Button } from '@/components/ui';
import { HBar, Donut } from '@/components/Charts';

export default function Overview() {
  const { demo, profile } = useAuth();
  const stats = useAsync(() => q(supabase.rpc('dashboard_stats', { p_demo: demo })), [demo]);
  const top = useAsync(() => q(supabase.from('v_lead_overview').select('id, company_name, contact_name, contact_title, score, priority, country_code').eq('is_demo', demo).not('score', 'is', null).order('score', { ascending: false }).limit(8)), [demo]);
  const due = useAsync(() => q(supabase.from('follow_ups').select('id, title, due_at, lead:leads!inner(id, is_demo, company:companies(name))').eq('status', 'open').eq('lead.is_demo', demo).order('due_at').limit(6)), [demo]);
  const integ = useAsync(() => callFn<{ integrations: any[] }>('integrations', { action: 'status' }).then(r => r.integrations).catch(() => null), []);
  const s: any = stats.data ?? {};
  const conv = s.closed ? Math.round((s.won / s.closed) * 100) : null;
  const connected = (integ.data ?? []).filter(i => ['ai', 'search', 'enrichment', 'company_data'].includes(i.category));

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        subtitle="Your prospecting pipeline for Sales, Trade Marketing, Distribution & Channel Management audiences across industries."
        actions={<><Link to="/campaigns"><Button variant="primary" icon={<Target className="h-4 w-4" />}>New discovery campaign</Button></Link></>} />
      {integ.data && connected.every(c => !c.configured) && (
        <div className="mb-6"><Alert tone="warn" title="No data providers connected yet">
          Discovery, enrichment and AI research need at least one provider. <Link className="underline" to="/integrations">Connect Gemini (free tier), Claude, Apollo, Hunter, People Data Labs or Google Search</Link>. Until then you can add companies and contacts manually.
        </Alert></div>
      )}
      {stats.loading ? <Spinner /> : stats.error ? <Alert tone="error">{stats.error}</Alert> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
            <Stat label="Companies" value={s.companies} icon={<Building2 className="h-4 w-4" />} />
            <Stat label="Qualified companies" value={s.qualified_companies} icon={<Star className="h-4 w-4" />} />
            <Stat label="Decision-makers" value={s.contacts} icon={<Users className="h-4 w-4" />} />
            <Stat label="Verified emails" value={s.verified_emails} icon={<MailCheck className="h-4 w-4" />} />
            <Stat label="Priority A leads" value={s.priority_a} icon={<Target className="h-4 w-4" />} />
            <Stat label="Outreach drafts" value={s.outreach_generated} icon={<Send className="h-4 w-4" />} />
            <Stat label="Meetings" value={s.meetings} icon={<CalendarCheck className="h-4 w-4" />} />
            <Stat label="Pipeline value" value={fmtMoney(s.pipeline_value)} sub={conv != null ? `${conv}% win rate (closed)` : 'No closed deals yet'} icon={<TrendingUp className="h-4 w-4" />} />
          </div>
          <div className="grid lg:grid-cols-3 gap-4 mb-4">
            <Card title="Leads by country"><HBar data={s.by_country} height={200} /></Card>
            <Card title="Leads by industry"><HBar data={s.by_industry} height={200} /></Card>
            <Card title="Leads by decision-maker function"><Donut data={s.by_department} labels={DEPT_LABEL} /></Card>
          </div>
        </>
      )}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Highest-scoring prospects" className="lg:col-span-2" pad={false} action={<Link to="/leads" className="text-xs text-navy-600">View all</Link>}>
          {top.loading ? <Spinner /> : !top.data?.length ? <p className="p-5 text-sm text-ink-soft">No scored leads yet. Run a discovery campaign or add a company.</p> : (
            <ul className="divide-y divide-slate-100">{top.data.map((l: any) => (
              <li key={l.id}><Link to={`/leads/${l.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{l.company_name}</div><div className="text-xs text-ink-soft truncate">{l.contact_name ? `${l.contact_name} · ${l.contact_title ?? ''}` : 'Contact not yet identified'}</div></div>
                <Badge>{l.country_code ?? '—'}</Badge><ScoreBadge score={l.score} priority={l.priority} />
              </Link></li>))}</ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Upcoming follow-ups" pad={false} action={<Link to="/follow-ups" className="text-xs text-navy-600">All</Link>}>
            {!due.data?.length ? <p className="p-5 text-sm text-ink-soft">Nothing scheduled.</p> : (
              <ul className="divide-y divide-slate-100">{due.data.map((f: any) => (
                <li key={f.id} className="px-5 py-2.5"><Link to={`/leads/${f.lead.id}`} className="block">
                  <div className="text-sm">{f.title}</div><div className={`text-xs ${new Date(f.due_at) < new Date() ? 'text-red-600' : 'text-ink-soft'}`}>{f.lead.company?.name} · {fmtDate(f.due_at)}</div>
                </Link></li>))}</ul>
            )}
          </Card>
          <Card title="Data providers" action={<Link to="/integrations" className="text-xs text-navy-600">Manage</Link>}>
            <ul className="space-y-1.5 text-sm">{connected.map(i => (
              <li key={i.provider} className="flex items-center justify-between"><span>{providerLabel(i.provider)}</span>
                <Badge tone={i.status === 'connected' ? 'green' : i.status === 'error' ? 'red' : i.configured ? 'amber' : 'slate'}>{i.status === 'connected' ? 'Connected' : i.status === 'error' ? 'Error' : i.configured ? 'Key saved – untested' : 'Not connected'}</Badge></li>))}
              {integ.data === null && <li className="text-xs text-ink-faint flex items-center gap-1"><FileText className="h-3 w-3" />Edge Functions not reachable — deploy them (README).</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
