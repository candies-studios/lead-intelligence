-- =====================================================================
-- Automated outreach: Gmail mailboxes, approved sequences, enrollments,
-- email log (sent + received + drafts awaiting approval), locks.
-- =====================================================================

-- ---------- Fix: unique indexes usable by upserts (ON CONFLICT cannot target partial/expression indexes)
drop index if exists public.suppression_email_uq;
drop index if exists public.suppression_domain_uq;
create unique index if not exists suppression_email_key on public.suppression_list(email);   -- NULLs stay distinct
create unique index if not exists suppression_domain_key on public.suppression_list(domain);
drop index if exists public.contact_sources_uq;
delete from public.contact_sources a using public.contact_sources b
 where a.id > b.id and a.contact_id = b.contact_id and a.provider = b.provider and a.field = b.field and a.url is not distinct from b.url;
create unique index if not exists contact_sources_key on public.contact_sources(contact_id, provider, field, url) nulls not distinct;

-- ---------- Mailboxes (one per connected Gmail / Google Workspace account)
create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'gmail' check (provider in ('gmail')),
  email citext not null unique,
  display_name text,
  user_id uuid references public.users(id) on delete set null,
  status text not null default 'connected' check (status in ('connected','error','disconnected')),
  last_error text,
  daily_limit integer not null default 40 check (daily_limit between 1 and 500),
  warmup_start date not null default current_date,
  warmup_start_volume integer not null default 10 check (warmup_start_volume between 1 and 500),
  warmup_increment integer not null default 5 check (warmup_increment between 0 and 100),
  sender_title text,
  signature text,
  history_id text,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_mailboxes_updated on public.mailboxes;
create trigger trg_mailboxes_updated before update on public.mailboxes for each row execute function set_updated_at();

-- Refresh tokens: service role only
create table if not exists public.mailbox_secrets (
  mailbox_id uuid primary key references public.mailboxes(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null,
  return_url text,
  created_at timestamptz not null default now()
);

-- ---------- Sequences (approved once per campaign)
create table if not exists public.sequences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused')),
  mailbox_id uuid references public.mailboxes(id) on delete set null,
  steps jsonb not null default '[]',
  settings jsonb not null default '{"priorities":["A","B"],"allowed_email_statuses":["verified"],"daily_cap":30,"timezone_by_country":true,"sender_name":null,"sender_title":null}',
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sequences_campaign_uq on public.sequences(campaign_id) where campaign_id is not null;
drop trigger if exists trg_sequences_updated on public.sequences;
create trigger trg_sequences_updated before update on public.sequences for each row execute function set_updated_at();

-- Editing an active sequence's steps sends it back to draft (re-approval required)
create or replace function public.sequence_require_reapproval() returns trigger language plpgsql as $$
begin
  if new.steps is distinct from old.steps and old.status = 'active' and new.status = 'active' then
    new.status := 'draft'; new.approved_at := null; new.approved_by := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_sequence_reapproval on public.sequences;
create trigger trg_sequence_reapproval before update on public.sequences for each row execute function sequence_require_reapproval();

-- ---------- Enrollments (one lead/contact moving through a sequence)
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  mailbox_id uuid references public.mailboxes(id) on delete set null,
  status text not null default 'active' check (status in ('active','paused','completed','replied','bounced','unsubscribed','stopped','failed')),
  current_step integer not null default 0,
  next_run_at timestamptz,
  thread_id text,
  first_subject text,
  last_rfc_message_id text,
  vars jsonb not null default '{}',
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, contact_id)
);
create index if not exists enrollments_due_idx on public.enrollments(status, next_run_at);
create index if not exists enrollments_lead_idx on public.enrollments(lead_id);
create index if not exists enrollments_thread_idx on public.enrollments(thread_id);
drop trigger if exists trg_enrollments_updated on public.enrollments;
create trigger trg_enrollments_updated before update on public.enrollments for each row execute function set_updated_at();

-- ---------- Email log
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid references public.mailboxes(id) on delete set null,
  lead_id uuid references public.leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound')),
  status text not null check (status in ('sent','failed','received','pending_approval','discarded')),
  kind text not null default 'sequence' check (kind in ('sequence','auto_reply','approved_reply','manual','test','inbound')),
  step integer,
  gmail_id text,
  thread_id text,
  rfc_message_id text,
  in_reply_to text,
  from_email citext,
  to_email citext,
  subject text,
  body_text text,
  classification text,
  ai_summary text,
  auto_action text,
  needs_attention boolean not null default false,
  error text,
  approved_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz
);
create unique index if not exists email_messages_gmail_uq on public.email_messages(mailbox_id, gmail_id) where gmail_id is not null;
create index if not exists email_messages_lead_idx on public.email_messages(lead_id, created_at desc);
create index if not exists email_messages_thread_idx on public.email_messages(thread_id);
create index if not exists email_messages_attention_idx on public.email_messages(needs_attention) where needs_attention;
create index if not exists email_messages_sent_idx on public.email_messages(mailbox_id, direction, status, sent_at desc);

