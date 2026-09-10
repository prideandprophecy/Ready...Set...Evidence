import { Link, NavLink, Outlet } from 'react-router-dom';
import { BookOpen, FlaskConical, GitCompareArrows, Home, LogIn, PlusCircle, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BRAND } from '../config/branding';

const nav = [
  ['/', 'Explore', Home],
  ['/evidence', 'Evidence', BookOpen],
  ['/synthesize', 'Synthesize', GitCompareArrows],
  ['/reviews', 'Reviews', FlaskConical],
  ['/organizations', 'Organizations', Users],
];

export default function Layout() {
  const { user, profile, signOut } = useAuth();
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link to="/" className="brand" aria-label={`${BRAND.name} home`}>
          <img className="brand-logo" src={BRAND.logoUrl} alt={BRAND.name} />
          <span className="brand-subtitle">Evidence Commons</span>
        </Link>
        <nav className="top-nav">
          {nav.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          {user ? <>
            <Link className="button ghost" to="/contribute"><PlusCircle size={16} /> Contribute</Link>
            <Link className="profile-pill" to={`/u/${profile?.username || ''}`}>{profile?.display_name || profile?.username || 'Profile'}</Link>
            <button className="button text" onClick={signOut}>Sign out</button>
          </> : <Link className="button primary" to="/auth"><LogIn size={16} /> Sign in</Link>}
        </div>
      </header>
      <main className="page-wrap"><Outlet /></main>
      <footer className="site-footer">
        <div className="footer-brand"><img src={BRAND.logoUrl} alt={BRAND.name} /><span>Evidence Commons</span></div>
        <span>{BRAND.tagline}</span>
      </footer>
    </div>
  );
}
