import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Run an async loader and expose data/loading/error/reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fn()); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, loading, error, reload: run, setData };
}

/** Throw on Supabase error so useAsync can show it. */
export async function q<T>(p: PromiseLike<{ data: T | null; error: any; count?: number | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export interface RefData {
  industries: { id: string; name: string; segment: string; relevance: number; is_active: boolean; keywords: string[]; sort_order?: number }[];
  segments: string[];
  countries: { code: string; name: string; region: string; is_focus: boolean; is_active: boolean; cities: string[] }[];
  users: { id: string; full_name: string | null; email: string; role: string; is_active: boolean }[];
}
let refCache: RefData | null = null;
export function useRefData() {
  return useAsync<RefData>(async () => {
    if (refCache) return refCache;
    const [industries, countries, users] = await Promise.all([
      q(supabase.from('industries').select('*').order('sort_order', { ascending: true, nullsFirst: false }).order('segment').order('name')),
      q(supabase.from('countries').select('*').order('name')),
      q(supabase.from('users').select('id, full_name, email, role, is_active').order('full_name')),
    ]);
    const segs = [...new Set((industries as any[]).filter(i => i.is_active).map(i => i.segment as string))];
    refCache = { industries: industries as any, countries: countries as any, users: users as any, segments: segs };
    return refCache;
  });
}
export const invalidateRefData = () => { refCache = null; };

export const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d?: string | null) => d ? new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtNum = (n?: number | null) => n == null ? '—' : n.toLocaleString();
export const fmtMoney = (n?: number | null, c = 'USD') => n == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