-- ---------- Generic job locks (cron overlap protection)
create table if not exists public.job_locks (name text primary key, locked_until timestamptz not null);
create or replace function public.acquire_job_lock(p_name text, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare ok boolean;
begin
  insert into public.job_locks(name, locked_until) values (p_name, now() + make_interval(secs => p_seconds))
  on conflict (name) do update set locked_until = excluded.locked_until where public.job_locks.locked_until < now()
  returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function public.release_job_lock(p_name text) returns void language sql security definer set search_path = public, extensions as $$
  update public.job_locks set locked_until = now() - interval '1 second' where name = p_name $$;
revoke all on function public.acquire_job_lock(text, integer) from public, anon, authenticated;
revoke all on function public.release_job_lock(text) from public, anon, authenticated;

-- ---------- Stop automation when a lead moves on, or a contact becomes do-not-contact
create or replace function public.stop_enrollments_on_stage() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.stage is distinct from old.stage and new.stage in ('meeting_scheduled','proposal_shared','negotiation','won','lost','not_relevant') then
    update public.enrollments set status = 'stopped', stop_reason = 'Lead moved to ' || new.stage, next_run_at = null
     where lead_id = new.id and status in ('active','paused');
  end if;
  return null;
end $$;
drop trigger if exists trg_leads_stop_enrollments on public.leads;
create trigger trg_leads_stop_enrollments after update of stage on public.leads for each row execute function stop_enrollments_on_stage();

create or replace function public.stop_enrollments_on_dnc() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.do_not_contact and not coalesce(old.do_not_contact, false) then
    update public.enrollments set status = 'unsubscribed', stop_reason = 'Do-not-contact', next_run_at = null
     where contact_id = new.id and status in ('active','paused');
  end if;
  return null;
end $$;
drop trigger if exists trg_contacts_stop_enrollments on public.contacts;
create trigger trg_contacts_stop_enrollments after update of do_not_contact on public.contacts for each row execute function stop_enrollments_on_dnc();

-- ---------- RLS
alter table public.mailboxes enable row level security;
alter table public.mailbox_secrets enable row level security;
alter table public.oauth_states enable row level security;
alter table public.sequences enable row level security;
alter table public.enrollments enable row level security;
alter table public.email_messages enable row level security;
alter table public.job_locks enable row level security;
revoke all on public.mailbox_secrets, public.oauth_states, public.job_locks from anon, authenticated;

drop policy if exists mailboxes_read on public.mailboxes;
create policy mailboxes_read on public.mailboxes for select to authenticated using (is_member());
drop policy if exists mailboxes_update on public.mailboxes;
create policy mailboxes_update on public.mailboxes for update to authenticated using (is_admin() or user_id = auth.uid()) with check (is_admin() or user_id = auth.uid());
drop policy if exists mailboxes_delete on public.mailboxes;
create policy mailboxes_delete on public.mailboxes for delete to authenticated using (is_admin() or user_id = auth.uid());

drop policy if exists sequences_read on public.sequences;
create policy sequences_read on public.sequences for select to authenticated using (is_member());
drop policy if exists sequences_write on public.sequences;
create policy sequences_write on public.sequences for all to authenticated
  using (is_manager() or created_by = auth.uid() or exists (select 1 from public.campaigns c where c.id = campaign_id and (c.owner_id = auth.uid() or c.created_by = auth.uid())))
  with check (is_member());

drop policy if exists enrollments_read on public.enrollments;
create policy enrollments_read on public.enrollments for select to authenticated using (is_member());
drop policy if exists enrollments_update on public.enrollments;
create policy enrollments_update on public.enrollments for update to authenticated using (is_member()) with check (is_member());

drop policy if exists email_messages_read on public.email_messages;
create policy email_messages_read on public.email_messages for select to authenticated using (is_member());
drop policy if exists email_messages_update on public.email_messages;
create policy email_messages_update on public.email_messages for update to authenticated using (is_member()) with check (is_member());

-- ---------- Settings & integration card
insert into public.app_settings(key, value) values
 ('automation', '{"enabled": true, "company_name": "World of Trade", "physical_address": "", "booking_link": "", "send_window_start": "09:30", "send_window_end": "17:30", "weekdays_only": true, "default_timezone": "Asia/Kolkata", "auto_reply_meetings": true, "auto_reply_not_interested": true, "min_days_between_touches": 3, "max_sends_per_tick": 15}')
on conflict (key) do nothing;
insert into public.integrations(provider, display_name, category, description, status) values
 ('gmail_automation','Gmail (automated outreach)','email','Sends approved sequences from your Google Workspace / Gmail mailbox, reads replies and auto-handles routine ones.','not_configured')
on conflict (provider) do nothing;
update public.integrations set status = 'planned', description = 'Planned: use Gmail (automated outreach) above.' where provider = 'gmail' and status = 'planned';

-- Inbox counter for the sidebar badge
create or replace function public.inbox_attention_count() returns integer language sql stable security invoker set search_path = public, extensions as $$
  select count(*)::int from public.email_messages where needs_attention $$;
grant execute on function public.inbox_attention_count() to authenticated;

notify pgrst, 'reload schema';
select 'automation tables ready' as result;
