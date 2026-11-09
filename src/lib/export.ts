import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { DEPT_LABEL, EMAIL_STATUS_LABEL, SENIORITY_LABEL, STAGE_LABEL, providerLabel } from './constants';

export type ExportScope = 'companies' | 'contacts' | 'qualified' | 'priority_a' | 'country' | 'industry' | 'campaign' | 'decision_makers';
export interface ExportOptions { scope: ExportScope; format: 'xlsx' | 'csv'; demo: boolean; country?: string; industry?: string; campaignId?: string }

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

const sourcesOf = (arr?: { url: string | null }[]) => (arr ?? []).map(s => s.url).filter(Boolean).join(' | ');

export async function buildRows(o: ExportOptions): Promise<{ name: string; rows: Record<string, unknown>[] }> {
  if (o.scope === 'companies') {
    const rows = await all<any>((a, b) => supabase.from('companies').select('*, company_sources(url), company_brands(brand_name)').eq('is_demo', o.demo).order('name').range(a, b));
    return { name: 'Companies', rows: rows.map(c => ({
      'Company': c.name, 'Website': c.website, 'Domain': c.domain, 'Segment': c.industry_segment, 'Industry': c.industry,
      'Country': c.country_code, 'HQ': c.hq_city, 'LinkedIn': c.linkedin_url, 'Employees (est.)': c.employee_count,
      'Revenue (est.)': c.revenue_text ?? c.revenue_usd, 'Classification': c.classification, 'Ownership': c.ownership,
      'Parent company': c.parent_company_name, 'Key brands': (c.company_brands ?? []).map((b: any) => b.brand_name).join(', '),
      'Description': c.description, 'Data provider': providerLabel(c.data_provider), 'Source URLs': sourcesOf(c.company_sources),
      'Last verified': c.last_verified_at?.slice(0, 10),
    })) };
  }
  if (o.scope === 'contacts' || o.scope === 'decision_makers') {
    let rows = await all<any>((a, b) => supabase.from('contacts').select('*, company:companies(name, country_code, industry), contact_sources(url, provider)').eq('is_demo', o.demo).order('full_name').range(a, b));
    if (o.scope === 'decision_makers') rows = rows.filter(r => ['cxo', 'vp', 'director', 'head'].includes(r.seniority) && r.department !== 'other');
    return { name: o.scope === 'contacts' ? 'Contacts' : 'Decision Makers', rows: rows.map(contactRow) };
  }
  // lead-based scopes
  let query = supabase.from('leads').select('*, company:companies(*), contact:contacts(*, contact_sources(url)), campaign:campaigns(name), assignee:users!leads_assigned_to_fkey(full_name)').eq('is_demo', o.demo);
  if (o.scope === 'qualified') query = query.not('stage', 'in', '(newly_discovered,research_pending,not_relevant,lost)').gte('score', 50);
  if (o.scope === 'priority_a') query = query.eq('priority', 'A');
  if (o.scope === 'campaign' && o.campaignId) query = query.eq('campaign_id', o.campaignId);
  let rows = await all<any>((a, b) => query.order('score', { ascending: false, nullsFirst: false }).range(a, b));
  if (o.scope === 'country' && o.country) rows = rows.filter(r => r.company?.country_code === o.country);
  if (o.scope === 'industry' && o.industry) rows = rows.filter(r => r.company?.industry === o.industry || r.company?.industry_segment === o.industry);
  return { name: 'Leads', rows: rows.map(l => ({
    'Score': l.score, 'Priority': l.priority, 'Stage': STAGE_LABEL[l.stage as keyof typeof STAGE_LABEL],
    'Company': l.company?.name, 'Website': l.company?.website, 'Industry': l.company?.industry, 'Segment': l.company?.industry_segment,
    'Country': l.company?.country_code, 'Employees (est.)': l.company?.employee_count,
    ...(l.contact ? contactRow({ ...l.contact, company: null }) : { 'Name': '(no contact yet)' }),
    'Assigned to': l.assignee?.full_name, 'Campaign': l.campaign?.name, 'Deal value': l.deal_value, 'Currency': l.currency,
    'Last contact': l.last_contact_at?.slice(0, 10), 'Next follow-up': l.next_follow_up_at?.slice(0, 10), 'Lead source': l.source,
  })) };
}

function contactRow(c: any) {
  return {
    'Name': c.full_name, 'Designation': c.title, 'Department': DEPT_LABEL[c.department], 'Seniority': SENIORITY_LABEL[c.seniority],
    ...(c.company ? { 'Company': c.company.name, 'Country': c.company.country_code } : {}),
    'Email': c.email, 'Email status': EMAIL_STATUS_LABEL[c.email_status], 'Email source': c.email_provider === 'pattern_inference' ? 'Inferred from pattern (NOT verified)' : providerLabel(c.email_provider),
    'Phone': c.phone, 'LinkedIn': c.linkedin_url, 'Confidence': c.confidence, 'Do not contact': c.do_not_contact ? 'YES' : '',
    'Contact provider': providerLabel(c.data_provider), 'Contact source URLs': sourcesOf(c.contact_sources), 'Contact last verified': c.last_verified_at?.slice(0, 10),
  };
}

export async function exportData(o: ExportOptions) {
  const { name, rows } = await buildRows(o);
  if (!rows.length) throw new Error('No records match this export.');
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(48, Math.max(10, k.length + 2)) }));
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `WOT_${o.scope}${o.demo ? '_DEMO' : ''}_${stamp}.${o.format}`;
  if (o.format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click(); URL.revokeObjectURL(a.href);
  } else {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    XLSX.writeFile(wb, file);
  }
  return rows.length;
}
