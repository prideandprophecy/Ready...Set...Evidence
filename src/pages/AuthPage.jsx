import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { normalizeUsername, usernameIsValid } from '../lib/identifiers';
import { BRAND } from '../config/branding';

export default function AuthPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [handleStatus, setHandleStatus] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  async function checkHandle(raw = username) {
    const normalized = normalizeUsername(raw);
    if (!usernameIsValid(normalized)) {
      setHandleStatus('Use 3–40 lowercase letters, numbers, or hyphens.');
      return false;
    }
    const { data, error } = await supabase.rpc('rse_username_available', { p_username: normalized });
    if (error) {
      setHandleStatus(error.message);
      return false;
    }
    setHandleStatus(data ? 'Available' : 'That profile handle is already in use.');
    return Boolean(data);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');

    if (mode === 'signup') {
      const normalized = normalizeUsername(username);
      const available = await checkHandle(normalized);
      if (!available) {
        setBusy(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName.trim(), username: normalized } },
      });
      setMessage(error ? error.message : 'Account created. If email confirmation is enabled, check your email before signing in.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message);
    }
    setBusy(false);
  }

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <img className="auth-logo" src={BRAND.logoUrl} alt={BRAND.name} />
        <div className="eyebrow">Contributor identity</div>
        <h1>{mode === 'signin' ? 'Sign in' : 'Create your RSE profile'}</h1>
        <p className="muted">Your public profile links your evidence contributions, appraisals, reviews, verified papers, organizations, followers, and contribution metrics.</p>
        <form className="form-stack" onSubmit={submit}>
          {mode === 'signup' && <>
            <label>Display name<input required value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>
            <label>Public profile handle
              <div className="handle-field"><span>readysetevidence.vercel.app/u/</span><input required value={username} onChange={e => { setUsername(normalizeUsername(e.target.value)); setHandleStatus(''); }} onBlur={() => checkHandle()} /></div>
              {handleStatus && <span className={`tiny ${handleStatus === 'Available' ? 'success-text' : 'muted'}`}>{handleStatus}</span>}
            </label>
          </>}
          <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" minLength="8" required value={password} onChange={e => setPassword(e.target.value)} /></label>
          <button disabled={busy} className="button primary">{busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create profile'}</button>
        </form>
        {message && <div className="notice">{message}</div>}
        <button className="button text" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }}>{mode === 'signin' ? 'Need a profile? Create one' : 'Already have a profile? Sign in'}</button>
      </div>
    </div>
  );
}
