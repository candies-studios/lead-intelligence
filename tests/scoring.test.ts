import { describe, expect, it } from 'vitest';
import { scoreLead, priorityFor, DEFAULT_WEIGHTS } from '../supabase/functions/_shared/scoring';
import { classifyTitle, matchesTargets } from '../supabase/functions/_shared/titles';
import { inferEmail } from '../supabase/functions/_shared/providers/hunter';
import { extractJson, wasRetrieved, filterToRetrieved } from '../supabase/functions/_shared/providers/claude';

const now = new Date('2026-11-01');

describe('title classification', () => {
  const cases: [string, string, string][] = [
    ['Chief Learning Officer', 'learning_development', 'cxo'],
    ['Head - L&D', 'learning_development', 'head'],
    ['Head of Sales Capability Development', 'learning_development', 'head'],
    ['CHRO', 'human_resources', 'cxo'],
    ['Vice President, Human Resources', 'human_resources', 'vp'],
    ['Director of Organizational Development', 'human_resources', 'director'],
    ['National Sales Head', 'sales', 'head'],
    ['Commercial Director – GCC', 'sales', 'director'],
    ['Head of Revenue Growth Management', 'trade_marketing', 'head'],
    ['Category Director', 'trade_marketing', 'director'],
    ['Software Engineer', 'other', 'other'],
    ['Head of Distribution', 'distribution_channel', 'head'],
    ['Channel Sales Director – South Asia', 'distribution_channel', 'director'],
    ['VP, Dealer Network Development', 'distribution_channel', 'vp'],
    ['Head of Route-to-Market', 'distribution_channel', 'head'],
    ['National Head – General Trade', 'distribution_channel', 'head'],
    ['Head of Channel Partnerships', 'distribution_channel', 'head'],
    ['Head of Channel Development', 'trade_marketing', 'head'],
    ['HR Business Partner', 'human_resources', 'senior'],
    ['Head of Key Accounts', 'sales', 'head'],
  ];
  it.each(cases)('%s', (title, dept, sen) => {
    const c = classifyTitle(title);
    expect(c.department).toBe(dept);
    expect(c.seniority).toBe(sen);
  });
  it('treats Learning Business Partner as a target', () => {
    const c = classifyTitle('Learning Business Partner');
    expect(c.department).toBe('learning_development');
    expect(c.seniority).toBe('senior');
    expect(matchesTargets(c, ['learning_development'], ['director', 'head'])).toBe(true);
  });
  it('filters out juniors and unrelated functions', () => {
    expect(matchesTargets(classifyTitle('HR Executive'), ['human_resources'], ['cxo', 'vp', 'director', 'head'])).toBe(false);
    expect(matchesTargets(classifyTitle('Head of IT'), [], [])).toBe(false);
  });
});

describe('distribution & channel targeting', () => {
  it('National Distribution Manager counts as a decision-maker', () => {
    const c = classifyTitle('National Distribution Manager');
    expect(c.department).toBe('distribution_channel');
    expect(c.isDecisionMaker).toBe(true);
    expect(c.priority).toBe(3);
  });
});

