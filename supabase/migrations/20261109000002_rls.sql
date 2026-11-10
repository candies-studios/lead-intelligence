-- =====================================================================
-- Row Level Security
-- Roles: super_admin, admin, sales_manager, sales_executive, researcher
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'users','industries','countries','designations','app_settings','companies','company_brands',
    'company_sources','contacts','contact_sources','buying_signals','research_reports','campaigns',
    'campaign_companies','campaign_events','leads','lead_scores','outreach_messages','communications',
    'follow_ups','notes','integrations','integration_secrets','suppression_list','audit_logs','usage_events']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- users
create policy users_select on public.users for select to authenticated using (is_member() or id = auth.uid());
create policy users_update_self on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy users_admin_all on public.users for all to authenticated using (is_admin()) with check (is_admin());

-- reference tables: everyone reads, admins write
do $$
declare t text;
begin
  foreach t in array array['industries','countries','designations','app_settings','integrations'] loop
    execute format('create policy %I on public.%I for select to authenticated using (is_member())', t||'_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (is_admin()) with check (is_admin())', t||'_admin', t);
  end loop;
end $$;
-- integration_secrets: intentionally no policies (service role only) and no client grants
revoke all on public.integration_secrets from anon, authenticated;

-- research data: members read & write, admins delete
do $$
declare t text;
begin
  foreach t in array array['companies','company_brands','company_sources','contacts','contact_sources','buying_signals','research_reports'] loop
    execute format('create policy %I on public.%I for select to authenticated using (is_member())', t||'_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (is_member())', t||'_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (is_member()) with check (is_member())', t||'_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (is_admin())', t||'_delete', t);
  end loop;
end $$;

-- campaigns
create policy campaigns_read on public.campaigns for select to authenticated using (is_member());
create policy campaigns_insert on public.campaigns for insert to authenticated with check (is_member() and created_by = auth.uid());
create policy campaigns_update on public.campaigns for update to authenticated
  using (is_manager() or created_by = auth.uid() or owner_id = auth.uid());
create policy campaigns_delete on public.campaigns for delete to authenticated using (is_manager() or created_by = auth.uid());
create policy campaign_companies_read on public.campaign_companies for select to authenticated using (is_member());
create policy campaign_events_read on public.campaign_events for select to authenticated using (is_member());

-- leads: everyone reads; managers update all; others update leads they own/are assigned
create policy leads_read on public.leads for select to authenticated using (is_member());
create policy leads_insert on public.leads for insert to authenticated with check (is_member());
create policy leads_update on public.leads for update to authenticated
  using (is_manager() or assigned_to = auth.uid() or created_by = auth.uid() or assigned_to is null)
  with check (is_member());
create policy leads_delete on public.leads for delete to authenticated using (is_manager());
create policy lead_scores_read on public.lead_scores for select to authenticated using (is_member());

-- activity tables
do $$
declare t text;
begin
  foreach t in array array['outreach_messages','communications','follow_ups','notes'] loop
    execute format('create policy %I on public.%I for select to authenticated using (is_member())', t||'_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (is_member() and created_by = auth.uid())', t||'_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (is_manager() or created_by = auth.uid())', t||'_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (is_manager() or created_by = auth.uid())', t||'_delete', t);
  end loop;
end $$;
-- assignees may also complete their follow-ups
create policy follow_ups_assignee_update on public.follow_ups for update to authenticated using (assigned_to = auth.uid());

-- suppression list
create policy suppression_read on public.suppression_list for select to authenticated using (is_member());
create policy suppression_insert on public.suppression_list for insert to authenticated with check (is_member());
create policy suppression_delete on public.suppression_list for delete to authenticated using (is_admin());

-- audit & usage: admins read; writes come from triggers / service role
create policy audit_read on public.audit_logs for select to authenticated using (is_admin());
create policy usage_read on public.usage_events for select to authenticated using (is_manager());

-- Privacy: hard-delete a contact and record the request (callable by admins)
create or replace function public.erase_contact(p_contact_id uuid, p_reason text default 'deletion_request')
returns void language plpgsql security definer set search_path = public, extensions as $$
declare e citext;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select email into e from public.contacts where id = p_contact_id;
  if e is not null then
    insert into public.suppression_list(email, reason, created_by) values (e, 'deletion_request', auth.uid())
    on conflict do nothing;
  end if;
  delete from public.contacts where id = p_contact_id;
  insert into public.audit_logs(actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'erase', 'contacts', p_contact_id::text, jsonb_build_object('reason', p_reason));
end $$;
revoke all on function public.erase_contact(uuid, text) from public;
grant execute on function public.erase_contact(uuid, text) to authenticated;
