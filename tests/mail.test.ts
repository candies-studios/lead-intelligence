import { describe, expect, it } from 'vitest';
import {
  buildMime, encodeHeader, base64ToUtf8, renderTemplate, firstNameOf, buildFooter, nextSendTime, localParts, zonedToUtc,
  warmupLimit, classifyByRules, extractReturnDate, stripQuoted, failedRecipient, signUnsubscribe, verifyUnsubscribe,
  validateSteps, DEFAULT_SEQUENCE, extractEmail, htmlToText, toBase64Url,
} from '../supabase/functions/_shared/mail';

describe('MIME', () => {
  it('builds a threaded, unsubscribable multipart message with UTF-8 safely encoded', () => {
    const raw = buildMime({
      from: { name: 'Priyā Shah', email: 'priya@worldoftrade.pro' }, to: 'anil@acme.com', subject: 'Commercial simulation — next steps',
      text: 'Hello Anil,\n\nSee https://worldoftrade.pro', messageId: '<abc@wot>', inReplyTo: '<prev@wot>',
      listUnsubscribeUrl: 'https://x.supabase.co/functions/v1/unsubscribe?t=tok', listUnsubscribeMailto: 'mailto:priya@worldoftrade.pro?subject=unsubscribe',
    });
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?.+\?= <priya@worldoftrade.pro>\r\n/);
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('In-Reply-To: <prev@wot>\r\nReferences: <prev@wot>');
    expect(raw).toContain('List-Unsubscribe: <https://x.supabase.co/functions/v1/unsubscribe?t=tok>, <mailto:priya@worldoftrade.pro?subject=unsubscribe>');
    expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    const textPart = raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
    expect(base64ToUtf8(textPart.replace(/\r\n/g, ''))).toBe('Hello Anil,\n\nSee https://worldoftrade.pro');
    const htmlPart = raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[2].split('\r\n--')[0];
    expect(base64ToUtf8(htmlPart.replace(/\r\n/g, ''))).toContain('<a href="https://worldoftrade.pro">');
  });
  it('blocks header injection', () => {
    const raw = buildMime({ from: { email: 'a@b.com' }, to: 'x@y.com\r\nBcc: evil@z.com', subject: 'Hi\r\nBcc: evil@z.com', text: 't' });
    expect(raw).not.toMatch(/\r\nBcc:/);
  });
  it('encodes headers only when needed', () => {
    expect(encodeHeader('Plain ASCII')).toBe('Plain ASCII');
    expect(encodeHeader('Café')).toMatch(/^=\?UTF-8\?B\?/);
    expect(toBase64Url('??>>')).not.toMatch(/[+/=]/);
  });
  it('parses addresses and html', () => {
    expect(extractEmail('"Anil K" <Anil@Acme.com>')).toBe('anil@acme.com');
    expect(htmlToText('<p>Hi&nbsp;there</p><br><div>Thanks</div>')).toBe('Hi there\n\nThanks');
  });
});

describe('templates', () => {
  it('fills placeholders and collapses empty personal line', () => {
    const { text, unknown } = renderTemplate('Hi {{first_name}},\n\n{{personal_line}}\n\nAt {{company}} , teams…', { first_name: 'Anil', company: 'Acme', personal_line: '' });
    expect(text).toBe('Hi Anil,\n\nAt Acme, teams…');
    expect(unknown).toEqual([]);
  });
  it('keeps paragraph breaks inside values (booking link)', () => {
    const { text } = renderTemplate('Worth a call?{{booking_link}}\n\nBest,', { booking_link: '\n\nIf easier, pick a time here: https://cal/x' });
    expect(text).toBe('Worth a call?\n\nIf easier, pick a time here: https://cal/x\n\nBest,');
  });
  it('reports unknown placeholders', () => {
    expect(renderTemplate('Hi {{nickname}}', {}).unknown).toEqual(['nickname']);
  });
  it('first name sanity', () => {
    expect(firstNameOf('Anil Kumar')).toBe('Anil');
    expect(firstNameOf('Dr.')).toBe('');
    expect(firstNameOf(null, 'Maria')).toBe('Maria');
  });
  it('default sequence is valid and footer includes compliant unsubscribe + address', () => {
    expect(validateSteps(DEFAULT_SEQUENCE)).toEqual([]);
    const f = buildFooter({ senderName: 'Priya', company: 'World of Trade', physicalAddress: 'Mumbai, India', unsubscribeUrl: 'https://u' });
    expect(f).toContain('World of Trade · Mumbai, India');
    expect(f).toContain('unsubscribe here: https://u');
    const g = buildFooter({ senderName: 'Priya', company: 'World of Trade', unsubscribeUrl: 'https://u', body: 'Thanks,\nPriya' });
    expect(g.split('Priya').length).toBe(1); // name not repeated
  });
  it('validation catches common sequence mistakes', () => {
    const errs = validateSteps([{ day: 0, channel: 'linkedin_task', body: 'x' }, { day: 0, channel: 'email', body: 'Click to unsubscribe {{foo}}' }]);
    expect(errs.join('|')).toMatch(/first step must be an email/);
    expect(errs.join('|')).toMatch(/later day/);
    expect(errs.join('|')).toMatch(/unknown placeholder\(s\): foo/);
    expect(errs.join('|')).toMatch(/unsubscribe footer is added automatically/);
  });
});

