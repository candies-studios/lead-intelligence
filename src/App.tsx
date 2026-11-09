import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import Layout from './components/Layout';
import { Spinner, Toaster, Alert } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Discover from './pages/Discover';
import CompanyProfile from './pages/CompanyProfile';
import DecisionMakers from './pages/DecisionMakers';
import Research from './pages/Research';
import Leads from './pages/Leads';
import LeadDetail from './pages/LeadDetail';
import Campaigns from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import Outreach from './pages/Outreach';
import FollowUps from './pages/FollowUps';
import Analytics from './pages/Analytics';
import Integrations from './pages/Integrations';
import Settings from './pages/Settings';

export default function App() {
  const { session, loading, profile } = useAuth();
  if (!isConfigured) return (
    <div className="max-w-xl mx-auto mt-24 px-4"><Alert tone="warn" title="Supabase is not configured">
      This build was made without <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
      On GitHub Pages: add both as repository secrets (Settings → Secrets and variables → Actions), then re-run the “Deploy to GitHub Pages” workflow.
      Locally: copy <code>.env.example</code> to <code>.env</code>, fill them in and restart <code>npm run dev</code>.
    </Alert></div>
  );
  if (loading) return <Spinner label="Starting…" />;
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" /> : <Login />} />
        <Route element={session ? <Layout /> : <Navigate to="/login" />}>
          {session && profile && !profile.is_active
            ? <Route path="*" element={<Alert tone="error" title="Account deactivated">Ask an administrator to reactivate your account.</Alert>} />
            : <>
              <Route index element={<Overview />} />
              <Route path="discover" element={<Discover />} />
              <Route path="companies/:id" element={<CompanyProfile />} />
              <Route path="decision-makers" element={<DecisionMakers />} />
              <Route path="research" element={<Research />} />
              <Route path="leads" element={<Leads />} />
              <Route path="leads/:id" element={<LeadDetail />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="campaigns/:id" element={<CampaignDetail />} />
              <Route path="outreach" element={<Outreach />} />
              <Route path="follow-ups" element={<FollowUps />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" />} />
            </>}
        </Route>
      </Routes>
    </>
  );
}
