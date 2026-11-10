-- Dedupe helpers, duplicate management and analytics RPCs
create or replace function public.find_company_by_name(p_name text, p_country text, p_demo boolean default false)
returns setof public.companies language sql stable security definer set search_path = public, extensions as $$
  select * from public.companies c
  where c.is_demo = p_demo
    and (p_country is null or c.country_code is null or c.country_code = p_country)
    and (c.normalized_name = public.normalize_name(p_name)
         or similarity(c.normalized_name, public.normalize_name(p_name)) > 0.85)
  order by (c.normalized_name = public.normalize_name(p_name)) desc, similarity(c.normalized_name, public.normalize_name(p_name)) desc
  limit 1
$$;

create or replace function public.find_contact(p_company uuid, p_name text, p_email text)
returns setof public.contacts language sql stable security definer set search_path = public, extensions as $$
  select * from public.contacts
  where (p_email is not null and email = p_email::citext)
     or (company_id = p_company and public.normalize_name(full_name) = public.normalize_name(p_name))
  limit 1
$$;

-- Possible duplicate companies for the admin duplicate manager
create or replace function public.company_duplicate_candidates(p_threshold real default 0.6)
returns table(a_id uuid, a_name text, b_id uuid, b_name text, country_code text, similarity real)
language sql stable security invoker set search_path = public, extensions as $$
  select a.id, a.name, b.id, b.name, coalesce(a.country_code, b.country_code)::text, similarity(a.normalized_name, b.normalized_name)
  from public.companies a join public.companies b
    on a.id < b.id and a.is_demo = b.is_demo
   and (a.country_code is not distinct from b.country_code or a.country_code is null or b.country_code is null)
   and a.normalized_name % b.normalized_name
  where similarity(a.normalized_name, b.normalized_name) >= p_threshold
     or (a.domain is not null and a.domain = b.domain)
  order by 6 desc limit 200
$$;

-- Merge p_drop into p_keep (admins only)
create or replace function public.merge_companies(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_keep = p_drop then raise exception 'Cannot merge a company into itself'; end if;
  update public.contacts set company_id = p_keep where company_id = p_drop
    and public.normalize_name(full_name) not in (select public.normalize_name(full_name) from public.contacts where company_id = p_keep);
  delete from public.contacts where company_id = p_drop;
  update public.leads set company_id = p_keep where company_id = p_drop
    and primary_contact_id is not null;
  delete from public.leads where company_id = p_drop;
  update public.company_sources set company_id = p_keep where company_id = p_drop and url not in (select url from public.company_sources where company_id = p_keep);
  update public.buying_signals set company_id = p_keep where company_id = p_drop
    and (source_url, signal_type) not in (select source_url, signal_type from public.buying_signals where company_id = p_keep);
  update public.research_reports set company_id = p_keep where company_id = p_drop;
  update public.notes set company_id = p_keep where company_id = p_drop;
  update public.companies set parent_company_id = p_keep where parent_company_id = p_drop;
  insert into public.campaign_companies(campaign_id, company_id, status)
    select campaign_id, p_keep, status from public.campaign_companies where company_id = p_drop on conflict do nothing;
  delete from public.companies where id = p_drop;
  insert into public.audit_logs(actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'merge', 'companies', p_keep::text, jsonb_build_object('merged', p_drop));
end $$;
grant execute on function public.merge_companies(uuid, uuid) to authenticated;

-- Dashboard aggregate (RLS-respecting: security invoker)
create or replace function public.dashboard_stats(p_demo boolean default false)
returns jsonb language sql stable security invoker set search_path = public, extensions as $$
  select jsonb_build_object(
    'companies', (select count(*) from companies where is_demo = p_demo),
    'qualified_companies', (select count(distinct company_id) from leads where is_demo = p_demo and stage not in ('newly_discovered','research_pending','not_relevant')),
    'contacts', (select count(*) from contacts where is_demo = p_demo),
    'verified_emails', (select count(*) from contacts where is_demo = p_demo and email_status = 'verified'),
    'priority_a', (select count(*) from leads where is_demo = p_demo and priority = 'A'),
    'outreach_generated', (select count(*) from outreach_messages m join contacts c on c.id = m.contact_id where c.is_demo = p_demo),
    'emails_sent', (select count(*) from communications m join leads l on l.id = m.lead_id where l.is_demo = p_demo and m.channel = 'email' and m.direction = 'outbound'),
    'meetings', (select count(*) from leads where is_demo = p_demo and stage in ('meeting_scheduled','proposal_shared','negotiation','won')),
    'proposals', (select count(*) from leads where is_demo = p_demo and stage in ('proposal_shared','negotiation','won')),
    'won', (select count(*) from leads where is_demo = p_demo and stage = 'won'),
    'closed', (select count(*) from leads where is_demo = p_demo and stage in ('won','lost')),
    'pipeline_value', (select coalesce(sum(deal_value),0) from leads where is_demo = p_demo and stage not in ('lost','not_relevant','won')),
    'won_value', (select coalesce(sum(deal_value),0) from leads where is_demo = p_demo and stage = 'won'),
    'by_country', (select coalesce(jsonb_agg(x),'[]') from (select coalesce(c.country_code,'??') k, count(*) v from leads l join companies c on c.id=l.company_id where l.is_demo = p_demo group by 1 order by 2 desc limit 20) x),
    'by_industry', (select coalesce(jsonb_agg(x),'[]') from (select coalesce(c.industry_segment||' · '||c.industry, c.industry, 'Unclassified') k, count(*) v from leads l join companies c on c.id=l.company_id where l.is_demo = p_demo group by 1 order by 2 desc limit 12) x),
    'by_department', (select coalesce(jsonb_agg(x),'[]') from (select ct.department::text k, count(*) v from leads l join contacts ct on ct.id=l.primary_contact_id where l.is_demo = p_demo group by 1 order by 2 desc) x),
    'by_seniority', (select coalesce(jsonb_agg(x),'[]') from (select ct.seniority::text k, count(*) v from leads l join contacts ct on ct.id=l.primary_contact_id where l.is_demo = p_demo group by 1 order by 2 desc) x),
    'by_source', (select coalesce(jsonb_agg(x),'[]') from (select coalesce(c.data_provider,'manual') k, count(*) v from companies c where c.is_demo = p_demo group by 1 order by 2 desc) x),
    'by_stage', (select coalesce(jsonb_agg(x),'[]') from (select stage::text k, count(*) v from leads where is_demo = p_demo group by 1) x),
    'by_priority', (select coalesce(jsonb_agg(x),'[]') from (select coalesce(priority,'—') k, count(*) v from leads where is_demo = p_demo group by 1 order by 1) x)
  )
$$;
grant execute on function public.dashboard_stats(boolean) to authenticated;
