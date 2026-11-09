// Pure lead-scoring engine (score out of 100). Unit-tested in tests/scoring.test.ts.
export interface ScoringWeights {
  industry: number; company_size: number; seniority: number; training_relevance: number;
  growth_signals: number; contact_quality: number; geography: number;
}
export const DEFAULT_WEIGHTS: ScoringWeights = {
  industry: 20, company_size: 15, seniority: 20, training_relevance: 20,
  growth_signals: 10, contact_quality: 10, geography: 5,
};
export interface PriorityBands { A: number; B: number; C: number }
export const DEFAULT_BANDS: PriorityBands = { A: 85, B: 70, C: 50 };

export interface ScoreInput {
  company: {
    industry?: string | null;
    industry_segment?: string | null;
    employee_count?: number | null;
    country_code?: string | null;
  };
  industryRelevance?: number | null; // 0..1 from industries table
  contact?: {
    title?: string | null;
    department?: string | null;
    seniority?: string | null;
    email_status?: string | null;
    linkedin_url?: string | null;
    source_count?: number;
    do_not_contact?: boolean;
  } | null;
  signals: Array<{ published_at?: string | null; confidence?: string | null }>;
  focusCountries: string[];
  campaignCountries?: string[];
  now?: Date;
}

export interface ScoreFactor { key: keyof ScoringWeights; label: string; fraction: number; points: number; max: number; reason: string }
export interface ScoreResult { total: number; priority: 'A' | 'B' | 'C' | 'R'; factors: ScoreFactor[]; explanation: string[] }

const LABELS: Record<keyof ScoringWeights, string> = {
  industry: 'Industry relevance', company_size: 'Company size and scale', seniority: 'Decision-maker seniority',
  training_relevance: 'Relevance to commercial training', growth_signals: 'Growth / organisational signals',
  contact_quality: 'Contact information quality', geography: 'Geographic relevance',
};

function industryFactor(i: ScoreInput): [number, string] {
  if (typeof i.industryRelevance === 'number')
    return [i.industryRelevance, `${i.company.industry ?? 'Industry'} has configured relevance ${(i.industryRelevance * 100).toFixed(0)}%`];
  switch (i.company.industry_segment) {
    case 'FMCG': return [1, 'Core FMCG company'];
    case 'FMCD': return [1, 'Core FMCD / consumer durables company'];
    case 'Related': return [0.75, 'Related retail / distribution organisation'];
    default: return [0.25, 'Industry not yet confirmed — research required'];
  }
}

function sizeFactor(n: number | null | undefined): [number, string] {
  if (n == null) return [0.25, 'Employee count unknown'];
  if (n >= 5000) return [1, `${n.toLocaleString()} employees — large enterprise, multiple cohorts possible`];
  if (n >= 1000) return [0.8, `${n.toLocaleString()} employees — large company`];
  if (n >= 500) return [0.6, `${n.toLocaleString()} employees — mid-to-large company`];
  if (n >= 200) return [0.35, `${n.toLocaleString()} employees — mid-size company`];
  return [0.1, `${n.toLocaleString()} employees — likely too small for a 20–30 person cohort`];
}

function seniorityFactor(s: string | null | undefined): [number, string] {
  const map: Record<string, [number, string]> = {
    cxo: [1, 'C-level decision-maker'], vp: [0.9, 'VP-level decision-maker'],
    director: [0.8, 'Director-level decision-maker'], head: [0.8, 'Head-of-function decision-maker'],
    senior: [0.5, 'Senior specialist / business partner (influencer)'], manager: [0.4, 'Manager-level (influencer)'],
    other: [0.1, 'Seniority unclear'],
  };
  return s ? (map[s] ?? map.other) : [0, 'No contact identified yet'];
}

