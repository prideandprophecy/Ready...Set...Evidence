import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/identifiers';
import NotificationPreferencesForm from '../components/NotificationPreferencesForm';

export default function NotificationsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => { if (user?.id) load(); }, [user?.id]);

  async function load() {
    const { data, error } = await supabase
      .from('rse_notifications')
      .select('*')
      .eq('user_id', user.id)
      .eq('show_in_app', true)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) setMsg(error.message);
    setRows(data || []);
  }

  async function markAllRead() {
    const { error } = await supabase
      .from('rse_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('show_in_app', true)
      .is('read_at', null);
    if (error) setMsg(error.message); else await load();
  }

  async function remove(id) {
    const { error } = await supabase.from('rse_notifications').delete().eq('id', id).eq('user_id', user.id);
    if (error) setMsg(error.message);
    else setRows(v => v.filter(x => x.id !== id));
  }

  if (!user) return <div className="empty-state">Sign in to view notifications.</div>;

  return <section>
    <div className="page-title"><div><div className="eyebrow"><Bell size={15} /> Notifications</div><h1>Your RSE activity</h1><p>Organization requests, evidence challenges, authorship decisions, and other changes that need your attention appear here.</p></div><button className="button secondary" onClick={markAllRead}><CheckCheck size={16} /> Mark all read</button></div>
    {msg && <div className="notice">{msg}</div>}

    <div className="two-column"><section><div className="card">
      <h2>Recent notifications</h2>
      {rows.map(n => <div className="duplicate-row" key={n.id} style={{ opacity: n.read_at ? .72 : 1 }}>
        <div><strong>{n.target_url ? <Link to={n.target_url}>{n.title}</Link> : n.title}</strong>{n.body && <div>{n.body}</div>}<div className="muted tiny">{formatDate(n.created_at)}{n.read_at ? ' • read' : ' • unread'}</div></div>
        <button className="button mini ghost" onClick={() => remove(n.id)} title="Delete notification"><Trash2 size={13} /></button>
      </div>)}
      {!rows.length && <div className="muted">No notifications yet.</div>}
    </div></section><aside>
      <NotificationPreferencesForm compact />
    </aside></div>
  </section>;
}
