import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Role } from './constants';

export interface Profile { id: string; email: string; full_name: string | null; role: Role; is_active: boolean }

interface AuthState {
  session: Session | null; profile: Profile | null; loading: boolean;
  demo: boolean; setDemo: (v: boolean) => void;
  can: (...roles: Role[]) => boolean; refreshProfile: () => Promise<void>;
}
const Ctx = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemoState] = useState<boolean>(() => { try { return localStorage.getItem('wot-demo') === '1'; } catch { return false; } });
  const setDemo = (v: boolean) => { setDemoState(v); try { localStorage.setItem('wot-demo', v ? '1' : '0'); } catch { /* ignore */ } };

  const loadProfile = async (uid?: string) => {
    if (!uid) { setProfile(null); return; }
    const { data } = await supabase.from('users').select('*').eq('id', uid).maybeSingle();
    setProfile(data as Profile | null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); await loadProfile(data.session?.user.id); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); loadProfile(s?.user.id); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const can = (...roles: Role[]) => !!profile && roles.includes(profile.role);
  return <Ctx.Provider value={{ session, profile, loading, demo, setDemo, can, refreshProfile: () => loadProfile(session?.user.id) }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
export const MANAGERS: Role[] = ['super_admin', 'admin', 'sales_manager'];
export const ADMINS: Role[] = ['super_admin', 'admin'];
