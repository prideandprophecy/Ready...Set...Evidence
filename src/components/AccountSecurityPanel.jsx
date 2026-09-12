import { useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

export default function AccountSecurityPanel() {
  const { user } = useAuth();
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!user) return null;

  async function sendReset() {
    setResetBusy(true);
    setMsg('');
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setMsg(error ? error.message : `Password-reset email sent to ${user.email}.`);
    setResetBusy(false);
  }

  async function changePassword(e) {
    e.preventDefault();
    setMsg('');
    if (nextPassword.length < 8) {
      setMsg('Use a password with at least 8 characters.');
      return;
    }
    if (nextPassword !== confirmPassword) {
      setMsg('Password confirmation does not match.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: nextPassword });
    if (error) setMsg(error.message);
    else {
      setMsg('Password updated.');
      setNextPassword('');
      setConfirmPassword('');
    }
    setBusy(false);
  }

  return (
    <div className="card form-stack">
      <div>
        <div className="eyebrow"><KeyRound size={15} /> Account security</div>
        <h2>Password</h2>
        <p className="muted tiny">Signed in as {user.email}. RSE does not store your password in its public application tables; password authentication is handled by Supabase Auth.</p>
      </div>

      <button type="button" className="button secondary" onClick={sendReset} disabled={resetBusy}>
        <Mail size={15} /> {resetBusy ? 'Sending…' : 'Email me a password-reset link'}
      </button>

      <form className="form-stack" onSubmit={changePassword}>
        <label>New password<input type="password" minLength="8" autoComplete="new-password" value={nextPassword} onChange={e => setNextPassword(e.target.value)} /></label>
        <label>Confirm new password<input type="password" minLength="8" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
        <button className="button primary" disabled={busy || !nextPassword}>{busy ? 'Updating…' : 'Change password'}</button>
      </form>
      {msg && <div className="notice">{msg}</div>}
    </div>
  );
}
