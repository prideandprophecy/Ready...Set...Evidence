import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import ExplorePage from './pages/ExplorePage';
import EvidencePage from './pages/EvidencePage';
import AuthPage from './pages/AuthPage';
import ProfilePage from './pages/ProfilePage';
import ContributePage from './pages/ContributePage';
import WorkPage from './pages/WorkPage';
import SynthesizePage from './pages/SynthesizePage';
import LiveViewPage from './pages/LiveViewPage';
import EvidencePagesPage from './pages/EvidencePagesPage';
import ReviewPage from './pages/ReviewPage';
import ReviewEditorPage from './pages/ReviewEditorPage';
import OrganizationsPage from './pages/OrganizationsPage';
import OrganizationPage from './pages/OrganizationPage';
import NotificationsPage from './pages/NotificationsPage';
import OrcidCallbackPage from './pages/OrcidCallbackPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

export default function App() {
  return <AuthProvider><BrowserRouter><Routes><Route element={<Layout />}>
    <Route path="/" element={<ExplorePage />} />
    <Route path="/evidence" element={<EvidencePage />} />
    <Route path="/auth" element={<AuthPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/u/:username" element={<ProfilePage />} />
    <Route path="/contribute" element={<ContributePage />} />
    <Route path="/work/:id" element={<WorkPage />} />
    <Route path="/synthesize" element={<SynthesizePage />} />
    <Route path="/pages" element={<EvidencePagesPage />} />
    <Route path="/live/:slug" element={<LiveViewPage />} />
    <Route path="/live/:slug/edit" element={<SynthesizePage />} />
    <Route path="/reviews" element={<Navigate to="/pages" replace />} />
    <Route path="/review/:slug" element={<ReviewPage />} />
    <Route path="/review/:slug/edit" element={<ReviewEditorPage />} />
    <Route path="/organizations" element={<OrganizationsPage />} />
    <Route path="/org/:slug" element={<OrganizationPage />} />
    <Route path="/notifications" element={<NotificationsPage />} />
    <Route path="/orcid/callback" element={<OrcidCallbackPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes></BrowserRouter></AuthProvider>;
}
