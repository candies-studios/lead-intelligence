// Pure email/automation helpers (no Deno/Node-specific APIs) — unit-tested with Vitest.

// ---------------------------------------------------------------- encoding
export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
export const toBase64Url = (s: string) => utf8ToBase64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const wrap76 = (s: string) => s.replace(/.{1,76}/g, m => m + '\r\n').trimEnd();

/** RFC 2047 encoded-word for non-ASCII header values. */
export function encodeHeader(v: string): string {
  // deno-lint-ignore no-control-regex
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${utf8ToBase64(v)}?=`;
}
const sanitizeHeader = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

export function extractEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.match(/<([^>]+)>/) ?? v.match(/([A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return m ? m[1].trim().toLowerCase() : null;
}

// ---------------------------------------------------------------- text/html
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function textToHtml(text: string): string {
  const paras = text.trim().split(/\n{2,}/).map(p =>
    `<p style="margin:0 0 12px 0">${escapeHtml(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${paras.join('')}</div>`;
}
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Remove quoted history from a reply so classification looks only at the new text. */
export function stripQuoted(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*On .{3,200}(wrote|écrit|schrieb):\s*$/i.test(l)) break;
    if (/^\s*On .{3,200}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? '')) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l)) break;
    if (/^\s*From:\s.+/i.test(l) && /^\s*(Sent|Date):\s.+/i.test(lines[i + 1] ?? '')) break;
    if (/^_{8,}\s*$/.test(l)) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

// ---------------------------------------------------------------- MIME
export interface MimeInput {
  from: { name?: string | null; email: string };
  to: string;
  subject: string;
  text: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string | null;
  references?: string | null;
  listUnsubscribeUrl?: string | null;
  listUnsubscribeMailto?: string | null;
  date?: Date;
}
export function buildMime(m: MimeInput): string {
  const boundary = `wot_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const from = m.from.name ? `${encodeHeader(sanitizeHeader(m.from.name))} <${m.from.email}>` : m.from.email;
  const h: string[] = [
    `From: ${from}`,
    `To: ${sanitizeHeader(m.to)}`,
    `Subject: ${encodeHeader(sanitizeHeader(m.subject))}`,
    `Date: ${(m.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
  ];
  if (m.messageId) h.push(`Message-ID: ${m.messageId}`);
  if (m.inReplyTo) h.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references || m.inReplyTo) h.push(`References: ${sanitizeHeader(m.references ?? m.inReplyTo!)}`);
  const unsub = [m.listUnsubscribeUrl && `<${m.listUnsubscribeUrl}>`, m.listUnsubscribeMailto && `<${m.listUnsubscribeMailto}>`].filter(Boolean);
  if (unsub.length) h.push(`List-Unsubscribe: ${unsub.join(', ')}`);
  if (m.listUnsubscribeUrl) h.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  h.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const html = m.html ?? textToHtml(m.text);
  return [
    ...h, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToBase64(m.text)),
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToBase64(html)),
    `--${boundary}--`, '',
  ].join('\r\n');
}

// ---------------------------------------------------------------- templates
export const TEMPLATE_VARS = ['first_name', 'last_name', 'full_name', 'title', 'company', 'industry', 'country', 'personal_line', 'sender_name', 'sender_title', 'booking_link'] as const;
export type TemplateVars = Partial<Record<typeof TEMPLATE_VARS[number], string | null | undefined>>;

/** Fill {{placeholders}}; unknown or empty ones collapse cleanly. Returns leftover problems for validation. */
export function renderTemplate(tpl: string, vars: TemplateVars): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  let text = tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => {
    const key = k.toLowerCase();
    if (!(TEMPLATE_VARS as readonly string[]).includes(key)) { unknown.push(key); return ''; }
    const v = (vars as Record<string, string | null | undefined>)[key];
    return v && v.trim() ? v.replace(/^[ \t]+|[ \t]+$/g, '') : ''; // keep intentional line breaks (e.g. booking link paragraph)
  });
  text = text
    .split('\n').map(l => l.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?;:])/g, '$1').replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  return { text, unknown };
}

export function firstNameOf(full?: string | null, first?: string | null): string {
  const f = (first ?? full ?? '').trim().split(/\s+/)[0] ?? '';
  return /^[A-Za-zÀ-ÿ'’-]{2,}$/.test(f) ? f : '';
}

export function buildFooter(o: { senderName?: string | null; senderTitle?: string | null; company: string; signature?: string | null; physicalAddress?: string | null; unsubscribeUrl: string; body?: string }): string {
  // Don't repeat the sender's name if the message already signs off with it
  const tail = (o.body ?? '').trim().split('\n').slice(-3).join(' ').toLowerCase();
  const name = o.senderName && tail.includes(o.senderName.toLowerCase()) ? null : o.senderName;
  const sig = o.signature?.trim() || [name, o.senderTitle, o.company].filter(Boolean).join('\n');
  const legal = [o.company, o.physicalAddress?.trim()].filter(Boolean).join(' · ');
  return `\n\n${sig}\n\n—\n${legal}\nIf you'd prefer not to hear from me again, unsubscribe here: ${o.unsubscribeUrl}`;
}

// ---------------------------------------------------------------- time zones & send windows
export const COUNTRY_TZ: Record<string, string> = {
  IN: 'Asia/Kolkata', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur', ID: 'Asia/Jakarta', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila',
  GB: 'Europe/London', DE: 'Europe/Berlin', FR: 'Europe/Paris', NL: 'Europe/Amsterdam', CH: 'Europe/Zurich',
  ZA: 'Africa/Johannesburg', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland', US: 'America/New_York',
  BH: 'Asia/Bahrain', OM: 'Asia/Muscat', EG: 'Africa/Cairo', KE: 'Africa/Nairobi', NG: 'Africa/Lagos', BD: 'Asia/Dhaka',
  LK: 'Asia/Colombo', PK: 'Asia/Karachi', CN: 'Asia/Shanghai', JP: 'Asia/Tokyo', HK: 'Asia/Hong_Kong', CA: 'America/Toronto',
  IE: 'Europe/Dublin', ES: 'Europe/Madrid', IT: 'Europe/Rome', SE: 'Europe/Stockholm', PL: 'Europe/Warsaw', TR: 'Europe/Istanbul',
};
// Gulf weekend is Fri–Sat; most others Sat–Sun.
const FRI_SAT_WEEKEND = new Set(['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'EG']);

interface LocalParts { y: number; m: number; d: number; h: number; mi: number; wd: number }
export function localParts(date: Date, tz: string): LocalParts {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd };
}
/** UTC instant for a wall-clock time in a time zone (handles DST by iterating). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), tz);
    const asIf = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    const diff = Date.UTC(y, m - 1, d, h, mi) - asIf;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return { h: h || 0, m: m || 0 }; };

export interface SendWindow { start: string; end: string; weekdaysOnly: boolean; country?: string | null }
export function isWorkday(wd: number, country?: string | null) {
  return FRI_SAT_WEEKEND.has(country ?? '') ? wd !== 5 && wd !== 6 : wd !== 0 && wd !== 6;
}
/** Earliest time ≥ `from` that falls inside the recipient's local sending window. */
export function nextSendTime(from: Date, tz: string, w: SendWindow): Date {
  const s = hm(w.start), e = hm(w.end);
  for (let add = 0; add < 10; add++) {
    const day = new Date(from.getTime() + add * 864e5);
    const p = localParts(day, tz);
    if (w.weekdaysOnly && !isWorkday(p.wd, w.country)) continue;
    const start = zonedToUtc(p.y, p.m, p.d, s.h, s.m, tz);
    const end = zonedToUtc(p.y, p.m, p.d, e.h, e.m, tz);
    if (add === 0) {
      if (from < start) return start;
      if (from < end) return from;
      continue;
    }
    return start;
  }
  return from;
}
/** Spread sends: add a small random offset (minutes) so emails don't all go out on the same minute. */
export const jitter = (d: Date, maxMinutes = 20, rand = Math.random) => new Date(d.getTime() + Math.floor(rand() * maxMinutes) * 60000);

// ---------------------------------------------------------------- warm-up
export function warmupLimit(mb: { daily_limit: number; warmup_start: string; warmup_start_volume: number; warmup_increment: number }, now = new Date()): number {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(mb.warmup_start + 'T00:00:00Z').getTime()) / 864e5));
  return Math.max(1, Math.min(mb.daily_limit, mb.warmup_start_volume + mb.warmup_increment * days));
}

// ---------------------------------------------------------------- reply classification (rules first)
export type ReplyCategory = 'bounce' | 'out_of_office' | 'unsubscribe' | 'not_interested' | 'meeting_request' | 'interested' | 'question' | 'referral' | 'other' | 'needs_review';

export interface InboundEmail { from: string; subject: string; body: string; headers: Record<string, string> }

export function classifyByRules(m: InboundEmail, now = new Date()): { category: ReplyCategory; returnDate?: string | null } | null {
  const from = (m.from || '').toLowerCase();
  const subj = (m.subject || '').toLowerCase();
  const hdr = Object.fromEntries(Object.entries(m.headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  const fresh = stripQuoted(m.body || '').toLowerCase();
  if (/mailer-daemon|postmaster@/.test(from) || /delivery status notification|undeliverable|undelivered mail|mail delivery (failed|subsystem)|returned mail|delivery failure/.test(subj) || hdr['x-failed-recipients']) {
    return { category: 'bounce' };
  }
  const auto = (hdr['auto-submitted'] && hdr['auto-submitted'] !== 'no') || hdr['x-autoreply'] || hdr['x-autorespond'] || /auto_reply|auto-reply/.test(hdr['precedence'] ?? '');
  if (auto || /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ooo\b|away from (the )?office|on (annual |sick |maternity |paternity )?leave)/.test(subj)
      || /\b(i am|i'm) (currently )?(out of (the )?office|on (annual |sick )?leave|away (from|until))/.test(fresh)) {
    return { category: 'out_of_office', returnDate: extractReturnDate(fresh + ' ' + subj, now) };
  }
  if (/\b(unsubscribe|remove me|take me off|stop (e-?mailing|contacting|sending)|do not (contact|email)|don't (contact|email) me|opt[- ]?out)\b/.test(fresh.slice(0, 600))) {
    return { category: 'unsubscribe' };
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Best-effort "back on …" date (YYYY-MM-DD) from an out-of-office message. */
export function extractReturnDate(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();
  const pick = (y: number, mo: number, d: number) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    let year = y;
    if (!y) { year = now.getUTCFullYear(); if (Date.UTC(year, mo, d) < now.getTime() - 864e5) year++; }
    return `${year}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let m = t.match(/(20\d\d)-(\d\d)-(\d\d)/);
  if (m) return pick(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(20\d\d)?/);
  if (m) return pick(m[3] ? +m[3] : 0, MONTHS.indexOf(m[2]), +m[1]);
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d\d)?/);
  if (m) return pick(m[3] ? +m[3] : 0, MONTHS.indexOf(m[1]), +m[2]);
  m = t.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/); // dd/mm/yyyy (most target markets)
  if (m) return pick(+m[3], +m[2] - 1, +m[1]);
  return null;
}

export function failedRecipient(m: InboundEmail): string | null {
  const h = Object.fromEntries(Object.entries(m.headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (h['x-failed-recipients']) return extractEmail(String(h['x-failed-recipients']));
  const mm = m.body.match(/(?:to|recipient|address)[^\n@]{0,60}?([A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return mm ? mm[1].toLowerCase() : null;
}

// ---------------------------------------------------------------- unsubscribe tokens (HMAC-SHA256)
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}
export async function signUnsubscribe(secret: string, contactId: string, enrollmentId?: string | null): Promise<string> {
  const payload = `${contactId}.${enrollmentId ?? '-'}`;
  return `${payload}.${await hmac(secret, 'unsub:' + payload)}`;
}
export async function verifyUnsubscribe(secret: string, token: string): Promise<{ contactId: string; enrollmentId: string | null } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [c, e, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(c)) return null;
  const expect = await hmac(secret, `unsub:${c}.${e}`);
  if (expect.length !== sig.length) return null;
  let diff = 0; for (let i = 0; i < sig.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { contactId: c, enrollmentId: e === '-' ? null : e } : null;
}

// ---------------------------------------------------------------- sequence steps
export interface SequenceStep { day: number; channel: 'email' | 'linkedin_task' | 'whatsapp_task'; subject?: string; body: string }
export function validateSteps(steps: SequenceStep[]): string[] {
  const errs: string[] = [];
  if (!steps.length) errs.push('Add at least one step');
  if (steps[0] && steps[0].channel !== 'email') errs.push('The first step must be an email');
  if (steps[0] && !steps[0].subject?.trim()) errs.push('The first email needs a subject');
  steps.forEach((s, i) => {
    if (!s.body?.trim()) errs.push(`Step ${i + 1} has no message`);
    if (i > 0 && s.day <= steps[i - 1].day) errs.push(`Step ${i + 1} must be on a later day than step ${i}`);
    const bad = [...(s.body + ' ' + (s.subject ?? '')).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(m => m[1].toLowerCase()).filter(k => !(TEMPLATE_VARS as readonly string[]).includes(k));
    if (bad.length) errs.push(`Step ${i + 1} uses unknown placeholder(s): ${[...new Set(bad)].join(', ')}`);
    if (/unsubscribe/i.test(s.body)) errs.push(`Step ${i + 1}: remove manual unsubscribe text — a compliant unsubscribe footer is added automatically`);
  });
  return errs;
}

export const DEFAULT_SEQUENCE: SequenceStep[] = [
  { day: 0, channel: 'email', subject: '{{company}} — a 3-day commercial simulation for your sales & channel teams',
    body: `Hi {{first_name}},

{{personal_line}}

I lead corporate programmes at World of Trade. We run a three-day business simulation where teams of 4–6 each run a company with a $1M virtual budget — manufacturing, distribution, pricing, trade terms and P&L — and compete against each other in a live market.

Sales, trade marketing and distribution leaders use it to build commercial acumen and channel economics in a way classroom training rarely does.

Would a 20-minute conversation be worthwhile to see whether it fits the capability plans at {{company}} for next year?{{booking_link}}

Best regards,
{{sender_name}}` },
  { day: 4, channel: 'email', body: `Hi {{first_name}},

Following up briefly on my note below. Teams usually tell us the most valuable part is seeing how pricing, distributor margins and inventory decisions hit the P&L of their own simulated company within hours.

If it's useful, I can share how a similar programme was structured for a {{industry}} business — would that help?

{{sender_name}}` },
  { day: 6, channel: 'linkedin_task', body: `Hi {{first_name}}, I sent you a note about World of Trade's 3-day commercial simulation for sales & channel teams — would be glad to connect.` },
  { day: 11, channel: 'email', body: `Hi {{first_name}},

I don't want to crowd your inbox, so this will be my last note for now. If building commercial and channel capability is on your agenda for the coming year, I'd be happy to walk you through the simulation in 20 minutes.{{booking_link}}

And if someone else at {{company}} owns this, I'd be grateful for a pointer.

{{sender_name}}` },
];
