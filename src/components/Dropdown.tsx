import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X, Minus } from 'lucide-react';
import clsx from 'clsx';

export interface DropdownOption { value: string; label: string; group?: string; disabled?: boolean; hint?: string }

type Common = {
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  /** Small text shown at the bottom of the panel */
  footerNote?: string;
  'aria-label'?: string;
};
type MultiProps = Common & { multiple: true; value: string[]; onChange: (v: string[]) => void };
type SingleProps = Common & { multiple?: false; value: string; onChange: (v: string) => void };

/** One dropdown design for the whole app: tick boxes when `multiple`, a single tick otherwise. */
export function Dropdown(props: MultiProps | SingleProps) {
  const { options, placeholder = 'Select…', className, disabled, footerNote } = props;
  const multiple = props.multiple === true;
  const selected = useMemo(() => new Set(multiple ? (props.value as string[]) : [props.value as string]), [multiple, props.value]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchable = props.searchable ?? options.length > 8;

  const place = () => {
    const r = trigger.current?.getBoundingClientRect(); if (!r) return;
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < 260 && above > below;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left: Math.min(r.left, window.innerWidth - Math.max(r.width, 260) - 8), width: Math.max(r.width, 240), maxH: Math.max(180, Math.min(380, up ? above : below)), up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) { setQuery(''); return; }
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (!trigger.current?.contains(t) && !panel.current?.contains(t)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    const onMove = () => place();
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove); window.addEventListener('scroll', onMove, true);
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
  }, [open]);

  const q = query.trim().toLowerCase();
  // Labels match anywhere; group names only at the start of a word (so "pharma" finds the whole Pharma group, "care" does not).
  const groupHit = (g?: string) => !!g && g.toLowerCase().split(/[^a-z0-9]+/).some(w => w.startsWith(q));
  const visible = q ? options.filter(o => o.label.toLowerCase().includes(q) || groupHit(o.group)) : options;
  const groups = useMemo(() => {
    const m = new Map<string, DropdownOption[]>();
    for (const o of visible) { const g = o.group ?? ''; if (!m.has(g)) m.set(g, []); m.get(g)!.push(o); }
    return [...m.entries()];
  }, [visible]);

  const labelOf = (v: string) => options.find(o => o.value === v)?.label ?? v;
  let text: ReactNode;
  if (multiple) {
    const vals = props.value as string[];
    text = vals.length === 0 ? <span className="text-ink-faint">{placeholder}</span>
      : vals.length <= 2 ? vals.map(labelOf).join(', ')
      : <>{labelOf(vals[0])} <span className="inline-flex items-center rounded bg-navy-100 text-navy-800 text-[11px] font-semibold px-1.5 ml-1">+{vals.length - 1}</span></>;
  } else {
    const v = props.value as string; const o = options.find(x => x.value === v);
    text = o ? o.label : <span className="text-ink-faint">{placeholder}</span>;
  }

  const setMulti = (vals: string[]) => (props as MultiProps).onChange(vals);
  const toggle = (o: DropdownOption) => {
    if (o.disabled) return;
    if (multiple) {
      const vals = props.value as string[];
      setMulti(vals.includes(o.value) ? vals.filter(v => v !== o.value) : [...vals, o.value]);
    } else { (props as SingleProps).onChange(o.value); setOpen(false); }
  };
  const visibleEnabled = visible.filter(o => !o.disabled).map(o => o.value);
  const allVisibleOn = visibleEnabled.length > 0 && visibleEnabled.every(v => selected.has(v));
  const selectVisible = () => { const vals = props.value as string[]; setMulti(allVisibleOn ? vals.filter(v => !visibleEnabled.includes(v)) : [...new Set([...vals, ...visibleEnabled])]); };
  const toggleGroup = (items: DropdownOption[]) => {
    const vals = props.value as string[]; const ids = items.filter(i => !i.disabled).map(i => i.value);
    const all = ids.every(v => selected.has(v));
    setMulti(all ? vals.filter(v => !ids.includes(v)) : [...new Set([...vals, ...ids])]);
  };

  const count = multiple ? (props.value as string[]).length : 0;
  return (
    <>
      <button ref={trigger} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={props['aria-label']}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) { e.preventDefault(); setOpen(true); } }}
        className={clsx('group relative flex w-full h-9 items-center gap-1 rounded-lg border bg-white pl-3 pr-8 text-left text-sm transition outline-none disabled:opacity-50 disabled:cursor-not-allowed',
          open ? 'border-navy-400 ring-2 ring-navy-100' : 'border-slate-200 hover:border-slate-300', className)}>
        <span className="truncate flex-1 min-w-0">{text}</span>
        {multiple && count > 0 && !disabled && (
          <span role="button" tabIndex={-1} aria-label="Clear selection" title="Clear"
            onClick={e => { e.stopPropagation(); setMulti([]); }}
            className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:text-ink hover:bg-slate-100"><X className="h-3.5 w-3.5" /></span>
        )}
        <ChevronDown className={clsx('absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && pos && createPortal(
        <div ref={panel} role="listbox" aria-multiselectable={multiple}
          style={{ position: 'fixed', left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }), maxHeight: pos.maxH }}
          className="z-[70] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lift text-sm">
          {searchable && (
            <div className="relative border-b border-slate-100 p-2">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
              <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…"
                className="w-full h-8 rounded-md bg-slate-50 pl-7 pr-2 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-navy-100" />
            </div>
          )}
          {multiple && visibleEnabled.length > 1 && (
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-xs">
              <button type="button" onClick={selectVisible} className="font-medium text-navy-700 hover:text-navy-900">{allVisibleOn ? 'Unselect all' : q ? 'Select all results' : 'Select all'}</button>
              {count > 0 && <button type="button" onClick={() => setMulti([])} className="text-ink-soft hover:text-ink">Clear ({count})</button>}
            </div>
          )}
          <div className="overflow-y-auto py-1 scrollbar-thin">
            {!visible.length && <div className="px-3 py-4 text-center text-xs text-ink-faint">No matches</div>}
            {groups.map(([g, items]) => {
              const ids = items.filter(i => !i.disabled).map(i => i.value);
              const on = ids.filter(v => selected.has(v)).length;
              return (
                <div key={g || '_'}>
                  {g && (
                    <div className="sticky top-0 z-[1] flex items-center gap-2 bg-slate-50/95 backdrop-blur px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft border-y border-slate-100">
                      {multiple && <Box state={on === 0 ? 'off' : on === ids.length ? 'on' : 'some'} onClick={() => toggleGroup(items)} label={`Select all in ${g}`} />}
                      <span className="flex-1 truncate">{g}</span>{multiple && on > 0 && <span className="normal-case font-medium text-navy-700">{on}/{ids.length}</span>}
                    </div>
                  )}
                  {items.map(o => {
                    const isOn = selected.has(o.value);
                    return (
                      <div key={o.value} role="option" aria-selected={isOn} aria-disabled={o.disabled} tabIndex={0}
                        onClick={() => toggle(o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(o); } }}
                        className={clsx('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 outline-none focus:bg-navy-50', o.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50', !multiple && isOn && 'bg-navy-50/70')}>
                        {multiple ? <Box state={isOn ? 'on' : 'off'} /> : <Check className={clsx('h-4 w-4 shrink-0', isOn ? 'text-navy-700' : 'text-transparent')} />}
                        <span className={clsx('flex-1 min-w-0 truncate', isOn && 'font-medium text-navy-900')}>{o.label}</span>
                        {o.hint && <span className="text-[11px] text-ink-faint">{o.hint}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {(multiple || footerNote) && (
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs">
              <span className="text-ink-faint">{footerNote ?? (count ? `${count} selected` : 'Nothing selected = all')}</span>
              {multiple && <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-navy-800 px-2.5 py-1 font-medium text-white hover:bg-navy-700">Done</button>}
            </div>
          )}
        </div>, document.body)}
    </>
  );
}

function Box({ state, onClick, label }: { state: 'on' | 'off' | 'some'; onClick?: () => void; label?: string }) {
  return (
    <span role={onClick ? 'checkbox' : undefined} aria-checked={state === 'some' ? 'mixed' : state === 'on'} aria-label={label}
      onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
      className={clsx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
        state === 'off' ? 'border-slate-300 bg-white' : 'border-navy-700 bg-navy-700 text-white', onClick && 'cursor-pointer')}>
      {state === 'on' && <Check className="h-3 w-3" strokeWidth={3} />}{state === 'some' && <Minus className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

/** Multi-select with tick boxes. */
export function MultiSelect(p: Omit<MultiProps, 'multiple'>) { return <Dropdown {...p} multiple />; }

/** Convert <option>/<optgroup> children into dropdown options (lets every existing <Select> use the new design). */
export function optionsFromChildren(children: ReactNode, group?: string): DropdownOption[] {
  const out: DropdownOption[] = [];
  const text = (n: ReactNode): string => Children.toArray(n).map(c => (typeof c === 'string' || typeof c === 'number') ? String(c) : isValidElement(c) ? text((c.props as any).children) : '').join('');
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const props = child.props as any;
    if (child.type === 'option') {
      const label = text(props.children);
      out.push({ value: props.value !== undefined ? String(props.value) : label, label, group, disabled: !!props.disabled });
    } else if (child.type === 'optgroup') {
      out.push(...optionsFromChildren(props.children, props.label));
    } else if (props?.children) {
      out.push(...optionsFromChildren(props.children, group)); // fragments
    }
  });
  return out;
}
