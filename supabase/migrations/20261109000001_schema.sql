-- =====================================================================
-- WORLD OF TRADE | LEAD INTELLIGENCE — core schema
-- =====================================================================
create extension if not exists pg_trgm;
create extension if not exists citext;

-- ---------- Enums ----------
create type app_role as enum ('super_admin','admin','sales_manager','sales_executive','researcher');
create type department as enum ('learning_development','human_resources','sales','trade_marketing','other');
create type seniority as enum ('cxo','vp','director','head','manager','senior','other');
create type confidence_level as enum ('high','medium','low');
create type email_status as enum ('verified','provider_returned','inferred_pattern','unverified','invalid','unavailable');
create type company_classification as enum ('manufacturer','distributor','retailer','ecommerce','mixed','unknown');
create type ownership_type as enum ('public','private','subsidiary','unknown');
create type campaign_status as enum ('draft','running','paused','cancelled','completed','failed');
create type campaign_company_status as enum ('pending','enriching','enriched','skipped','failed');
create type lead_stage as enum (
  'newly_discovered','research_pending','qualified','contact_identified','outreach_pending',
  'first_email_sent','linkedin_contacted','follow_up_required','meeting_scheduled',
  'proposal_shared','negotiation','won','lost','not_relevant');
create type outreach_channel as enum ('intro_email','linkedin_connect','linkedin_followup','whatsapp','followup_email','meeting_request');
create type outreach_status as enum ('draft','approved','sent','archived');
create type comm_channel as enum ('email','linkedin','whatsapp','phone','meeting','other');

-- ---------- Generic helpers ----------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.normalize_name(t text) returns text language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(lower(coalesce(t,'')), '\m(ltd|limited|pvt|private|inc|llc|plc|gmbh|ag|sa|bv|nv|co|corp|corporation|company|group|holdings|pte|sdn|bhd|tbk|pt|jsc|fze|fzco|llp)\M\.?', '', 'g'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- ---------- Users / roles ----------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text,
  role app_role not null default 'sales_executive',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_users_updated before update on public.users for each row execute function set_updated_at();

create or replace function public.app_current_role() returns app_role
language sql stable security definer set search_path = public, extensions as $$
  select role from public.users where id = auth.uid() and is_active
$$;
create or replace function public.is_member() returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists(select 1 from public.users where id = auth.uid() and is_active) $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce(public.app_current_role() in ('super_admin','admin'), false) $$;
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce(public.app_current_role() in ('super_admin','admin','sales_manager'), false) $$;

-- First signup becomes super_admin; everyone else starts as sales_executive.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.users(id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when (select count(*) from public.users) = 0 then 'super_admin'::app_role else 'sales_executive'::app_role end)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Prevent non-admins from escalating their own role
create or replace function public.guard_user_role() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active) and not public.is_admin() then
    raise exception 'Only admins can change roles or activation';
  end if;
  if new.role = 'super_admin' and old.role <> 'super_admin' and public.app_current_role() <> 'super_admin' then
    raise exception 'Only a super admin can grant super admin';
  end if;
  return new;
end $$;
create trigger trg_guard_user_role before update on public.users for each row execute function guard_user_role();

-- ---------- Reference / configuration ----------
create table public.industries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  segment text not null check (segment in ('FMCG','FMCD','Related')),
  relevance numeric(3,2) not null default 1.0 check (relevance between 0 and 1),
  keywords text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.countries (
  code char(2) primary key,
  name text not null unique,
  region text not null,
  is_focus boolean not null default false,
  is_active boolean not null default true,
  cities text[] not null default '{}'
);