describe('lead scoring', () => {
  it('scores a non-FMCG sector (building materials) on equal footing', () => {
    const r = scoreLead({
      company: { industry: 'Paints & Coatings', industry_segment: 'Building Materials & Construction', employee_count: 8000, country_code: 'IN' }, industryRelevance: 1,
      contact: { title: 'Head of Dealer Network', department: 'distribution_channel', seniority: 'head', email_status: 'verified', linkedin_url: 'x', source_count: 1 },
      signals: [{ published_at: '2026-08-01' }, { published_at: '2026-05-01' }], focusCountries: ['IN'], now,
    });
    expect(r.factors.find(f => f.key === 'training_relevance')!.reason).toMatch(/channel/i);
    expect(r.total).toBeGreaterThanOrEqual(80);
  });
  it('unknown sector group without configured relevance gets a reasonable default', () => {
    const r = scoreLead({ company: { industry_segment: 'Automotive & Mobility' }, contact: null, signals: [], focusCountries: [], now });
    expect(r.factors.find(f => f.key === 'industry')!.fraction).toBe(0.8);
  });
  it('scores an ideal FMCG lead as Priority A', () => {
    const r = scoreLead({
      company: { industry_segment: 'FMCG', employee_count: 12000, country_code: 'IN' }, industryRelevance: 1,
      contact: { title: 'Head of Capability Development', department: 'learning_development', seniority: 'head', email_status: 'verified', linkedin_url: 'https://linkedin.com/in/x', source_count: 1 },
      signals: [{ published_at: '2026-09-01' }, { published_at: '2026-06-01' }, { published_at: '2026-03-01' }], focusCountries: ['IN'], now,
    });
    expect(r.total).toBeGreaterThanOrEqual(85);
    expect(r.priority).toBe('A');
    expect(r.factors).toHaveLength(7);
    expect(r.explanation[0]).toMatch(/Industry relevance/);
  });
  it('company without contact needs research', () => {
    const r = scoreLead({ company: { industry_segment: 'FMCG', employee_count: 800, country_code: 'IN' }, contact: null, signals: [], focusCountries: ['IN'], now });
    expect(r.priority).toBe('R');
  });
  it('do-not-contact zeroes contact quality', () => {
    const r = scoreLead({ company: { industry_segment: 'FMCD' }, contact: { seniority: 'cxo', department: 'sales', email_status: 'verified', do_not_contact: true }, signals: [], focusCountries: [], now });
    expect(r.factors.find(f => f.key === 'contact_quality')!.points).toBe(0);
  });
  it('normalises custom weights to 100', () => {
    const w = { ...DEFAULT_WEIGHTS, industry: 40 };
    const r = scoreLead({ company: { industry_segment: 'FMCG', employee_count: 99999, country_code: 'AE' }, contact: { seniority: 'cxo', department: 'learning_development', title: 'Chief Learning Officer', email_status: 'verified', linkedin_url: 'x', source_count: 2 }, signals: [{}, {}, {}], focusCountries: ['AE'], now }, w);
    expect(r.total).toBe(100);
  });
  it('ignores signals older than 12 months', () => {
    const r = scoreLead({ company: {}, contact: null, signals: [{ published_at: '2024-01-01' }], focusCountries: [], now });
    expect(r.factors.find(f => f.key === 'growth_signals')!.points).toBe(0);
  });
  it('priority bands', () => {
    expect(priorityFor(85)).toBe('A'); expect(priorityFor(84)).toBe('B'); expect(priorityFor(70)).toBe('B');
    expect(priorityFor(69)).toBe('C'); expect(priorityFor(50)).toBe('C'); expect(priorityFor(49)).toBe('R');
  });
});

describe('email inference', () => {
  it('builds pattern emails and strips accents', () => {
    expect(inferEmail('{first}.{last}', 'José', "D'Souza", 'acme.com')).toBe('jose.dsouza@acme.com');
    expect(inferEmail('{f}{last}', 'Anita', 'Rao', 'acme.com')).toBe('arao@acme.com');
  });
  it('returns null when data is missing', () => {
    expect(inferEmail(null, 'a', 'b', 'x.com')).toBeNull();
    expect(inferEmail('{first}', 'a', 'b', null)).toBeNull();
  });
});

describe('AI grounding helpers', () => {
  const retrieved = [{ url: 'https://www.example.com/news/item?utm=1' }, { url: 'https://site.org/page/' }];
  it('matches retrieved URLs loosely (scheme, www, query, trailing slash)', () => {
    expect(wasRetrieved('http://example.com/news/item', retrieved)).toBe(true);
    expect(wasRetrieved('https://site.org/page', retrieved)).toBe(true);
    expect(wasRetrieved('https://site.org/other', retrieved)).toBe(false);
    expect(wasRetrieved(null, retrieved)).toBe(false);
  });
  it('drops ungrounded items', () => {
    const items = [{ source_url: 'https://site.org/page' }, { source_url: 'https://made-up.com' }];
    expect(filterToRetrieved(items, retrieved)).toHaveLength(1);
  });
  it('extracts JSON from fenced and prose output', () => {
    expect(extractJson('Here you go:\n```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Result {"x":"a } b","y":{"z":1}} trailing')).toEqual({ x: 'a } b', y: { z: 1 } });
  });
});
