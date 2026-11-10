export const ROLES = ['super_admin', 'admin', 'sales_manager', 'sales_executive', 'researcher'] as const;
export type Role = typeof ROLES[number];
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin', admin: 'Admin', sales_manager: 'Sales Manager', sales_executive: 'Sales Executive', researcher: 'Researcher',
};

export const DEPARTMENTS = ['learning_development', 'human_resources', 'sales', 'distribution_channel', 'trade_marketing', 'other'] as const;
export const TARGET_DEPARTMENTS = ['learning_development', 'human_resources', 'sales', 'distribution_channel', 'trade_marketing'] as const;
export const DEPT_LABEL: Record<string, string> = {
  learning_development: 'Learning & Development', human_resources: 'Human Resources', sales: 'Sales Leadership',
  distribution_channel: 'Distribution & Channel Management', trade_marketing: 'Trade Marketing & Category', other: 'Other',
};
export const DEPT_SHORT: Record<string, string> = { learning_development: 'L&D', human_resources: 'HR', sales: 'Sales', distribution_channel: 'Distribution', trade_marketing: 'Trade Mktg', other: 'Other' };

export const SENIORITIES = ['cxo', 'vp', 'director', 'head', 'senior', 'manager', 'other'] as const;
export const SENIORITY_LABEL: Record<string, string> = { cxo: 'CXO', vp: 'VP', director: 'Director', head: 'Head', senior: 'Senior / BP', manager: 'Manager', other: 'Other' };

export const STAGES = [
  'newly_discovered', 'research_pending', 'qualified', 'contact_identified', 'outreach_pending', 'first_email_sent',
  'linkedin_contacted', 'follow_up_required', 'meeting_scheduled', 'proposal_shared', 'negotiation', 'won', 'lost', 'not_relevant',
] as const;
export type Stage = typeof STAGES[number];
export const STAGE_LABEL: Record<Stage, string> = {
  newly_discovered: 'Newly discovered', research_pending: 'Research pending', qualified: 'Qualified', contact_identified: 'Contact identified',
  outreach_pending: 'Outreach pending', first_email_sent: 'First email sent', linkedin_contacted: 'LinkedIn contacted',
  follow_up_required: 'Follow-up required', meeting_scheduled: 'Meeting scheduled', proposal_shared: 'Proposal shared',
  negotiation: 'Negotiation', won: 'Won', lost: 'Lost', not_relevant: 'Not relevant',
};

export const EMAIL_STATUS_LABEL: Record<string, string> = {
  verified: 'Verified', provider_returned: 'Provider-returned', inferred_pattern: 'Inferred pattern',
  unverified: 'Unverified', invalid: 'Invalid', unavailable: 'Unavailable',
};

export const CHANNEL_LABEL: Record<string, string> = {
  intro_email: 'Introductory email', linkedin_connect: 'LinkedIn connection request', linkedin_followup: 'LinkedIn follow-up',
  whatsapp: 'WhatsApp introduction', followup_email: 'Follow-up email', meeting_request: 'Meeting request',
};

export const PRIORITY_LABEL: Record<string, string> = { A: 'Priority A – Highly qualified', B: 'Priority B – Strong prospect', C: 'Priority C – Potential prospect', R: 'Research required' };

export const SIGNAL_LABEL: Record<string, string> = {
  leadership_appointment: 'Leadership appointment', market_expansion: 'Market expansion', product_launch: 'Product launch',
  workforce_growth: 'Workforce growth', sales_transformation: 'Sales transformation', restructuring: 'Restructuring',
  leadership_programme: 'Leadership programme', commercial_excellence: 'Commercial excellence', distribution_strategy: 'Distribution strategy',
  merger_acquisition: 'M&A', annual_report_capability: 'Annual report: capability', sales_conference_academy: 'Sales conference / academy',
};

export const PROVIDER_LABEL: Record<string, string> = {
  apollo: 'Apollo', hunter: 'Hunter', pdl: 'People Data Labs', anthropic: 'Claude', anthropic_web_search: 'Claude web search',
  gemini: 'Gemini', gemini_web_search: 'Gemini + Google Search', ai: 'AI',
  google_cse: 'Google Search', website: 'Company website', manual: 'Manual', demo: 'Demo',
};
export const providerLabel = (p?: string | null) => (p ?? 'manual').split('+').map(x => PROVIDER_LABEL[x] ?? x).join(' + ');
