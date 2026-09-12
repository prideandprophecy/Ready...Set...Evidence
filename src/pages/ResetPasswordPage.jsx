import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let active = true;

    async function prepare() {
      // Supabase normally establishes the recovery session automatically. This
      // extra exchange makes the page work if the project uses PKCE and returns ?code=.
      const { data: existing } = await supabase.auth.getSession();
      if (existing?.session) {
        if (active) { setHasSession(true); setReady(true); }
        return;
      }

      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) window.history.replaceState({}, document.title, '/reset-password');
      }

      const { data } = await supabase.auth.getSession();
      if (active) {
        setHasSession(Boolean(data?.session));
        setReady(true);
      }
    }

    prepare();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || session) {
        setHasSession(Boolean(session));
        setReady(true);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    if (password.length < 8) {
      setMsg('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setMsg('Password confirmation does not match.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMsg(error.message);
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    setComplete(true);
    setBusy(false);
  }

  if (!ready) return <div className="empty-state">Opening your secure password-reset session…</div>;

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="eyebrow"><KeyRound size={15} /> Account security</div>
        <h1>{complete ? 'Password updated' : 'Choose a new password'}</h1>

        {complete ? <>
          <p>Your password has been updated. Sign in again with the new password.</p>
          <Link className="button primary" to="/auth">Return to sign in</Link>
        </> : !hasSession ? <>
          <p className="muted">This recovery link is invalid, expired, or has already been used.</p>
          <Link className="button primary" to="/auth">Request another reset link</Link>
        </> : <form className="form-stack" onSubmit={submit}>
          <label>New password<input type="password" minLength="8" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Confirm new password<input type="password" minLength="8" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
          <button className="button primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
          {msg && <div className="notice">{msg}</div>}
        </form>}
      </div>
    </div>
  );
}