create table public.designations (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  department department not null,
  seniority seniority not null,
  priority smallint not null check (priority between 1 and 4),
  aliases text[] not null default '{}',
  is_active boolean not null default true
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

-- ---------- Companies ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (public.normalize_name(name)) stored,
  domain citext,
  website text,
  industry text,
  industry_segment text check (industry_segment in ('FMCG','FMCD','Related') or industry_segment is null),
  business_category text,
  country_code char(2) references public.countries(code),
  hq_city text,
  hq_address text,
  linkedin_url text,
  employee_count integer check (employee_count is null or employee_count >= 0),
  employee_range text,
  revenue_usd numeric,
  revenue_text text,
  classification company_classification not null default 'unknown',
  ownership ownership_type not null default 'unknown',
  parent_company_id uuid references public.companies(id) on delete set null,
  parent_company_name text,
  description text,
  data_provider text,
  external_ids jsonb not null default '{}',
  last_verified_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_not_own_parent check (parent_company_id is null or parent_company_id <> id)
);
create unique index companies_domain_uq on public.companies(domain, is_demo) where domain is not null;
create unique index companies_name_country_uq on public.companies(normalized_name, coalesce(country_code,'--'), is_demo);
create index companies_name_trgm on public.companies using gin (name gin_trgm_ops);
create index companies_country_idx on public.companies(country_code);
create index companies_industry_idx on public.companies(industry_segment, industry);
create index companies_parent_idx on public.companies(parent_company_id);
create trigger trg_companies_updated before update on public.companies for each row execute function set_updated_at();

create table public.company_brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  brand_name text not null,
  category text,
  source_url text,
  created_at timestamptz not null default now()
);
create unique index company_brands_uq on public.company_brands(company_id, lower(brand_name));

create table public.company_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  url text not null,
  title text,
  source_type text not null default 'web' check (source_type in ('website','provider','news','annual_report','press_release','directory','web','manual')),
  provider text,
  excerpt text,
  retrieved_at timestamptz not null default now()
);
create unique index company_sources_uq on public.company_sources(company_id, url);

-- ---------- Contacts ----------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  first_name text,
  last_name text,
  title text,
  department department not null default 'other',
  seniority seniority not null default 'other',
  designation_priority smallint,
  country_code char(2) references public.countries(code),
  city text,
  email citext,
  email_status email_status not null default 'unavailable',
  email_provider text,
  email_confidence smallint check (email_confidence is null or email_confidence between 0 and 100),
  phone text,
  phone_source text,
  linkedin_url text,
  bio text,
  experience_summary text,
  confidence confidence_level not null default 'low',
  relevance_score smallint,
  relevance_reason text,
  data_provider text,
  external_id text,
  lawful_basis text default 'legitimate_interest_b2b',
  consent_status text default 'not_requested',
  do_not_contact boolean not null default false,
  last_verified_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inferred_never_verified check (not (email_status = 'verified' and email_provider = 'pattern_inference'))
);
create unique index contacts_email_uq on public.contacts(email, is_demo) where email is not null;
create unique index contacts_company_name_uq on public.contacts(company_id, public.normalize_name(full_name));
create index contacts_company_idx on public.contacts(company_id);
create index contacts_dept_idx on public.contacts(department, seniority);
create trigger trg_contacts_updated before update on public.contacts for each row execute function set_updated_at();

create table public.contact_sources (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  url text,
  provider text not null,
  field text not null default 'profile',
  retrieved_at timestamptz not null default now()
);
create unique index contact_sources_uq on public.contact_sources(contact_id, provider, field, coalesce(url,''));

-- ---------- Signals & research ----------
create table public.buying_signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  signal_type text not null,
  description text not null,
  source_url text not null,
  source_title text,
  published_at date,
  training_opportunity text,
  suggested_approach text,
  confidence confidence_level not null default 'medium',
  created_at timestamptz not null default now()
);
create unique index buying_signals_uq on public.buying_signals(company_id, source_url, signal_type);
create index buying_signals_company_idx on public.buying_signals(company_id, published_at desc);

create table public.research_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  report jsonb not null,
  sources jsonb not null default '[]',
  model text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index research_reports_company_idx on public.research_reports(company_id, created_at desc);

