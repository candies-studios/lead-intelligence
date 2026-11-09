import { useState } from 'react';
import { Plug, RefreshCw, KeyRound, Trash2 } from 'lucide-react';
import { callFn } from '@/lib/supabase';
import { useAuth, ADMINS } from '@/lib/auth';
import { useAsync, fmtDateTime } from '@/lib/hooks';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Spinner, toast } from '@/components/ui';

const HELP: Record<string, { url: string; note: string }> = {
  anthropic: { url: 'https://console.anthropic.com/settings/keys', note: 'Powers research reports, signal detection, outreach drafts and (as a fallback) web-search-based discovery.' },
  apollo: { url: 'https://developer.apollo.io/keys/', note: 'Company search, people search; email enrichment uses credits and is opt-in per campaign.' },
  hunter: { url: 'https://hunter.io/api-keys', note: 'Domain search for professional emails with sources, email pattern, and verification.' },
  pdl: { url: 'https://dashboard.peopledatalabs.com/api-keys', note: 'Company and person search. Work emails only where your plan includes them.' },
  google_cse: { url: 'https://developers.google.com/custom-search/v1/overview', note: 'Needs an API key and a Programmable Search Engine ID (cx). Used for news and buying signals.' },
};
const CAT: Record<string, string> = { ai: 'AI', search: 'Search', enrichment: 'Contact enrichment', company_data: 'Company data', builtin: 'Built-in', email: 'Email (planned)', crm: 'CRM (planned)' };

export default function Integrations() {
  const { can } = useAuth(); const isAdmin = can(...ADMINS);
  const st = useAsync(() => callFn<{ integrations: any[] }>('integrations', { action: 'status' }).then(r => r.integrations), []);
  const [editing, setEditing] = useState<any>(null); const [testing, setTesting] = useState<string | null>(null);
  const test = async (p: string) => { setTesting(p); try { const r = await callFn('integrations', { action: 'test', provider: p }); r.status === 'connected' ? toast.success(`${p}: connected`) : toast.error(`${p}: ${r.error ?? r.status}`); st.reload(); } catch (e) { toast.error((e as Error).message); } finally { setTesting(null); } };
  const remove = async (p: string) => { if (!confirm('Remove the saved key?')) return; await callFn('integrations', { action: 'remove', provider: p }); st.reload(); };

  return (
    <>
      <PageHeader title="Integrations" subtitle="Connection status is checked live against each provider. Keys never reach the browser — they are stored server-side and used only by Edge Functions." />
      {st.error && <Alert tone="error" title="Could not reach the integrations service">{st.error}. Deploy the Edge Functions (README → Deploy) and refresh.</Alert>}
      {st.loading ? <Spinner /> : st.data && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {st.data.map(i => {
            const testable = !!HELP[i.provider];
            const tone = i.status === 'connected' ? 'green' : i.status === 'error' ? 'red' : i.status === 'builtin' ? 'navy' : i.status === 'planned' ? 'slate' : i.configured ? 'amber' : 'slate';
            const label = i.status === 'connected' ? 'Connected' : i.status === 'error' ? 'Error' : i.status === 'builtin' ? 'Built-in' : i.status === 'planned' ? 'Planned' : i.configured ? 'Key saved — test it' : 'Not connected';
            return (
              <Card key={i.provider}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-navy-50 text-navy-700 flex items-center justify-center"><Plug className="h-4 w-4" /></div>
                    <div><div className="font-semibold text-sm">{i.display_name}</div><div className="text-[11px] text-ink-faint">{CAT[i.category]}</div></div></div>
                  <Badge tone={tone as any}>{label}</Badge>
                </div>
                <p className="text-xs text-ink-soft mt-3 leading-relaxed">{HELP[i.provider]?.note ?? i.description}</p>
                {i.last_error && <p className="text-[11px] text-red-600 mt-2 break-words">{i.last_error}</p>}
                {i.key_source === 'environment' && <p className="text-[11px] text-ink-faint mt-2">Key provided via server environment variable.</p>}
                {i.last_checked_at && <p className="text-[11px] text-ink-faint mt-1">Checked {fmtDateTime(i.last_checked_at)}</p>}
                {testable && <div className="flex flex-wrap gap-2 mt-4">
                  {isAdmin && i.key_source !== 'environment' && <Button size="sm" variant="subtle" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setEditing(i)}>{i.configured ? 'Replace key' : 'Connect'}</Button>}
                  {i.configured && <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={testing === i.provider} onClick={() => test(i.provider)}>Test</Button>}
                  {isAdmin && i.key_source === 'saved_key' && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove(i.provider)}>Remove</Button>}
                  <a className="text-[11px] text-navy-600 self-center ml-auto" href={HELP[i.provider].url} target="_blank" rel="noreferrer">Get a key ↗</a>
                </div>}
                {i.status === 'planned' && <p className="text-[11px] text-ink-faint mt-3">Version 1 tracks outreach manually (copy, mail-app hand-off, logging). The data model already stores communications for future sync.</p>}
              </Card>
            );
          })}
        </div>
      )}
      <Card className="mt-6" title="Manual research fallback"><p className="text-sm text-ink-soft">When a provider is unavailable, every workflow still works manually: add companies and contacts with their source URLs from the Discover and Company pages. The platform never fills gaps with generated records, and LinkedIn is never scraped.</p></Card>
      {editing && <KeyModal integ={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); st.reload(); }} />}
    </>
  );
}

function KeyModal({ integ, onClose, onSaved }: { integ: any; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState(''); const [cx, setCx] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await callFn('integrations', { action: 'save', provider: integ.provider, api_key: key.trim(), extra: integ.provider === 'google_cse' ? { cx: cx.trim() } : {} });
      if (r.status === 'connected') { toast.success('Connected'); onSaved(); } else setErr(`Key saved but the test failed: ${r.error ?? r.status}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Connect ${integ.display_name}`} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={busy} onClick={save} disabled={!key}>Save & test</Button></>}>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      <div className="space-y-3">
        <Field label="API key" hint="Sent once over HTTPS to an Edge Function and stored in a table no browser session can read."><Input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></Field>
        {integ.provider === 'google_cse' && <Field label="Search engine ID (cx)"><Input value={cx} onChange={e => setCx(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}
