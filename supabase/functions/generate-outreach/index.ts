// Personalised outreach generator — six drafts per contact, grounded in stored research.
// Drafts are saved with status "draft"; nothing is ever sent automatically.
import { getContext, handler, json, HttpError, logUsage, getSetting } from '../_shared/context.ts';
import { aiMessage, aiAvailable } from '../_shared/ai.ts';
import { extractJson, WOT_CONTEXT } from '../_shared/providers/claude.ts';

const CHANNELS = ['intro_email', 'linkedin_connect', 'linkedin_followup', 'whatsapp', 'followup_email', 'meeting_request'] as const;

Deno.serve(handler(async (req, body) => {
  const ctx = await getContext(req);
  const { contact_id, lead_id, sender_name, sender_title, extra_context } = body;
  const { data: contact } = await ctx.userClient.from('contacts').select('*, company:companies(*)').eq('id', contact_id).single();
  if (!contact) throw new HttpError(404, 'Contact not found');
  if (contact.do_not_contact) throw new HttpError(409, 'This contact is on the do-not-contact / suppression list.');
  const company: any = contact.company;
  if (!(await aiAvailable(ctx.admin))) throw new HttpError(412, 'No AI provider is connected. Add a Gemini or Claude key on the Integrations page.');
  const defaults = await getSetting<Record<string, string>>(ctx.admin, 'outreach_defaults', {});

  const [{ data: report }, { data: signals }, { data: brands }, { data: prior }] = await Promise.all([
    ctx.admin.from('research_reports').select('report').eq('company_id', company.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ctx.admin.from('buying_signals').select('signal_type, description, published_at, source_url, training_opportunity').eq('company_id', company.id).limit(6),
    ctx.admin.from('company_brands').select('brand_name').eq('company_id', company.id).limit(10),
    ctx.admin.from('communications').select('channel, occurred_at, subject').eq('contact_id', contact_id).order('occurred_at', { ascending: false }).limit(5),
  ]);

  const facts = {
    company: { name: company.name, industry: company.industry, segment: company.industry_segment, country: company.country_code, hq_city: company.hq_city, employees: company.employee_count, description: company.description },
    brands: (brands ?? []).map(b => b.brand_name),
    signals: signals ?? [],
    research_summary: report?.report ? { overview: report.report.overview?.text, use_cases: report.report.training_use_cases?.items, opening: report.report.opening_conversation } : null,
    contact: { name: contact.full_name, first_name: contact.first_name, title: contact.title, department: contact.department, seniority: contact.seniority },
    previous_touchpoints: prior ?? [],
  };
  const sys = `You write B2B outreach for World of Trade. Personalise using ONLY the FACTS JSON. Do not state or imply anything about the recipient's company that is not in FACTS.
Do not invent results, clients, statistics, testimonials or awards for World of Trade. Avoid generic lines like "we provide excellent training services". Be concise, specific and human. No emojis.
Signals are hypotheses — reference them as "I noticed..." not as a diagnosis of problems.`;
  const user = `${WOT_CONTEXT}
Position World of Trade as: an experiential business simulation; a three-day commercial decision-making experience; a way to build commercial acumen, cross-functional collaboration, negotiation and P&L understanding; a capability programme for Sales, Trade Marketing, Distribution & Channel Management professionals. Relate it to how THIS company goes to market in its own sector (${company.industry ?? company.industry_segment ?? 'its industry'}) — e.g. distributors, dealers, retailers, agents or partners — without inventing facts. Tailor the angle to the recipient's function (${contact.department}).
Sender: ${sender_name ?? '[Your name]'}, ${sender_title ?? '[Your title]'}, ${defaults.sender_company ?? 'World of Trade'} (${defaults.website ?? 'https://worldoftrade.pro/'}).
${extra_context ? `Additional context from the sales rep: ${extra_context}` : ''}
FACTS: ${JSON.stringify(facts)}

Return ONLY JSON: {"messages":[
 {"channel":"intro_email","subject":"","body":"120-180 words"},
 {"channel":"linkedin_connect","body":"max 280 characters"},
 {"channel":"linkedin_followup","body":"60-100 words"},
 {"channel":"whatsapp","body":"max 60 words, business tone"},
 {"channel":"followup_email","subject":"","body":"70-120 words"},
 {"channel":"meeting_request","subject":"","body":"60-100 words, propose a 20-minute call"}],
 "personalisation_points":["which FACTS were used"]}`;

  const res = await aiMessage(ctx.admin, sys, user, { maxTokens: 4000 });
  await logUsage(ctx, res.provider, 'outreach_generation', (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0), true, { contact: contact_id });
  const out = extractJson<{ messages: any[]; personalisation_points?: string[] }>(res.text);
  const rows = (out.messages ?? []).filter(m => CHANNELS.includes(m.channel) && m.body).map(m => ({
    lead_id: lead_id ?? null, contact_id, channel: m.channel, subject: m.subject ?? null,
    body: m.channel === 'linkedin_connect' ? String(m.body).slice(0, 300) : m.body,
    status: 'draft', ai_model: `${res.provider === 'gemini' ? 'Gemini' : 'Claude'} · ${res.model}`, grounding: out.personalisation_points ?? [], created_by: ctx.user.id,
  }));
  if (!rows.length) throw new HttpError(502, 'The AI did not return usable drafts — please retry.');
  const { data, error } = await ctx.userClient.from('outreach_messages').insert(rows).select('*');
  if (error) throw error;
  if (lead_id) await ctx.admin.from('leads').update({ stage: 'outreach_pending' }).eq('id', lead_id).in('stage', ['newly_discovered', 'research_pending', 'qualified', 'contact_identified']);
  return json({ messages: data, personalisation_points: out.personalisation_points ?? [] });
}));
