import clsx from 'clsx';
import { Loader2, X, Check, AlertTriangle, Info } from 'lucide-react';
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { EMAIL_STATUS_LABEL, STAGE_LABEL, type Stage } from '@/lib/constants';
import { Dropdown, optionsFromChildren } from './Dropdown';

export const cx = clsx;

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button {...p} disabled={p.disabled || loading} className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400',
      size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
      variant === 'primary' && 'bg-navy-800 text-white hover:bg-navy-700 shadow-sm',
      variant === 'secondary' && 'bg-white text-ink border border-slate-200 hover:bg-slate-50 hover:border-slate-300',
      variant === 'ghost' && 'text-ink-soft hover:bg-slate-100 hover:text-ink',
      variant === 'subtle' && 'bg-navy-50 text-navy-700 hover:bg-navy-100',
      variant === 'danger' && 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
      className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}{children}
    </button>
  );
}

export function Card({ className, children, title, action, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx('bg-white rounded-xl border border-slate-200/80 shadow-card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>{action}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-soft mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-xs font-medium text-ink-soft mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-faint mt-1">{hint}</span>}
    </label>
  );
}
const inputCls = 'w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm placeholder:text-ink-faint focus:border-navy-400 focus:ring-2 focus:ring-navy-100 outline-none transition';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
/** Single-choice dropdown in the app-wide design. Accepts <option>/<optgroup> children like a native select. */
export function Select({ children, value, onChange, className, disabled, placeholder, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) {
  const options = optionsFromChildren(children);
  return (
    <div className={cx('relative', className?.match(/\bw-\S+/g)?.join(' ') ?? 'w-full')}>
      <Dropdown options={options} value={String(value ?? '')} disabled={disabled} placeholder={placeholder}
        aria-label={(rest as any)['aria-label']}
        className={cx(className?.match(/\bh-\S+/g)?.join(' '))}
        onChange={v => onChange?.({ target: { value: v }, currentTarget: { value: v } } as any)} />
    </div>
  );
}
export { MultiSelect } from './Dropdown';
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, 'h-auto py-2 leading-relaxed', p.className)} />;

export function ChipSelect<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T[]; onChange: (v: T[]) => void; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value.includes(o);
        return (
          <button type="button" key={o} onClick={() => onChange(on ? value.filter(v => v !== o) : [...value, o])}
            className={cx('px-2.5 h-7 rounded-full text-xs border transition', on ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-ink-soft border-slate-200 hover:border-navy-300')}>
            {on && <Check className="inline h-3 w-3 mr-1 -mt-0.5" />}{labels?.[o] ?? o}
          </button>
        );
      })}
    </div>
  );
}

