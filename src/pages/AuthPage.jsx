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

    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setMessage(error ? error.message : 'If an account exists for that email address, a password-reset link has been sent.');
      setBusy(false);
      return;
    }

    if (mode === 'signup') {
      const normalized = normalizeUsername(username);
      const available = await checkHandle(normalized);
      if (!available) {
        setBusy(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim(), username: normalized } },
      });
      setMessage(error ? error.message : 'Account created. If email confirmation is enabled, check your email before signing in.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMessage(error.message);
    }
    setBusy(false);
  }

  function switchMode(next) {
    setMode(next);
    setMessage('');
    setHandleStatus('');
  }

  const title = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your RSE profile' : 'Reset your password';

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <img className="auth-logo" src={BRAND.logoUrl} alt={BRAND.name} />
        <div className="eyebrow">Contributor identity</div>
        <h1>{title}</h1>
        <p className="muted">
          {mode === 'forgot'
            ? 'Enter your account email and RSE will send a secure password-reset link.'
            : 'Your public profile links your evidence contributions, appraisals, Evidence Pages, verified papers, organizations, followers, and contribution metrics.'}
        </p>

        <form className="form-stack" onSubmit={submit}>
          {mode === 'signup' && <>
            <label>Display name<input required value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>
            <label>Public profile handle
              <div className="handle-field"><span>readysetevidence.vercel.app/u/</span><input required value={username} onChange={e => { setUsername(normalizeUsername(e.target.value)); setHandleStatus(''); }} onBlur={() => checkHandle()} /></div>
              {handleStatus && <span className={`tiny ${handleStatus === 'Available' ? 'success-text' : 'muted'}`}>{handleStatus}</span>}
            </label>
          </>}

          <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          {mode !== 'forgot' && <label>Password<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength="8" required value={password} onChange={e => setPassword(e.target.value)} /></label>}

          <button disabled={busy} className="button primary">
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create profile' : 'Send reset link'}
          </button>
        </form>

        {message && <div className="notice">{message}</div>}

        <div className="stack compact">
          {mode === 'signin' && <>
            <button className="button text" type="button" onClick={() => switchMode('forgot')}>Forgot password?</button>
            <button className="button text" type="button" onClick={() => switchMode('signup')}>Need a profile? Create one</button>
          </>}
          {mode === 'signup' && <button className="button text" type="button" onClick={() => switchMode('signin')}>Already have a profile? Sign in</button>}
          {mode === 'forgot' && <button className="button text" type="button" onClick={() => switchMode('signin')}>Return to sign in</button>}
        </div>
      </div>
    </div>
  );
}
