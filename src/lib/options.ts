import type { DropdownOption } from '@/components/Dropdown';
import type { RefData } from './hooks';

export const toOptions = (values: readonly string[], labels?: Record<string, string>): DropdownOption[] =>
  values.map(v => ({ value: v, label: labels?.[v] ?? v }));

/** Industries grouped under their sector group (tick a group header to select the whole sector). */
export const industryOptions = (ref: RefData | null, segments?: string[]): DropdownOption[] =>
  (ref?.industries ?? []).filter(i => i.is_active && (!segments?.length || segments.includes(i.segment)))
    .map(i => ({ value: i.name, label: i.name, group: i.segment }));

export const segmentOptions = (ref: RefData | null): DropdownOption[] =>
  (ref?.segments ?? []).map(s => ({ value: s, label: s, hint: String((ref?.industries ?? []).filter(i => i.is_active && i.segment === s).length) }));

/** Countries grouped by region. */
export const countryOptions = (ref: RefData | null, activeOnly = true): DropdownOption[] =>
  (ref?.countries ?? []).filter(c => !activeOnly || c.is_active)
    .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name))
    .map(c => ({ value: c.code, label: c.name, group: c.region }));

export const userOptions = (ref: RefData | null, withUnassigned = false): DropdownOption[] => [
  ...(withUnassigned ? [{ value: 'none', label: 'Unassigned' }] : []),
  ...(ref?.users ?? []).filter(u => u.is_active).map(u => ({ value: u.id, label: u.full_name ?? u.email })),
];

export const SIZE_BANDS: DropdownOption[] = [
  { value: '0-199', label: 'Under 200' }, { value: '200-499', label: '200–499' }, { value: '500-999', label: '500–999' },
  { value: '1000-4999', label: '1,000–4,999' }, { value: '5000-', label: '5,000+' },
];
/** PostgREST `or` filter for several employee-count bands. */
export const sizeOrFilter = (bands: string[]) => bands.map(b => {
  const [lo, hi] = b.split('-');
  return hi ? `and(employee_count.gte.${lo},employee_count.lte.${hi})` : `employee_count.gte.${lo}`;
}).join(',');

export const PROVIDER_OPTIONS: DropdownOption[] = [
  { value: 'apollo', label: 'Apollo' }, { value: 'pdl', label: 'People Data Labs' }, { value: 'ai', label: 'AI web search (Gemini / Claude)' },
];