describe('send windows & time zones', () => {
  it('converts wall-clock time to UTC across zones', () => {
    expect(zonedToUtc(2026, 11, 10, 9, 30, 'Asia/Kolkata').toISOString()).toBe('2026-11-10T04:00:00.000Z');
    expect(zonedToUtc(2026, 7, 1, 9, 0, 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z'); // BST
    expect(zonedToUtc(2026, 12, 1, 9, 0, 'Europe/London').toISOString()).toBe('2026-12-01T09:00:00.000Z'); // GMT
  });
  const w = { start: '09:30', end: '17:30', weekdaysOnly: true };
  it('sends now when inside the window', () => {
    const now = new Date('2026-11-10T06:00:00Z'); // Tue 11:30 IST
    expect(nextSendTime(now, 'Asia/Kolkata', w).toISOString()).toBe(now.toISOString());
  });
  it('waits for the morning when before the window', () => {
    expect(nextSendTime(new Date('2026-11-10T01:00:00Z'), 'Asia/Kolkata', w).toISOString()).toBe('2026-11-10T04:00:00.000Z');
  });
  it('skips the weekend (Sat–Sun) for India', () => {
    const fri = new Date('2026-11-13T13:00:00Z'); // Fri 18:30 IST (after window)
    const t = nextSendTime(fri, 'Asia/Kolkata', w);
    expect(localParts(t, 'Asia/Kolkata').wd).toBe(1); // Monday
  });
  it('uses the Fri–Sat weekend for the Gulf', () => {
    const thu = new Date('2026-11-12T15:00:00Z'); // Thu 19:00 Dubai
    const t = nextSendTime(thu, 'Asia/Dubai', { ...w, country: 'AE' });
    expect(localParts(t, 'Asia/Dubai').wd).toBe(0); // Sunday is a workday in the UAE
  });
});

describe('warm-up', () => {
  it('ramps daily volume up to the cap', () => {
    const mb = { daily_limit: 40, warmup_start: '2026-11-01', warmup_start_volume: 10, warmup_increment: 5 };
    expect(warmupLimit(mb, new Date('2026-11-01T10:00:00Z'))).toBe(10);
    expect(warmupLimit(mb, new Date('2026-11-03T10:00:00Z'))).toBe(20);
    expect(warmupLimit(mb, new Date('2026-12-01T10:00:00Z'))).toBe(40);
  });
});

describe('reply classification rules', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  it('detects bounces', () => {
    const r = classifyByRules({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)', body: "Your message wasn't delivered to anil@acme.com because the address couldn't be found", headers: {} });
    expect(r?.category).toBe('bounce');
    expect(failedRecipient({ from: '', subject: '', body: "wasn't delivered to anil@acme.com because", headers: {} })).toBe('anil@acme.com');
    expect(failedRecipient({ from: '', subject: '', body: '', headers: { 'X-Failed-Recipients': 'b@c.com' } })).toBe('b@c.com');
  });
  it('detects out-of-office with return date', () => {
    const r = classifyByRules({ from: 'anil@acme.com', subject: 'Automatic reply: Commercial simulation', body: 'I am out of the office until 18 November with limited access to email.', headers: { 'Auto-Submitted': 'auto-replied' } }, now);
    expect(r).toEqual({ category: 'out_of_office', returnDate: '2026-11-18' });
  });
  it('detects unsubscribe requests only in the new text, not quoted footer', () => {
    expect(classifyByRules({ from: 'a@b.com', subject: 'Re: hi', body: 'Please remove me from your list.', headers: {} }, now)?.category).toBe('unsubscribe');
    const quotedOnly = 'Sounds interesting, can we talk Thursday?\n\nOn Tue, 10 Nov 2026 at 10:00, Priya <p@w.pro> wrote:\n> If you prefer, unsubscribe here: https://u';
    expect(classifyByRules({ from: 'a@b.com', subject: 'Re: hi', body: quotedOnly, headers: {} }, now)).toBeNull();
  });
  it('strips quoted history', () => {
    expect(stripQuoted('Yes please.\n\nOn Mon, 9 Nov 2026, X <x@y> wrote:\n> old')).toBe('Yes please.');
    expect(stripQuoted('Thanks\nFrom: Priya\nSent: Monday\nTo: me')).toBe('Thanks');
  });
  it('parses return dates in several formats', () => {
    expect(extractReturnDate('back on 2026-11-20', now)).toBe('2026-11-20');
    expect(extractReturnDate('returning November 3rd', now)).toBe('2027-11-03');
    expect(extractReturnDate('away until 25/11/2026', now)).toBe('2026-11-25');
    expect(extractReturnDate('no date here', now)).toBeNull();
  });
});

describe('unsubscribe tokens', () => {
  it('round-trips and rejects tampering', async () => {
    const c = '4f1c2a3b-1111-2222-3333-444455556666', e = '9e8d7c6b-aaaa-bbbb-cccc-ddddeeeeffff';
    const t = await signUnsubscribe('s3cret', c, e);
    expect(await verifyUnsubscribe('s3cret', t)).toEqual({ contactId: c, enrollmentId: e });
    expect(await verifyUnsubscribe('other', t)).toBeNull();
    expect(await verifyUnsubscribe('s3cret', t.replace(c, '4f1c2a3b-1111-2222-3333-444455556667'))).toBeNull();
    expect(await verifyUnsubscribe('s3cret', 'garbage')).toBeNull();
  });
});