function trainingFactor(dept: string | null | undefined, title: string | null | undefined): [number, string] {
  const base: Record<string, [number, string]> = {
    learning_development: [1, 'Owns L&D / capability budgets — primary buyer'],
    human_resources: [0.8, 'HR leadership — sponsors leadership development'],
    sales: [0.7, 'Sales leadership — direct beneficiary of commercial simulation'],
    trade_marketing: [0.65, 'Trade marketing / category — retailer economics fit'],
    other: [0.1, 'Function not linked to training decisions'],
  };
  if (!dept) return [0, 'No contact identified yet'];
  let [f, r] = base[dept] ?? base.other;
  if (title && /capabilit|sales excellence|commercial excellence|academy|sales training/i.test(title)) {
    f = Math.min(1, f + 0.2); r += '; title explicitly covers capability/excellence';
  }
  return [f, r];
}

function signalFactor(signals: ScoreInput['signals'], now: Date): [number, string] {
  const yearAgo = new Date(now.getTime() - 365 * 864e5);
  const recent = signals.filter(s => !s.published_at || new Date(s.published_at) >= yearAgo);
  const n = recent.length;
  if (n === 0) return [0, 'No sourced growth or organisational signals yet'];
  const f = n >= 3 ? 1 : n === 2 ? 0.8 : 0.5;
  return [f, `${n} sourced signal${n > 1 ? 's' : ''} in the last 12 months`];
}

function contactQualityFactor(c: ScoreInput['contact']): [number, string] {
  if (!c) return [0, 'No contact identified yet'];
  let f = 0; const parts: string[] = [];
  switch (c.email_status) {
    case 'verified': f += 0.5; parts.push('verified email'); break;
    case 'provider_returned': f += 0.3; parts.push('provider-returned email'); break;
    case 'inferred_pattern': f += 0.1; parts.push('inferred email (unverified)'); break;
    default: parts.push('no email');
  }
  if (c.linkedin_url) { f += 0.3; parts.push('LinkedIn URL'); }
  if ((c.source_count ?? 0) > 0) { f += 0.2; parts.push('source attributed'); }
  if (c.do_not_contact) { f = 0; parts.push('ON DO-NOT-CONTACT LIST'); }
  return [Math.min(1, f), parts.join(', ')];
}

function geoFactor(i: ScoreInput): [number, string] {
  const cc = i.company.country_code;
  if (!cc) return [0.2, 'Country unknown'];
  if (i.campaignCountries?.length && i.campaignCountries.includes(cc)) return [1, `${cc} is a campaign target country`];
  if (i.focusCountries.includes(cc)) return [1, `${cc} is a focus market`];
  return [0.4, `${cc} is outside focus markets`];
}

export function priorityFor(total: number, bands: PriorityBands = DEFAULT_BANDS): 'A' | 'B' | 'C' | 'R' {
  if (total >= bands.A) return 'A';
  if (total >= bands.B) return 'B';
  if (total >= bands.C) return 'C';
  return 'R';
}

export function scoreLead(input: ScoreInput, weights: ScoringWeights = DEFAULT_WEIGHTS, bands: PriorityBands = DEFAULT_BANDS): ScoreResult {
  const now = input.now ?? new Date();
  const raw: Record<keyof ScoringWeights, [number, string]> = {
    industry: industryFactor(input),
    company_size: sizeFactor(input.company.employee_count),
    seniority: seniorityFactor(input.contact?.seniority),
    training_relevance: trainingFactor(input.contact?.department, input.contact?.title),
    growth_signals: signalFactor(input.signals, now),
    contact_quality: contactQualityFactor(input.contact),
    geography: geoFactor(input),
  };
  const sumW = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const factors: ScoreFactor[] = (Object.keys(raw) as (keyof ScoringWeights)[]).map(key => {
    const [fraction, reason] = raw[key];
    const max = (weights[key] / sumW) * 100; // normalise so total is always out of 100
    return { key, label: LABELS[key], fraction, points: Math.round(fraction * max * 10) / 10, max: Math.round(max * 10) / 10, reason };
  });
  const total = Math.max(0, Math.min(100, Math.round(factors.reduce((a, f) => a + f.points, 0))));
  const priority = priorityFor(total, bands);
  const explanation = factors.map(f => `${f.label}: ${f.points}/${f.max} — ${f.reason}`);
  return { total, priority, factors, explanation };
}
