import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button, Input, Field, Alert } from '@/components/ui';

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try {
      if (mode === 'signin') { const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; }
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
        if (!data.session) setMsg('Check your inbox to confirm your email, then sign in.');
      }
      if (mode === 'reset') { const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname }); if (error) throw error; setMsg('Password reset email sent.'); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-navy-950 text-white p-12 relative overflow-hidden">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-navy-700/30 blur-3xl" />
        <div>
          <div className="font-display text-lg font-bold tracking-[0.14em]">WORLD OF TRADE</div>
          <div className="text-xs tracking-[0.3em] text-navy-300">LEAD INTELLIGENCE</div>
        </div>
        <div className="relative max-w-md">
          <h2 className="font-display text-3xl font-bold leading-tight">Find the leaders who build sales, trade marketing, distribution & channel capability.</h2>
          <p className="mt-4 text-navy-200 text-sm leading-relaxed">Across 20+ sectors — from FMCG and consumer durables to pharma, automotive, building materials, agri-inputs, telecom and financial services — research companies, identify L&D, HR, Sales, Distribution and Trade Marketing decision-makers with sourced contact data, qualify them with transparent scoring, and run personalised outreach for the three-day World of Trade simulation.</p>
        </div>
        <div className="text-xs text-navy-400">Sourced data only · No fabricated contacts · GDPR & DPDP-conscious</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-navy-950">{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}</h1>
            <p className="text-sm text-ink-soft mt-1">{mode === 'signup' ? 'The first account becomes Super Admin.' : 'Welcome back.'}</p>
          </div>
          {err && <Alert tone="error">{err}</Alert>}
          {msg && <Alert tone="success">{msg}</Alert>}
          {mode === 'signup' && <Field label="Full name"><Input value={name} onChange={e => setName(e.target.value)} required /></Field>}
          <Field label="Work email"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></Field>
          {mode !== 'reset' && <Field label="Password"><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></Field>}
          <Button variant="primary" className="w-full" loading={busy}>{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}</Button>
          <div className="flex justify-between text-xs text-ink-soft">
            {mode !== 'signin' ? <button type="button" onClick={() => setMode('signin')}>Back to sign in</button> : <button type="button" onClick={() => setMode('signup')}>Create an account</button>}
            {mode === 'signin' && <button type="button" onClick={() => setMode('reset')}>Forgot password?</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