-- ---------- Campaigns ----------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  segments text[] not null default '{FMCG}',
  industries text[] not null default '{}',
  countries text[] not null default '{}',
  cities text[] not null default '{}',
  min_employees integer,
  max_employees integer,
  classification company_classification[],
  departments department[] not null default '{learning_development,human_resources,sales,trade_marketing}',
  seniorities seniority[] not null default '{cxo,vp,director,head}',
  target_companies integer not null default 100 check (target_companies between 1 and 1000),
  contacts_per_company integer not null default 5 check (contacts_per_company between 1 and 15),
  status campaign_status not null default 'draft',
  progress jsonb not null default '{"companies_found":0,"companies_processed":0,"contacts_found":0,"leads_created":0,"discovery_page":1,"discovery_exhausted":false}',
  options jsonb not null default '{"detect_signals":true,"enrich_emails":false,"providers":[]}',
  step_lock_until timestamptz,
  last_error text,
  owner_id uuid references public.users(id),
  is_demo boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_campaigns_updated before update on public.campaigns for each row execute function set_updated_at();

create table public.campaign_companies (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  status campaign_company_status not null default 'pending',
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, company_id)
);
create index campaign_companies_status_idx on public.campaign_companies(campaign_id, status);

create table public.campaign_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  level text not null default 'info' check (level in ('info','warn','error','success')),
  message text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index campaign_events_idx on public.campaign_events(campaign_id, created_at desc);

-- ---------- Leads ----------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  stage lead_stage not null default 'newly_discovered',
  assigned_to uuid references public.users(id) on delete set null,
  score smallint check (score is null or score between 0 and 100),
  priority text check (priority in ('A','B','C','R')),
  deal_value numeric(14,2),
  currency char(3) default 'USD',
  lost_reason text,
  meeting_outcome text,
  source text,
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lost_needs_reason check (stage <> 'lost' or lost_reason is not null)
);
create unique index leads_company_contact_uq on public.leads(company_id, primary_contact_id) nulls not distinct;
create index leads_stage_idx on public.leads(stage);
create index leads_assigned_idx on public.leads(assigned_to);
create index leads_priority_idx on public.leads(priority, score desc);
create trigger trg_leads_updated before update on public.leads for each row execute function set_updated_at();

create table public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  total smallint not null,
  priority text not null,
  breakdown jsonb not null,
  explanation text[] not null default '{}',
  weights jsonb not null,
  computed_at timestamptz not null default now()
);
create index lead_scores_lead_idx on public.lead_scores(lead_id, computed_at desc);

-- ---------- Outreach / comms ----------
create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel outreach_channel not null,
  subject text,
  body text not null,
  status outreach_status not null default 'draft',
  ai_model text,
  grounding jsonb not null default '[]',
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outreach_contact_idx on public.outreach_messages(contact_id, channel);
create trigger trg_outreach_updated before update on public.outreach_messages for each row execute function set_updated_at();

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  outreach_message_id uuid references public.outreach_messages(id) on delete set null,
  channel comm_channel not null,
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  subject text,
  summary text,
  outcome text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index communications_lead_idx on public.communications(lead_id, occurred_at desc);
create index communications_contact_idx on public.communications(contact_id, occurred_at desc);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null,
  notes text,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  assigned_to uuid references public.users(id),
  completed_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index follow_ups_due_idx on public.follow_ups(status, due_at);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  body text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint note_has_target check (coalesce(lead_id, company_id, contact_id) is not null)
);

-- Keep lead next_follow_up_at in sync
create or replace function public.sync_next_follow_up() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare lid uuid := coalesce(new.lead_id, old.lead_id);
begin
  update public.leads set next_follow_up_at =
    (select min(due_at) from public.follow_ups where lead_id = lid and status = 'open')
  where id = lid;
  return null;
end $$;
create trigger trg_follow_up_sync after insert or update or delete on public.follow_ups for each row execute function sync_next_follow_up();

create or replace function public.sync_last_contact() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.direction = 'outbound' then
    update public.leads set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at) where id = new.lead_id;
  end if;
  return null;
end $$;
create trigger trg_comm_sync after insert on public.communications for each row execute function sync_last_contact();

