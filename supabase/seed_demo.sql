-- =====================================================================
-- DEMO ENVIRONMENT ONLY — FICTIONAL RECORDS
-- Every row here has is_demo = true and uses fictional names and the
-- reserved ".example" domain. The app hides demo data unless the user
-- switches on "Demo mode" in the top bar. Do NOT run against production
-- unless you want demo records available for training.
--   psql "$DATABASE_URL" -f supabase/seed_demo.sql
-- =====================================================================
with c as (
  insert into public.companies(name, domain, website, industry, industry_segment, country_code, hq_city,
      employee_count, employee_range, classification, ownership, description, data_provider, is_demo, last_verified_at)
  values
   ('[DEMO] Saffron Valley Foods', 'saffronvalley.example', 'https://saffronvalley.example', 'Packaged Food', 'FMCG', 'IN', 'Mumbai',
     4200, '1001-5000', 'manufacturer', 'private', 'Fictional packaged snacks manufacturer used for product demos.', 'demo', true, now()),
   ('[DEMO] Northbay Appliances', 'northbay.example', 'https://northbay.example', 'Home Appliances', 'FMCD', 'AE', 'Dubai',
     1800, '1001-5000', 'mixed', 'private', 'Fictional appliance brand and distributor used for product demos.', 'demo', true, now())
  on conflict do nothing
  returning id, name
)
insert into public.contacts(company_id, full_name, title, department, seniority, designation_priority, email, email_status,
    email_provider, confidence, data_provider, is_demo)
select id, x.full_name, x.title, x.dept::department, x.sen::seniority, x.prio, x.email, x.status::email_status, 'demo', 'medium', 'demo', true
from c
join (values
  ('[DEMO] Saffron Valley Foods','Demo Person A','Head of Learning & Development','learning_development','head',1,'person.a@saffronvalley.example','inferred_pattern'),
  ('[DEMO] Saffron Valley Foods','Demo Person B','National Sales Head','sales','head',3,null,'unavailable'),
  ('[DEMO] Northbay Appliances','Demo Person C','HR Director','human_resources','director',2,'person.c@northbay.example','provider_returned')
) as x(company, full_name, title, dept, sen, prio, email, status) on x.company = c.name;

insert into public.leads(company_id, primary_contact_id, stage, source, is_demo)
select ct.company_id, ct.id, 'contact_identified', 'demo', true from public.contacts ct where ct.is_demo
on conflict do nothing;
