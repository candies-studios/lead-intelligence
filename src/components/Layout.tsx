import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { LayoutDashboard, Building2, UserSearch, Sparkles, Database, Rocket, Send, CalendarClock, BarChart3, Plug, Settings, LogOut, Menu, X, FlaskConical } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { ROLE_LABEL } from '@/lib/constants';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/discover', label: 'Discover Companies', icon: Building2 },
  { to: '/decision-makers', label: 'Find Decision Makers', icon: UserSearch },
  { to: '/research', label: 'AI Research', icon: Sparkles },
  { to: '/leads', label: 'Lead Database', icon: Database },
  { to: '/campaigns', label: 'Campaigns', icon: Rocket },
  { to: '/outreach', label: 'Outreach', icon: Send },
  { to: '/follow-ups', label: 'Follow-ups', icon: CalendarClock },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const { profile, demo, setDemo } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div className="min-h-screen flex">
      <aside className={cx('fixed inset-y-0 left-0 z-40 w-64 bg-navy-950 text-navy-100 flex flex-col transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="px-5 pt-6 pb-5 border-b border-white/5">
          <div className="font-display text-[15px] font-bold tracking-[0.12em] text-white">WORLD OF TRADE</div>
          <div className="text-[10.5px] tracking-[0.28em] text-navy-300 mt-0.5">LEAD INTELLIGENCE</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition',
                isActive ? 'bg-white/10 text-white' : 'text-navy-200/80 hover:bg-white/5 hover:text-white')}>
              <n.icon className="h-4 w-4 opacity-80" />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-white/5">
          <div className="text-[13px] text-white truncate">{profile?.full_name ?? profile?.email}</div>
          <div className="text-[11px] text-navy-300">{profile ? ROLE_LABEL[profile.role] : ''}</div>
          <button onClick={async () => { await supabase.auth.signOut(); nav('/login'); }} className="mt-3 flex items-center gap-2 text-xs text-navy-300 hover:text-white"><LogOut className="h-3.5 w-3.5" />Sign out</button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex-1 lg:pl-64 min-w-0">
        <header className="sticky top-0 z-20 h-14 bg-white/85 backdrop-blur border-b border-slate-200/70 flex items-center justify-between px-4 lg:px-8">
          <button className="lg:hidden text-ink-soft" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
          <div className="hidden lg:block text-xs text-ink-faint">FMCG & FMCD prospect intelligence · quality over quantity</div>
          <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer select-none" title="Demo mode shows only clearly-labelled fictional records and hides real prospect data">
            <FlaskConical className={cx('h-3.5 w-3.5', demo && 'text-amber-600')} />Demo mode
            <input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} className="accent-amber-600" />
          </label>
        </header>
        {demo && <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs px-8 py-2">DEMO ENVIRONMENT — you are viewing fictional sample records only. Real prospect data is hidden. New records you create here are marked as demo.</div>}
        <main className="px-4 lg:px-8 py-7 max-w-[1500px]"><Outlet /></main>
      </div>
    </div>
  );
}