-- ---------- Integrations ----------
create table public.integrations (
  provider text primary key,
  display_name text not null,
  category text not null check (category in ('ai','search','enrichment','company_data','email','crm','builtin')),
  description text,
  enabled boolean not null default true,
  status text not null default 'not_configured' check (status in ('connected','not_configured','error','planned','builtin')),
  last_checked_at timestamptz,
  last_error text,
  config jsonb not null default '{}'
);

-- Secrets: RLS enabled with NO policies → only the service role (edge functions) can read/write.
create table public.integration_secrets (
  provider text primary key references public.integrations(provider) on delete cascade,
  api_key text not null,
  extra jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------- Privacy ----------
create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  email citext,
  domain citext,
  reason text not null default 'do_not_contact' check (reason in ('do_not_contact','unsubscribed','bounced','deletion_request','legal')),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint suppression_target check (email is not null or domain is not null)
);
create unique index suppression_email_uq on public.suppression_list(email) where email is not null;
create unique index suppression_domain_uq on public.suppression_list(domain) where domain is not null;

create or replace function public.apply_suppression() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.email is not null and exists (
     select 1 from public.suppression_list s
     where s.email = new.email or s.domain = split_part(new.email::text,'@',2)) then
    new.do_not_contact := true;
  end if;
  return new;
end $$;
create trigger trg_contacts_suppression before insert or update of email on public.contacts for each row execute function apply_suppression();

create or replace function public.propagate_suppression() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.contacts set do_not_contact = true
   where (new.email is not null and email = new.email)
      or (new.domain is not null and split_part(email::text,'@',2) = new.domain::text);
  return null;
end $$;
create trigger trg_suppression_propagate after insert on public.suppression_list for each row execute function propagate_suppression();

-- ---------- Audit / usage ----------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  provider text not null,
  operation text not null,
  units integer not null default 1,
  success boolean not null default true,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index usage_events_created_idx on public.usage_events(created_at desc, provider);

create or replace function public.audit_trigger() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare rec jsonb; changed jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, value) into changed from jsonb_each(to_jsonb(new))
      where to_jsonb(old)->key is distinct from value and key not in ('updated_at');
  end if;
  -- never write secrets into audit
  insert into public.audit_logs(actor_id, action, entity, entity_id, meta)
  values (auth.uid(), lower(tg_op), tg_table_name, rec->>coalesce(tg_argv[0],'id'),
          coalesce(changed, jsonb_build_object('name', coalesce(rec->>'name', rec->>'full_name', rec->>'title'))));
  return null;
end $$;
create trigger audit_companies after insert or update or delete on public.companies for each row execute function audit_trigger();
create trigger audit_contacts after insert or update or delete on public.contacts for each row execute function audit_trigger();
create trigger audit_leads after insert or update or delete on public.leads for each row execute function audit_trigger();
create trigger audit_campaigns after insert or update or delete on public.campaigns for each row execute function audit_trigger();
create trigger audit_users after update on public.users for each row execute function audit_trigger();
create trigger audit_integrations after update on public.integrations for each row execute function audit_trigger('provider');
create trigger audit_settings after insert or update on public.app_settings for each row execute function audit_trigger('key');
create trigger audit_suppression after insert or delete on public.suppression_list for each row execute function audit_trigger();

-- ---------- Analytics views (security_invoker so RLS applies) ----------
create or replace view public.v_lead_overview with (security_invoker = true) as
select l.*, c.name as company_name, c.country_code, c.industry, c.industry_segment, c.domain,
       ct.full_name as contact_name, ct.title as contact_title, ct.department as contact_department,
       ct.seniority as contact_seniority, ct.email as contact_email, ct.email_status, ct.linkedin_url as contact_linkedin,
       ct.confidence as contact_confidence, ct.do_not_contact, u.full_name as assigned_name
from public.leads l
join public.companies c on c.id = l.company_id
left join public.contacts ct on ct.id = l.primary_contact_id
left join public.users u on u.id = l.assigned_to;
