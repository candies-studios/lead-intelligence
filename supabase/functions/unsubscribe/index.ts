// Public unsubscribe endpoint linked from every automated email (and List-Unsubscribe one-click POST).
// Deploy with "Verify JWT" OFF. Tokens are HMAC-signed, so links cannot be forged or enumerated.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyUnsubscribe } from '../_shared/mail.ts';
import { unsubSecret } from '../_shared/unsub.ts';

const page = (title: string, msg: string, status = 200) => new Response(
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <style>body{font-family:system-ui,Arial,sans-serif;background:#f7f8fb;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}
  .c{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:32px 36px;max-width:440px;box-shadow:0 4px 16px rgba(15,23,42,.06)}
  h1{font-size:20px;margin:0 0 8px}p{color:#475569;line-height:1.5;margin:0}</style></head>
  <body><div class="c"><h1>${title}</h1><p>${msg}</p></div></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const parsed = await verifyUnsubscribe(unsubSecret(), token);
  if (!parsed) return page('Link not valid', 'This unsubscribe link is invalid. Reply to the email with "unsubscribe" and we will remove you.', 400);

  if (req.method === 'GET' && url.searchParams.get('confirm') !== '1') {
    // Show a confirm button so link scanners (which only GET) don't unsubscribe people by accident.
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title>
    <style>body{font-family:system-ui,Arial,sans-serif;background:#f7f8fb;display:grid;place-items:center;min-height:100vh;margin:0}.c{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:32px 36px;max-width:440px}
    button{background:#1f2f58;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}p{color:#475569}</style></head>
    <body><div class="c"><h2>Unsubscribe</h2><p>Stop receiving emails from World of Trade?</p>
    <form method="post" action="?t=${encodeURIComponent(token)}&confirm=1"><button type="submit">Yes, unsubscribe me</button></form></div></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: contact } = await db.from('contacts').select('id, email, company_id').eq('id', parsed.contactId).maybeSingle();
  if (contact?.email) {
    await db.from('suppression_list').upsert({ email: contact.email, reason: 'unsubscribed', notes: 'Unsubscribed via email link' }, { onConflict: 'email', ignoreDuplicates: true });
    await db.from('contacts').update({ do_not_contact: true, consent_status: 'unsubscribed' }).eq('id', contact.id);
  }
  if (contact) {
    await db.from('enrollments').update({ status: 'unsubscribed', stop_reason: 'Unsubscribe link', next_run_at: null }).eq('contact_id', contact.id).in('status', ['active', 'paused']);
    const { data: leads } = await db.from('leads').select('id, stage').eq('primary_contact_id', contact.id);
    for (const l of leads ?? []) {
      await db.from('communications').insert({ lead_id: l.id, contact_id: contact.id, channel: 'email', direction: 'inbound', subject: 'Unsubscribed', summary: 'Contact used the unsubscribe link. Added to suppression list.' });
      if (!['won', 'lost', 'not_relevant'].includes(l.stage)) await db.from('leads').update({ stage: 'not_relevant' }).eq('id', l.id);
    }
    await db.from('audit_logs').insert({ action: 'unsubscribe', entity: 'contacts', entity_id: contact.id, meta: { via: req.method === 'POST' && !url.searchParams.get('confirm') ? 'one-click' : 'link' } });
  }
  if (req.method === 'POST' && url.searchParams.get('confirm') !== '1') return new Response(null, { status: 200 }); // RFC 8058 one-click
  return page('You have been unsubscribed', 'You will not receive further emails from us. Sorry for the interruption.');
});
