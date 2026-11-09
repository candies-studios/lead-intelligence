import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useAsync, q, fmtMoney } from '@/lib/hooks';
import { DEPT_LABEL, SENIORITY_LABEL, STAGES, STAGE_LABEL, providerLabel } from '@/lib/constants';
import { Alert, Card, PageHeader, Spinner, Stat } from '@/components/ui';
import { Donut, HBar, PipelineFunnel } from '@/components/Charts';
import { ExportButton } from '@/components/ExportModal';

export default function Analytics() {
  const { demo } = useAuth();
  const stats = useAsync(() => q(supabase.rpc('dashboard_stats', { p_demo: demo })), [demo]);
  if (stats.loading) return <Spinner />;
  if (stats.error) return <Alert tone="error">{stats.error}</Alert>;
  const s: any = stats.data;
  const byStage = Object.fromEntries((s.by_stage ?? []).map((x: any) => [x.k, x.v]));
  const funnel = ['contact_identified', 'outreach_pending', 'first_email_sent', 'meeting_scheduled', 'proposal_shared', 'negotiation', 'won']
    .map((k, i, arr) => ({ name: STAGE_LABEL[k as keyof typeof STAGE_LABEL], value: arr.slice(i).reduce((a, kk) => a + (byStage[kk] ?? 0), 0) }));
  const sourceLabels = Object.fromEntries((s.by_source ?? []).map((x: any) => [x.k, providerLabel(x.k)]));
  const conv = s.closed ? `${Math.round((s.won / s.closed) * 100)}%` : '—';
  return (
    <>
      <PageHeader title="Analytics" subtitle="Pipeline quality and conversion across markets, industries and functions." actions={<ExportButton />} />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-5">
        <Stat label="Companies discovered" value={s.companies} />
        <Stat label="Decision-makers" value={s.contacts} sub={`${s.verified_emails} verified emails`} />
        <Stat label="Outreach generated" value={s.outreach_generated} sub={`${s.emails_sent} emails logged as sent`} />
        <Stat label="Meetings / proposals" value={`${s.meetings} / ${s.proposals}`} />
        <Stat label="Conversion (won ÷ closed)" value={conv} sub={`${s.won} won`} />
        <Stat label="Open pipeline" value={fmtMoney(s.pipeline_value)} sub={`Won: ${fmtMoney(s.won_value)}`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Pipeline funnel (cumulative)"><PipelineFunnel data={funnel} /></Card>
        <Card title="Leads by stage"><HBar data={STAGES.map(st => ({ k: STAGE_LABEL[st], v: byStage[st] ?? 0 })).filter(x => x.v)} /></Card>
        <Card title="Leads by country"><HBar data={s.by_country} /></Card>
        <Card title="Leads by industry"><HBar data={s.by_industry} /></Card>
        <Card title="Leads by designation function"><Donut data={s.by_department} labels={DEPT_LABEL} /></Card>
        <Card title="Leads by seniority"><Donut data={s.by_seniority} labels={SENIORITY_LABEL} /></Card>
        <Card title="Companies by data source"><Donut data={s.by_source} labels={sourceLabels} /></Card>
        <Card title="Leads by priority"><Donut data={s.by_priority} labels={{ A: 'Priority A', B: 'Priority B', C: 'Priority C', R: 'Research required' }} /></Card>
      </div>
    </>
  );
}
