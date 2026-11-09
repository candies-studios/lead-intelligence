// Provider-neutral data shapes. Every provider maps its own response into these.
// Rule: providers only return what the upstream source actually returned — never synthesised values.

export interface CompanyQuery {
  segments: string[];          // FMCG / FMCD / Related
  industries: string[];        // industry names from the industries table
  industryKeywords: string[];  // derived from industries.keywords
  countries: { code: string; name: string }[];
  cities: string[];
  minEmployees?: number | null;
  maxEmployees?: number | null;
  keyword?: string | null;
  page: number;
  perPage: number;
}

export interface CompanyCandidate {
  name: string;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  industry: string | null;
  country_code: string | null;
  country_name?: string | null;
  hq_city: string | null;
  employee_count: number | null;
  employee_range: string | null;
  revenue_usd: number | null;
  revenue_text: string | null;
  ownership: 'public' | 'private' | 'subsidiary' | 'unknown';
  description: string | null;
  parent_company_name: string | null;
  brands: string[];
  provider: string;
  external_id: string | null;
  source_urls: { url: string; title?: string; type: string }[];
}

export interface ContactQuery {
  companyName: string;
  domain: string | null;
  externalIds: Record<string, string>;
  departments: string[];
  seniorities: string[];
  limit: number;
  countryName?: string | null;
}

export interface ContactCandidate {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  email_status: 'verified' | 'provider_returned' | 'inferred_pattern' | 'unverified' | 'invalid' | 'unavailable';
  email_confidence: number | null;
  phone: string | null;
  linkedin_url: string | null;
  city: string | null;
  country_name: string | null;
  bio: string | null;
  provider: string;
  external_id: string | null;
  source_urls: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface WebResult { url: string; title: string; snippet: string; published?: string | null; provider: string }

export interface ProviderResult<T> { items: T[]; exhausted: boolean; note?: string }
