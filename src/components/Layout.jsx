import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Bell, BookOpen, FileStack, GitCompareArrows, Home, LogIn, PlusCircle, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BRAND } from '../config/branding';
import { supabase } from '../supabaseClient';

const nav = [
  ['/', 'Explore', Home],
  ['/evidence', 'Evidence', BookOpen],
  ['/synthesize', 'Synthesize', GitCompareArrows],
  ['/pages', 'Evidence Pages', FileStack],
  ['/organizations', 'Organizations', Users],
];

export default function Layout() {
  const { user, profile, signOut } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadUnread() {
      if (!user?.id) { setUnread(0); return; }
      const { count } = await supabase.from('rse_notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null);
      if (!cancelled) setUnread(count || 0);
    }
    loadUnread();
    return () => { cancelled = true; };
  }, [user?.id]);

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
            <Link className="button ghost" to="/notifications" title="Notifications" style={{ position: 'relative' }}><Bell size={17} />{unread > 0 && <span className="tag" style={{ padding: '1px 6px', minWidth: 20, textAlign: 'center' }}>{unread > 99 ? '99+' : unread}</span>}</Link>
            <Link className="profile-pill" to={`/u/${profile?.username || ''}`}>{profile?.display_name || profile?.username || 'Profile'}</Link>
            <button className="button text" onClick={signOut}>Sign out</button>
          </> : <Link className="button primary" to="/auth"><LogIn size={16} /> Sign in</Link>}
        </div>
      </header>
      <main className="page-wrap"><Outlet /></main>
      <footer className="site-footer">
        <div className="footer-brand"><img src={BRAND.iconUrl || BRAND.logoUrl} alt={BRAND.name} /><span>Evidence Commons</span></div>
        <span>{BRAND.tagline}</span>
      </footer>
    </div>
  );
}
