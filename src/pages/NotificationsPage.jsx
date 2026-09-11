import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/identifiers';

export default function NotificationsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [prefs, setPrefs] = useState({ in_app_enabled: true, email_mode: 'important', org_requests: true, evidence_challenges: true, proposal_resolutions: true, followed_evidence_changes: true });
  const [msg, setMsg] = useState('');

  useEffect(() => { if (user?.id) load(); }, [user?.id]);

  async function load() {
    const [n, p] = await Promise.all([
      supabase.from('rse_notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('rse_notification_preferences').select('*').eq('user_id', user.id).maybeSingle(),
    ]);
    setRows(n.data || []);
    if (p.data) setPrefs(p.data);
  }

  async function markAllRead() {
    const { error } = await supabase.from('rse_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
    if (error) setMsg(error.message); else await load();
  }

  async function remove(id) {
    await supabase.from('rse_notifications').delete().eq('id', id).eq('user_id', user.id);
    setRows(v => v.filter(x => x.id !== id));
  }

  async function savePrefs(e) {
    e.preventDefault();
    const payload = { ...prefs, user_id: user.id, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('rse_notification_preferences').upsert(payload, { onConflict: 'user_id' });
    setMsg(error ? error.message : 'Notification preferences saved. External email delivery is not enabled yet; these settings are ready for the mail integration.');
  }

  if (!user) return <div className="empty-state">Sign in to view notifications.</div>;

  return <section>
    <div className="page-title"><div><div className="eyebrow"><Bell size={15} /> Notifications</div><h1>Your RSE activity</h1><p>Organization requests, evidence challenges, and other changes that need your attention appear here.</p></div><button className="button secondary" onClick={markAllRead}><CheckCheck size={16} /> Mark all read</button></div>
    {msg && <div className="notice">{msg}</div>}

    <div className="two-column"><section><div className="card">
      <h2>Recent notifications</h2>
      {rows.map(n => <div className="duplicate-row" key={n.id} style={{ opacity: n.read_at ? .72 : 1 }}>
        <div><strong>{n.target_url ? <Link to={n.target_url}>{n.title}</Link> : n.title}</strong>{n.body && <div>{n.body}</div>}<div className="muted tiny">{formatDate(n.created_at)}{n.read_at ? ' • read' : ' • unread'}</div></div>
        <button className="button mini ghost" onClick={() => remove(n.id)} title="Delete notification"><Trash2 size={13} /></button>
      </div>)}
      {!rows.length && <div className="muted">No notifications yet.</div>}
    </div></section><aside>
      <form className="card form-stack" onSubmit={savePrefs}>
        <h2>Notification preferences</h2>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.in_app_enabled)} onChange={e => setPrefs({ ...prefs, in_app_enabled: e.target.checked })} /> In-app notifications</label>
        <label>Email delivery<select value={prefs.email_mode || 'important'} onChange={e => setPrefs({ ...prefs, email_mode: e.target.value })}><option value="off">Off</option><option value="important">Important events only</option><option value="immediate">Immediate</option><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option></select></label>
        <div className="muted tiny">Email preferences are stored now, but external email sending still requires a mail provider such as Resend or Postmark.</div>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.org_requests)} onChange={e => setPrefs({ ...prefs, org_requests: e.target.checked })} /> Organization requests</label>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.evidence_challenges)} onChange={e => setPrefs({ ...prefs, evidence_challenges: e.target.checked })} /> Evidence challenges</label>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.proposal_resolutions)} onChange={e => setPrefs({ ...prefs, proposal_resolutions: e.target.checked })} /> Proposal/challenge resolutions</label>
        <label className="checkbox"><input type="checkbox" checked={Boolean(prefs.followed_evidence_changes)} onChange={e => setPrefs({ ...prefs, followed_evidence_changes: e.target.checked })} /> Saved/followed evidence changes</label>
        <button className="button primary">Save preferences</button>
      </form>
    </aside></div>
  </section>;
}
