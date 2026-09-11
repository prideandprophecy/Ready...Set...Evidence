import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCheck2, RadioTower } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { ProfileLink, ScopeTag } from '../components/Common';
import { formatDate } from '../lib/identifiers';

export default function EvidencePagesPage() {
  const { user } = useAuth();
  const [living, setLiving] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [mode, setMode] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [user?.id]);

  async function load() {
    setLoading(true);
    const [l, r] = await Promise.all([
      supabase.from('rse_live_views')
        .select('id,slug,title,description,weighting,visibility,owner_user_id,updated_at,owner:rse_profiles!owner_user_id(username,display_name)')
        .order('updated_at', { ascending: false }).limit(100),
      supabase.from('rse_reviews')
        .select('id,slug,title,review_type,research_question,abstract,status,visibility,owner_user_id,version_tag,published_at,updated_at,owner:rse_profiles!owner_user_id(username,display_name)')
        .order('updated_at', { ascending: false }).limit(100),
    ]);
    setLiving(l.data || []);
    setSnapshots(r.data || []);
    setLoading(false);
  }

  const items = useMemo(() => {
    const a = living.map(x => ({ ...x, pageKind: 'living', sortDate: x.updated_at }));
    const b = snapshots.map(x => ({ ...x, pageKind: 'snapshot', sortDate: x.published_at || x.updated_at }));
    return [...a, ...b]
      .filter(x => mode === 'all' || x.pageKind === mode || (mode === 'mine' && x.owner_user_id === user?.id))
      .sort((x, y) => new Date(y.sortDate || 0) - new Date(x.sortDate || 0));
  }, [living, snapshots, mode, user?.id]);

  return <section>
    <div className="page-title">
      <div>
        <div className="eyebrow">Evidence Pages</div>
        <h1>Living evidence and reproducible snapshots</h1>
        <p>A living page recalculates from the current Commons. A review snapshot preserves methods, searches, inclusion decisions, and frozen evidence versions. They are presented together because they are two states of the same evidence workflow.</p>
      </div>
      <Link className="button primary" to="/synthesize">Create from synthesis</Link>
    </div>

    <div className="filter-bar">
      <button className={`button ${mode === 'all' ? 'primary' : 'ghost'}`} onClick={() => setMode('all')}>All</button>
      <button className={`button ${mode === 'living' ? 'primary' : 'ghost'}`} onClick={() => setMode('living')}>Living</button>
      <button className={`button ${mode === 'snapshot' ? 'primary' : 'ghost'}`} onClick={() => setMode('snapshot')}>Snapshots</button>
      {user && <button className={`button ${mode === 'mine' ? 'primary' : 'ghost'}`} onClick={() => setMode('mine')}>My pages</button>}
    </div>

    {loading ? <div className="card">Loading…</div> : <div className="card-grid">
      {items.map(item => item.pageKind === 'living' ? <article className="card link-card" key={`live-${item.id}`}>
        <div className="work-card-top"><div className="eyebrow"><RadioTower size={14} /> Living evidence</div><ScopeTag visibility={item.visibility || 'public'} /></div>
        <h3><Link to={`/live/${item.slug}`}>{item.title}</Link></h3>
        <p>{item.description || 'A synthesis that recalculates from current consensus evidence.'}</p>
        <div className="muted tiny">Updated {formatDate(item.updated_at)} • {item.weighting?.toUpperCase()} • by <ProfileLink profile={item.owner} /></div>
      </article> : <article className="card link-card" key={`review-${item.id}`}>
        <div className="work-card-top"><div className="eyebrow"><FileCheck2 size={14} /> {item.status === 'published' ? 'Frozen snapshot' : 'Review workspace'}</div><ScopeTag visibility={item.visibility || 'private'} /></div>
        <h3><Link to={`/review/${item.slug}`}>{item.title}</Link></h3>
        <p>{item.research_question || item.abstract || 'A reproducible review workspace built from Commons evidence.'}</p>
        <div className="muted tiny">{item.status} • v{item.version_tag || '0.1'} • {item.published_at ? `published ${formatDate(item.published_at)}` : `updated ${formatDate(item.updated_at)}`} • by <ProfileLink profile={item.owner} /></div>
      </article>)}
      {!items.length && <div className="card muted">No matching evidence pages.</div>}
    </div>}
  </section>;
}
