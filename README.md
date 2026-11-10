# WORLD OF TRADE | LEAD INTELLIGENCE

An AI-powered B2B prospecting platform for **World of Trade** (https://worldoftrade.pro/), positioned for **Sales, Trade Marketing, Distribution & Channel Management professionals across industries**. It covers 16 sector groups and 100+ industries (FMCG, consumer durables, pharma & healthcare, automotive, building materials, agri-inputs, telecom & technology, industrial, chemicals, financial services, energy, retail, distribution, apparel & lifestyle, logistics, hospitality & services). It finds companies, identifies their L&D, HR, Sales, Distribution & Channel and Trade Marketing decision-makers, researches buying signals, scores each prospect out of 100 and manages outreach through to conversion.

It is built to favour lead quality over volume. Every external record keeps its source. Inferred emails are always labelled as inferred. The app never generates companies, people or contact details to make itself look populated.

---

## Architecture

```
React + TypeScript + Tailwind (Vite)          Supabase
┌──────────────────────────────┐   RLS   ┌──────────────────────────────────────┐
│ Overview · Discover · People │◀───────▶│ Postgres (17 core tables + views/RPC)│
│ Research · Leads (table/     │         │ Auth (email/password, roles)         │
│ kanban) · Campaigns ·        │  JWT    │ Edge Functions (Deno, server-side):  │
│ Outreach · Follow-ups ·      │────────▶│  campaign-runner   discover-companies│
│ Analytics · Integrations ·   │         │  find-contacts     research-company  │
│ Settings/Admin · XLSX/CSV    │         │  generate-outreach score-leads       │
└──────────────────────────────┘         │  integrations                        │
                                         └───────────────┬──────────────────────┘
                                                         │ API keys stay server-side
             ┌────────────┬────────────┬─────────────────┼──────────────┬───────────────┐
           Claude API   Apollo.io    Hunter.io   People Data Labs   Google CSE   Company website
         (research, web  (companies,  (emails,     (companies,       (news,       (homepage text,
          search, drafts) people)      verify)      people)           signals)     robots.txt-aware)
```

**Provider layer** (`supabase/functions/_shared/providers/*`): each provider maps its API into neutral `CompanyCandidate` / `ContactCandidate` shapes, so you can add or replace providers without touching the pipeline. HTTP calls go through `providerFetch`, which adds timeouts, retries with backoff on 429/5xx, per-provider throttling and response caching.

**Pipeline** (`_shared/pipeline.ts`): discovery → dedupe by domain and normalised name (trigram) → parent/subsidiary linking → contact search across providers → merge → title classification → optional verification and pattern inference → signals → leads → scoring.

**Grounding rules for AI.** Claude's web-search results are collected from the API response. Any company, person, signal or citation whose `source_url` is not among the pages actually retrieved is **dropped before saving**. Reports present business challenges as hypotheses. Outreach drafts may only use stored facts.

**Email truthfulness.** `email_status` takes one of these values: `verified` (a verifier said valid), `provider_returned`, `inferred_pattern`, `unverified`, `invalid` or `unavailable`. A database check constraint prevents a pattern-inferred email from ever being stored as `verified`.

---

## Setup

### 1. Prerequisites
- Node 18+ and npm
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A Supabase project (free tier is fine to start)

### 2. Install and configure
```bash
npm install
cp .env.example .env          # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
supabase link --project-ref <your-project-ref>
supabase db push              # applies supabase/migrations/*
```

### 3. Deploy Edge Functions
```bash
supabase functions deploy campaign-runner discover-companies find-contacts research-company generate-outreach score-leads integrations
```

### 4. Provider keys (server-side only)
You can store keys in either of two places:
- **Integrations page** (admins): keys are saved to `integration_secrets`. That table has RLS enabled, no policies, and its grants are revoked from `anon` and `authenticated`, so only Edge Functions using the service role can read it.
- **Supabase secrets**, which take precedence over saved keys:
```bash
supabase secrets set GEMINI_API_KEY=... ANTHROPIC_API_KEY=... APOLLO_API_KEY=... HUNTER_API_KEY=... PDL_API_KEY=... GOOGLE_CSE_KEY=... GOOGLE_CSE_CX=...
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5-5   # optional override
```
Only **one AI provider** is needed to get started: **Gemini** (free tier at https://aistudio.google.com/apikey, secret `GEMINI_API_KEY`) or **Claude** (`ANTHROPIC_API_KEY`). It covers web-search discovery, contact research from public pages, reports, signals and outreach. With both connected, *Auto* mode falls back to the other if one fails (e.g. no credit). Gemini uses Grounding with Google Search; if that errors, enable billing on the Google Cloud project (the monthly free search allowance still applies). Apollo, Hunter and PDL add structured company and contact data plus verified emails.

### 5. Run
```bash
npm run dev        # http://localhost:5173
```
The first account to sign up becomes **Super Admin**. Later sign-ups start as **Sales Executive**, and an admin can change their role under Settings → Users & roles.

### 6. Optional: run campaigns server-side (no browser needed)
Campaigns normally advance while the campaign page is open. To process them in the background, set a secret and schedule the runner with `pg_cron` + `pg_net` (enable both extensions in the dashboard):
```bash
supabase secrets set CRON_SECRET=$(openssl rand -hex 24)
```
```sql
select cron.schedule('wot-campaign-runner', '* * * * *', $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/campaign-runner',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>','Authorization','Bearer <anon-key>'),
    body    := '{}'::jsonb)
$$);
```

### 7. Demo environment (optional)
```bash
psql "$DATABASE_URL" -f supabase/seed_demo.sql
```
This seed creates clearly fictional `[DEMO]` records on `.example` domains with `is_demo = true`. They only appear when **Demo mode** is switched on in the top bar. Real and demo data are never shown together, and exports are filtered the same way.

### 8. Deploy the frontend

**GitHub Pages (included):** `.github/workflows/deploy.yml` builds the app and publishes it on every push to `main`.
1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions** (not "Deploy from a branch" — serving the raw source gives a blank page).
2. Repo → **Settings → Secrets and variables → Actions → New repository secret**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Push (or Actions → *Deploy to GitHub Pages* → Run workflow). The site appears at `https://<owner>.github.io/<repo>/`.
4. Supabase → Authentication → URL Configuration: add `https://<owner>.github.io/<repo>/` as Site URL / redirect URL.

The app uses hash routes (`/#/leads`), so refreshing any page works on static hosting.

**Other hosts:**
`npm run build` produces static files in `dist/`. You can host them on Vercel, Netlify, Cloudflare Pages or Supabase hosting. Set the two `VITE_` variables in the host, and add the production URL to Supabase Auth → URL configuration. Optionally set `ALLOWED_ORIGIN` as a function secret to lock down CORS.

---

## Testing

```bash
npm test          # 24 unit tests: title classification, scoring, email inference, AI grounding/JSON parsing
npm run typecheck # frontend + shared TS
npm run build
deno check supabase/functions/*/index.ts   # Edge Function types
```
The migrations were also checked against PostgreSQL 17 with a Supabase auth stub. Those checks covered RLS, role-escalation guards, the secrets lockdown, duplicate constraints, the rule that a lost lead needs a reason, follow-up and last-contact sync, suppression propagation, contact erasure and company merging.

---

## Feature map → spec

| Spec section | Where |
|---|---|
| 3–5 Sector groups & industries (20+ sectors), designations incl. Distribution & Channel, countries (all configurable) | `migrations/..._reference_data.sql`, Settings → Industries / Countries / Designations |
| 6 Company discovery, dedupe, parent/subsidiary | Discover page, `discover-companies`, `pipeline.upsertCompany`, Settings → Duplicates |
| 7 Decision-maker finder, confidence, email status | Find Decision Makers, Company → Find decision-makers, `find-contacts` |
| 8 Scoring (weights configurable, explained) | `_shared/scoring.ts`, Lead page score breakdown, Settings → Lead scoring |
| 9 Buying signals as hypotheses with sources | Company → Detect buying signals, `pipeline.detectSignals` |
| 10 AI Company Intelligence Report (11 sections) | Company page / AI Research, `research-company` |
| 11 Personalised outreach (6 formats, edit/approve/copy) | Outreach, `generate-outreach` |
| 12 CRM: 14 stages, assign, notes, comms log, follow-ups, deal value, lost reasons, bulk, table + kanban | Lead Database, Lead page, Follow-ups |
| 13 Dashboard & analytics | Overview, Analytics (`dashboard_stats` RPC) |
| 14 Campaign workspace: pause/resume/cancel, real status | Campaigns, `campaign-runner`, `campaign_events` log |
| 15 Modular providers, live status, manual fallback | `_shared/providers/*`, Integrations page, manual add forms |
| 16 Email/CRM (v1: copy, mail-app hand-off, manual logging; approval required) | Outreach “Approve” → “Mark as sent”; Gmail/Outlook/HubSpot/Zoho/Salesforce listed as planned |
| 17 Excel/CSV exports with sources, verification, scores, dates | Export button (Leads, Analytics, Campaign) |
| 18 Admin: users/roles, settings, audit logs, usage | Settings |
| 21 Privacy: suppression, DNC, erase/correct, lawful basis, duplicate-outreach guard | Settings → Privacy, `erase_contact()`, Log activity warning |

### Acceptance walkthrough
1. Sign in.
2. Go to Campaigns, then New campaign. Use “FMCG Decision Makers – India”, 500+ employees, L&D/HR/Sales/Trade Marketing, Director+. Click **Start AI Lead Discovery**.
3. Watch companies being linked and enriched in the live log.
4. Open a company profile.
5. Review its decision-makers, each with its provider, source link and email status.
6. Click **Generate AI Company Intelligence Report**.
7. Open a lead to see the score breakdown.
8. Click **Generate Personalised Outreach**, then edit and approve the drafts.
9. Assign the lead, schedule a follow-up and log activity as it moves through the stages.
10. Use **Export → Qualified leads → Excel**.

---

## Provider notes and limitations (please read)
- **Apollo:** people search returns names and titles without emails. Revealing emails uses `people/match` and consumes credits, so it only runs when “Enrich & verify emails” is enabled. Access to API search endpoints depends on your Apollo plan. The client tries `mixed_people/api_search` first and falls back to `mixed_people/search`.
- **People Data Labs:** work emails appear only if your plan includes them. Industry filters use PDL's canonical industry values (see `pdl.ts`).
- **Google Programmable Search:** needs an API key and an engine ID (`cx`). Check Google's current availability terms for whole-web search engines. If it's unavailable, Claude web search covers signals instead.
- **LinkedIn:** never scraped. A LinkedIn URL is stored only when a provider returned it or it appeared verbatim in authorised search results.
- **Sending email:** version 1 does not send email. Messages need human approval, then the user sends them from their own mail client and marks them as sent. The communications table is already in place for a future Gmail/Outlook integration.
- **Legal:** review GDPR, India's DPDP Act, UAE/KSA PDPL and each provider's terms with counsel before running outreach in a market.

## Project layout
```
src/
  pages/           Overview, Discover, CompanyProfile, DecisionMakers, Research, Leads, LeadDetail,
                   Campaigns, CampaignDetail, Outreach, FollowUps, Analytics, Integrations, Settings, Login
  components/      ui kit, Layout, Charts, CompanyForm, ContactForm, ReportView, Notes, ExportModal
  lib/             supabase client, auth/roles, hooks, constants, export (xlsx/csv)
supabase/
  migrations/      schema, RLS, reference data, RPC functions
  functions/       7 Edge Functions + _shared (providers, pipeline, scoring, titles, http, secrets)
  seed_demo.sql    fictional demo data (opt-in)
tests/             vitest unit tests
```
