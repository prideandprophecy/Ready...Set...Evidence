import { useEffect, useState } from 'react';
import { Bell, Mail, Send } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

const DEFAULTS = {
  in_app_enabled: true,
  email_mode: 'important',
  org_requests: true,
  evidence_challenges: true,
  proposal_resolutions: true,
  authorship_updates: true,
  followed_evidence_changes: true,
};

export default function NotificationPreferencesForm({ compact = false }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    load();
  }, [user?.id]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('rse_notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) setMsg(error.message);
    setPrefs({ ...DEFAULTS, ...(data || {}) });
    setLoading(false);
  }

  async function save(e) {
    e?.preventDefault?.();
    if (!user?.id) return;
    setSaving(true);
    setMsg('');
    const payload = {
      user_id: user.id,
      in_app_enabled: Boolean(prefs.in_app_enabled),
      email_mode: prefs.email_mode || 'important',
      org_requests: Boolean(prefs.org_requests),
      evidence_challenges: Boolean(prefs.evidence_challenges),
      proposal_resolutions: Boolean(prefs.proposal_resolutions),
      authorship_updates: Boolean(prefs.authorship_updates),
      followed_evidence_changes: Boolean(prefs.followed_evidence_changes),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('rse_notification_preferences')
      .upsert(payload, { onConflict: 'user_id' });
    setMsg(error ? error.message : 'Notification preferences saved.');
    setSaving(false);
  }

  async function sendTestEmail() {
    setTesting(true);
    setMsg('');
    const { data, error } = await supabase.functions.invoke('notification-email-dispatch', {
      body: { action: 'test' },
    });
    setMsg(error ? error.message : (data?.message || 'Test email sent.'));
    setTesting(false);
  }

  if (!user) return null;
  if (loading) return <div className="card"><div className="muted">Loading notification preferences…</div></div>;

  return (
    <form className="card form-stack" onSubmit={save}>
      <div>
        <div className="eyebrow"><Bell size={15} /> Notifications</div>
        <h2>{compact ? 'Notification preferences' : 'How RSE should notify you'}</h2>
        <p className="muted tiny">These settings apply to new notifications. Notification-type switches control both in-app and email delivery.</p>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={Boolean(prefs.in_app_enabled)}
          onChange={e => setPrefs({ ...prefs, in_app_enabled: e.target.checked })}
        />
        In-app notifications
      </label>

      <label>
        <span><Mail size={14} /> Email delivery</span>
        <select value={prefs.email_mode || 'important'} onChange={e => setPrefs({ ...prefs, email_mode: e.target.value })}>
          <option value="off">Off</option>
          <option value="important">Important events only</option>
          <option value="immediate">All enabled events immediately</option>
          <option value="daily">Daily digest</option>
          <option value="weekly">Weekly digest</option>
        </select>
      </label>

      <div className="muted tiny">
        Daily and weekly modes batch enabled events into a digest. Important mode sends only high-priority activity such as challenges, organization requests, and authorship decisions.
      </div>

      <div className="stack compact">
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.org_requests)} onChange={e => setPrefs({ ...prefs, org_requests: e.target.checked })} /> Organization requests and decisions</label>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.evidence_challenges)} onChange={e => setPrefs({ ...prefs, evidence_challenges: e.target.checked })} /> Evidence challenges</label>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.proposal_resolutions)} onChange={e => setPrefs({ ...prefs, proposal_resolutions: e.target.checked })} /> Challenge / proposal resolutions</label>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.authorship_updates)} onChange={e => setPrefs({ ...prefs, authorship_updates: e.target.checked })} /> Authorship verification updates</label>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.followed_evidence_changes)} onChange={e => setPrefs({ ...prefs, followed_evidence_changes: e.target.checked })} /> Saved / followed evidence changes</label>
      </div>

      {msg && <div className="notice">{msg}</div>}
      <div className="button-row">
        <button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button>
        <button type="button" className="button secondary" onClick={sendTestEmail} disabled={testing || prefs.email_mode === 'off'} title={prefs.email_mode === 'off' ? 'Turn on email delivery first' : 'Send a test email to your account email'}>
          <Send size={15} /> {testing ? 'Sending…' : 'Send test email'}
        </button>
      </div>
    </form>
  );
}
