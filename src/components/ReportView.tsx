import { fmtDateTime } from '@/lib/hooks';
import { Badge, ConfidenceBadge } from './ui';

const Src = ({ urls }: { urls?: string[] }) => !urls?.length ? <div className="text-[11px] text-ink-faint mt-1">No supporting source retrieved</div> : (
  <div className="flex flex-wrap gap-1 mt-1.5">{urls.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="text-[11px] text-navy-600 bg-navy-50 rounded px-1.5 py-0.5 hover:bg-navy-100 max-w-[260px] truncate">{u.replace(/^https?:\/\/(www\.)?/, '')}</a>)}</div>
);
const H = ({ n, t }: { n: number; t: string }) => <h4 className="text-xs font-semibold uppercase tracking-wide text-navy-700 mb-1.5"><span className="text-ink-faint mr-1">{n}.</span>{t}</h4>;

export default function ReportView({ report, contacts }: { report: any; contacts?: any[] }) {
  const r = report.report ?? {};
  const rec = contacts?.find(c => c.id === r.recommended_first_contact?.contact_id);
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">Generated {fmtDateTime(report.created_at)} · {report.model}<ConfidenceBadge level={r.confidence?.overall} />{r.confidence?.notes && <span className="text-ink-faint">— {r.confidence.notes}</span>}</div>
      <section><H n={1} t="Company overview" /><p>{r.overview?.text}</p><Src urls={r.overview?.sources} /></section>
      <section><H n={2} t="Industry & market position" /><p>{r.market_position?.text}</p><Src urls={r.market_position?.sources} /></section>
      <section><H n={3} t="Main brands & product categories" />
        <div className="flex flex-wrap gap-1.5">{(r.brands_and_categories?.items ?? []).map((b: any, i: number) => <Badge key={i} tone="navy">{b.brand}{b.category ? ` · ${b.category}` : ''}</Badge>)}</div><Src urls={r.brands_and_categories?.sources} /></section>
      <section><H n={4} t="Size & geographic footprint" /><p>{r.size_and_footprint?.text}</p><Src urls={r.size_and_footprint?.sources} /></section>
      <section><H n={5} t="Business challenges (evidence-based hypotheses)" />
        {(r.business_challenges?.items ?? []).length ? <ul className="space-y-2">{r.business_challenges.items.map((c: any, i: number) => <li key={i} className="border-l-2 border-amber-300 pl-3"><div className="font-medium">{c.hypothesis}</div><div className="text-ink-soft text-xs">{c.evidence}</div><Src urls={[c.source]} /></li>)}</ul> : <p className="text-ink-faint">No challenges supported by retrieved evidence.</p>}</section>
      <section><H n={6} t="Identified decision-makers" /><p>{r.decision_makers?.text}</p></section>
      <section><H n={7} t="Relevant commercial & leadership initiatives" />
        {(r.initiatives?.items ?? []).length ? <ul className="space-y-1.5">{r.initiatives.items.map((x: any, i: number) => <li key={i}>• {x.initiative}{x.date ? <span className="text-ink-faint"> ({x.date})</span> : null}<Src urls={[x.source]} /></li>)}</ul> : <p className="text-ink-faint">None found in retrieved sources.</p>}</section>
      <section><H n={8} t="Potential World of Trade use cases" />
        <div className="grid md:grid-cols-2 gap-2">{(r.training_use_cases?.items ?? []).map((u: any, i: number) => <div key={i} className="rounded-lg bg-slate-50 border border-slate-100 p-3"><div className="font-medium">{u.use_case}</div><div className="text-xs text-ink-soft mt-1">{u.why}</div>{u.audience && <div className="text-[11px] text-navy-700 mt-1">Audience: {u.audience}</div>}</div>)}</div></section>
      <section><H n={9} t="Recommended first contact" /><p>{rec ? <b>{rec.full_name} — {rec.title}. </b> : <span className="text-ink-faint">No identified contact recommended. </span>}{r.recommended_first_contact?.reason}</p></section>
      <section><H n={10} t="Suggested opening conversation" /><blockquote className="rounded-lg bg-navy-50/60 border border-navy-100 p-3 italic text-navy-900">{r.opening_conversation}</blockquote></section>
      <section><H n={11} t="Sources" /><ol className="list-decimal pl-5 space-y-0.5 text-xs">{(report.sources ?? []).map((s: any, i: number) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-navy-600 hover:underline">{s.title || s.url}</a> <span className="text-ink-faint">({s.provider})</span></li>)}</ol></section>
    </div>
  );
}
