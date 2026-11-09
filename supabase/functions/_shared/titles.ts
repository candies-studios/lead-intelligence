// Pure title classification — no Deno/Node APIs so it is unit-testable with Vitest.
export type Department = 'learning_development' | 'human_resources' | 'sales' | 'trade_marketing' | 'other';
export type Seniority = 'cxo' | 'vp' | 'director' | 'head' | 'manager' | 'senior' | 'other';

export interface TitleClassification {
  department: Department;
  seniority: Seniority;
  priority: 1 | 2 | 3 | 4 | null;
  isDecisionMaker: boolean;
}

const norm = (t: string) =>
  ` ${t.toLowerCase().replace(/[–—|/,()]/g, ' ').replace(/\s+/g, ' ').trim()} `;

const DEPT_RULES: Array<[Department, RegExp]> = [
  ['learning_development', /learning|\bl ?& ?d\b|\bl and d\b|training|capabilit|academy|leadership development|\bclo\b|talent development|learning business partner/],
  ['trade_marketing', /trade marketing|category|shopper|channel development|revenue growth|\brgm\b|commercial strategy/],
  ['human_resources', /\bhr\b|\bhrbp\b|human resource|\bpeople\b|talent|\bchro\b|organi[sz]ation(al)? development|\bod\b|\bcpo\b.*people|personnel/],
  ['sales', /sales|commercial|business development|key account|\bkam\b|\bcso\b|\bcco\b|go to market|route to market|distribution head/],
];

export function classifyDepartment(title: string): Department {
  const t = norm(title);
  for (const [dept, re] of DEPT_RULES) if (re.test(t)) return dept;
  return 'other';
}

export function classifySeniority(title: string): Seniority {
  const t = norm(title);
  if (/\bvp\b|vice president|\bsvp\b|\bevp\b|\bavp\b/.test(t)) return 'vp';
  if (/\bchief\b|\bc[a-z]{1,2}o\b|managing director|\bmd\b|\bpresident\b|country manager|general manager - country/.test(t)) return 'cxo';
  if (/director/.test(t)) return 'director';
  if (/\bhead\b|\bgm\b|general manager|\bnational\b.*\b(manager|lead)\b|\blead\b/.test(t)) return 'head';
  if (/business partner|\bsenior\b|\bsr\.?\b|principal/.test(t) && !/manager/.test(t)) return 'senior';
  if (/manager|partner/.test(t)) return 'manager';
  return 'other';
}

const PRIORITY: Record<Department, 1 | 2 | 3 | 4 | null> = {
  learning_development: 1, human_resources: 2, sales: 3, trade_marketing: 4, other: null,
};

export function classifyTitle(title: string | null | undefined): TitleClassification {
  if (!title) return { department: 'other', seniority: 'other', priority: null, isDecisionMaker: false };
  const department = classifyDepartment(title);
  const seniority = classifySeniority(title);
  const isDecisionMaker =
    department !== 'other' &&
    (['cxo', 'vp', 'director', 'head'].includes(seniority) ||
      // Learning Business Partners are explicitly targeted
      (department === 'learning_development' && seniority === 'senior') ||
      (/national trade marketing manager|national sales manager/.test(norm(title))));
  return { department, seniority, priority: PRIORITY[department], isDecisionMaker };
}

export function matchesTargets(
  c: TitleClassification,
  departments: string[] | null | undefined,
  seniorities: string[] | null | undefined,
): boolean {
  if (c.department === 'other') return false;
  if (departments?.length && !departments.includes(c.department)) return false;
  if (seniorities?.length && !seniorities.includes(c.seniority)) {
    // Learning Business Partners are an explicitly targeted specialist role
    return c.department === 'learning_development' && c.seniority === 'senior';
  }
  return true;
}

/** Title keywords used when querying people providers. */
export const TITLE_QUERIES: Record<Department, string[]> = {
  learning_development: ['learning and development', 'L&D', 'learning', 'training', 'capability development', 'leadership development', 'chief learning officer', 'sales capability'],
  human_resources: ['CHRO', 'chief human resources officer', 'HR director', 'head of HR', 'human resources', 'talent management', 'organisational development', 'chief people officer'],
  sales: ['chief sales officer', 'sales director', 'head of sales', 'VP sales', 'national sales', 'commercial director', 'sales excellence', 'commercial excellence', 'sales training'],
  trade_marketing: ['trade marketing', 'category management', 'category director', 'shopper marketing', 'channel development', 'revenue growth management', 'commercial strategy'],
  other: [],
};