const tones = {
  slate: 'bg-slate-100 text-slate-700', navy: 'bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100', green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100', red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-100', blue: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100',
  violet: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-100',
};
export type Tone = keyof typeof tones;
export const Badge = ({ tone = 'slate', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) =>
  <span title={title} className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;

export function ScoreBadge({ score, priority }: { score?: number | null; priority?: string | null }) {
  if (score == null) return <Badge>Unscored</Badge>;
  const tone: Tone = priority === 'A' ? 'green' : priority === 'B' ? 'blue' : priority === 'C' ? 'amber' : 'slate';
  return <span className="inline-flex items-center gap-1.5"><span className="tabular-nums font-semibold text-sm text-ink">{score}</span><Badge tone={tone}>{priority === 'R' ? 'Research' : `P-${priority}`}</Badge></span>;
}
export const ConfidenceBadge = ({ level }: { level?: string | null }) =>
  <Badge tone={level === 'high' ? 'green' : level === 'medium' ? 'amber' : 'slate'} title="Data confidence">{level ? `${level[0].toUpperCase()}${level.slice(1)} confidence` : 'Unknown'}</Badge>;
export function EmailStatusBadge({ status }: { status?: string | null }) {
  const tone: Tone = status === 'verified' ? 'green' : status === 'provider_returned' ? 'blue' : status === 'inferred_pattern' ? 'amber' : status === 'invalid' ? 'red' : 'slate';
  const tip = status === 'inferred_pattern' ? 'Built from the company email pattern — NOT verified' : status === 'provider_returned' ? 'Returned by an enrichment provider, not independently verified' : undefined;
  return <Badge tone={tone} title={tip}>{EMAIL_STATUS_LABEL[status ?? 'unavailable']}</Badge>;
}
export function StageBadge({ stage }: { stage: Stage }) {
  const tone: Tone = stage === 'won' ? 'green' : stage === 'lost' || stage === 'not_relevant' ? 'red' : ['meeting_scheduled', 'proposal_shared', 'negotiation'].includes(stage) ? 'violet' : ['first_email_sent', 'linkedin_contacted', 'follow_up_required', 'outreach_pending'].includes(stage) ? 'blue' : 'slate';
  return <Badge tone={tone}>{STAGE_LABEL[stage]}</Badge>;
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" />{label ?? 'Loading…'}</div>;
}
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      {icon && <div className="h-11 w-11 rounded-xl bg-navy-50 text-navy-600 flex items-center justify-center mb-3">{icon}</div>}
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      {children && <div className="text-sm text-ink-soft mt-1 max-w-md">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function Alert({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: string; children: ReactNode }) {
  const cls = { info: 'bg-sky-50 border-sky-200 text-sky-900', warn: 'bg-amber-50 border-amber-200 text-amber-900', error: 'bg-red-50 border-red-200 text-red-900', success: 'bg-emerald-50 border-emerald-200 text-emerald-900' }[tone];
  const Icon = tone === 'success' ? Check : tone === 'info' ? Info : AlertTriangle;
  return <div className={cx('flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm', cls)}><Icon className="h-4 w-4 mt-0.5 shrink-0" /><div>{title && <div className="font-semibold mb-0.5">{title}</div>}{children}</div></div>;
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); if (open) window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/40 backdrop-blur-[2px] p-4 pt-[8vh]" onMouseDown={onClose}>
      <div className={cx('w-full bg-white rounded-2xl shadow-lift', wide ? 'max-w-3xl' : 'max-w-lg')} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-card p-4">
      <div className="flex items-center justify-between text-xs font-medium text-ink-soft">{label}{icon && <span className="text-navy-400">{icon}</span>}</div>
      <div className="mt-2 font-display text-2xl font-bold text-navy-950 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-faint mt-0.5">{sub}</div>}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>;
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) =>
  <th className={cx('text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint px-4 py-2.5 bg-slate-50/70 border-b border-slate-100 whitespace-nowrap', className)}>{children}</th>;
export const Td = ({ children, className, ...p }: { children?: ReactNode; className?: string; colSpan?: number }) =>
  <td {...p} className={cx('px-4 py-3 border-b border-slate-100 align-top', className)}>{children}</td>;

// Simple toast
type ToastMsg = { id: number; text: string; tone: 'success' | 'error' | 'info' };
let pushToast: (t: Omit<ToastMsg, 'id'>) => void = () => {};
export const toast = { success: (text: string) => pushToast({ text, tone: 'success' }), error: (text: string) => pushToast({ text, tone: 'error' }), info: (text: string) => pushToast({ text, tone: 'info' }) };
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => { pushToast = t => { const id = Date.now() + Math.random(); setItems(s => [...s, { ...t, id }]); setTimeout(() => setItems(s => s.filter(x => x.id !== id)), 5000); }; }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2 w-80">
      {items.map(t => (
        <div key={t.id} className={cx('rounded-lg px-4 py-3 text-sm shadow-lift border bg-white', t.tone === 'error' ? 'border-red-200 text-red-800' : t.tone === 'success' ? 'border-emerald-200 text-emerald-800' : 'border-slate-200 text-ink')}>{t.text}</div>
      ))}
    </div>
  );
}

export function ExternalLink({ href, children }: { href?: string | null; children?: ReactNode }) {
  if (!href) return <span className="text-ink-faint">—</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-navy-600 hover:text-navy-800 hover:underline break-all">{children ?? href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cx('px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition', value === t.id ? 'border-navy-700 text-navy-900' : 'border-transparent text-ink-soft hover:text-ink')}>{t.label}</button>
      ))}
    </div>
  );
}
