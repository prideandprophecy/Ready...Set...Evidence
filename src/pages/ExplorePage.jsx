import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCheck2, RadioTower, Search, Sparkles } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { ActivityList, MetricCard, ProfileLink, WorkCard } from '../components/Common';
import { compactNumber, formatDate } from '../lib/identifiers';

async function hydrateActors(events) {
  const ids = [...new Set((events || []).map(e => e.actor_id).filter(Boolean))];
  if (!ids.length) return events || [];
  const { data } = await supabase.from('rse_profiles').select('id,username,display_name').in('id', ids);
  const map = new Map((data || []).map(p => [p.id, p]));
  return (events || []).map(e => ({ ...e, actor: map.get(e.actor_id) }));
}

export default function ExplorePage() {
  const [metrics, setMetrics] = useState({});
  const [works, setWorks] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [live, setLive] = useState([]);
  const [events, setEvents] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load(search = '') {
    setLoading(true);
    const [m, w, r, l, a] = await Promise.all([
      supabase.rpc('rse_global_metrics'),
      supabase.rpc('rse_search_public_works', { p_query: search.trim() || null, p_year: null, p_limit: 12, p_offset: 0 }),
      supabase.from('rse_reviews').select('id,slug,title,review_type,abstract,published_at,owner:rse_profiles!owner_user_id(username,display_name)').eq('status', 'published').eq('visibility', 'public').order('published_at', { ascending: false }).limit(6),
      supabase.from('rse_live_views').select('id,slug,title,description,weighting,updated_at,owner:rse_profiles!owner_user_id(username,display_name)').eq('is_public', true).order('updated_at', { ascending: false }).limit(6),
      supabase.from('rse_activity_events').select('*').eq('is_public', true).order('created_at', { ascending: false }).limit(12),
    ]);
    setMetrics(m.data || {});
    setWorks(w.data || []);
    setReviews(r.data || []);
    setLive(l.data || []);
    setEvents(await hydrateActors(a.data || []));
    setLoading(false);
  }

  const evidencePages = [
    ...live.map(x => ({ ...x, kind: 'living', date: x.updated_at })),
    ...reviews.map(x => ({ ...x, kind: 'snapshot', date: x.published_at })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 8);

  return <>
    <section className="hero">
      <div className="eyebrow"><Sparkles size={15} /> Collaborative evidence, not isolated reviews</div>
      <h1>Build on evidence that has already been extracted.</h1>
      <p>Find papers, reuse structured endpoints, compare competing extractions, contribute appraisals, build living syntheses, and preserve reproducible evidence snapshots.</p>
      <form className="hero-search" onSubmit={e => { e.preventDefault(); load(q); }}>
        <Search size={19} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title, author, DOI, PMID, journal, abstract..." /><button className="button primary">Search</button>
      </form>
      <div className="hero-actions"><Link className="button primary" to="/contribute">Contribute evidence</Link><Link className="button secondary" to="/synthesize">Build a comparison</Link></div>
    </section>

    <section className="metric-grid">
      <MetricCard label="Papers" value={compactNumber(metrics.papers)} />
      <MetricCard label="Extracted endpoints" value={compactNumber(metrics.endpoints)} />
      <MetricCard label="Study groups" value={compactNumber(metrics.study_groups)} />
      <MetricCard label="Appraisals" value={compactNumber(metrics.appraisals)} />
      <MetricCard label="Contributors" value={compactNumber(metrics.contributors)} />
      <MetricCard label="Living evidence pages" value={compactNumber(metrics.living_pages)} />
      <MetricCard label="Published snapshots" value={compactNumber(metrics.published_snapshots ?? metrics.published_reviews)} />
    </section>

    <div className="two-column">
      <section><div className="section-heading"><div><div className="eyebrow">Evidence Commons</div><h2>{q ? `Results for “${q}”` : 'Recently added papers'}</h2></div><Link to="/evidence">Browse all</Link></div>
        <div className="stack">{loading ? <div className="card">Loading…</div> : works.map(work => <WorkCard key={work.id} work={work} />)}</div></section>
      <aside><div className="section-heading"><div><div className="eyebrow">Community</div><h2>Recent contributions</h2></div></div><ActivityList events={events} /></aside>
    </div>

    <section className="section-block"><div className="section-heading"><div><div className="eyebrow">Evidence Pages</div><h2>Living evidence and published snapshots</h2></div><Link to="/pages">Browse all</Link></div>
      <div className="card-grid">{evidencePages.map(v => v.kind === 'living' ? <article className="card link-card" key={`live-${v.id}`}><div className="eyebrow"><RadioTower size={14} /> Living evidence • {v.weighting?.toUpperCase()}</div><h3><Link to={`/live/${v.slug}`}>{v.title}</Link></h3><p>{v.description || 'A live synthesis that updates as consensus evidence changes.'}</p><div className="muted tiny">Updated {formatDate(v.updated_at)} • by <ProfileLink profile={v.owner} /></div></article> : <article className="card link-card" key={`review-${v.id}`}><div className="eyebrow"><FileCheck2 size={14} /> Frozen evidence snapshot</div><h3><Link to={`/review/${v.slug}`}>{v.title}</Link></h3><p>{v.abstract || 'A reproducible snapshot with frozen evidence and an audit trail.'}</p><div className="muted tiny">Published {formatDate(v.published_at)} • by <ProfileLink profile={v.owner} /></div></article>)}{!evidencePages.length && <div className="card muted">No public evidence pages yet.</div>}</div>
    </section>
  </>;
}
