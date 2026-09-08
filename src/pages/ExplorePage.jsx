import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { ActivityList, MetricCard, WorkCard } from '../components/Common';
import { compactNumber } from '../lib/identifiers';

async function hydrateActors(events) {
  const ids=[...new Set((events||[]).map(e=>e.actor_id).filter(Boolean))];
  if (!ids.length) return events||[];
  const {data}=await supabase.from('rse_profiles').select('id,username,display_name').in('id',ids);
  const map=new Map((data||[]).map(p=>[p.id,p]));
  return (events||[]).map(e=>({...e,actor:map.get(e.actor_id)}));
}

export default function ExplorePage() {
  const [metrics,setMetrics]=useState({});
  const [works,setWorks]=useState([]);
  const [reviews,setReviews]=useState([]);
  const [live,setLive]=useState([]);
  const [events,setEvents]=useState([]);
  const [q,setQ]=useState('');
  const [loading,setLoading]=useState(true);

  useEffect(()=>{ load(); },[]);
  async function load(search='') {
    setLoading(true);
    const worksQuery=supabase.from('rse_works').select('id,title,journal,publication_year,work_type,doi,created_at').eq('is_public',true).order('created_at',{ascending:false}).limit(12);
    if(search.trim()) worksQuery.ilike('title',`%${search.trim()}%`);
    const [m,w,r,l,a]=await Promise.all([
      supabase.rpc('rse_global_metrics'),
      worksQuery,
      supabase.from('rse_reviews').select('id,slug,title,review_type,abstract,published_at').eq('status','published').eq('visibility','public').order('published_at',{ascending:false}).limit(6),
      supabase.from('rse_live_views').select('id,slug,title,description,weighting,updated_at').eq('is_public',true).order('updated_at',{ascending:false}).limit(6),
      supabase.from('rse_activity_events').select('*').eq('is_public',true).order('created_at',{ascending:false}).limit(12),
    ]);
    setMetrics(m.data||{}); setWorks(w.data||[]); setReviews(r.data||[]); setLive(l.data||[]); setEvents(await hydrateActors(a.data||[])); setLoading(false);
  }

  return <>
    <section className="hero">
      <div className="eyebrow"><Sparkles size={15}/> Collaborative evidence, not isolated reviews</div>
      <h1>Build on evidence that has already been extracted.</h1>
      <p>Find papers, reuse structured endpoints, compare competing extractions, contribute appraisals, create reproducible reviews, and publish live bodies of evidence.</p>
      <form className="hero-search" onSubmit={e=>{e.preventDefault();load(q);}}>
        <Search size={19}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search the evidence commons..."/><button className="button primary">Search</button>
      </form>
      <div className="hero-actions"><Link className="button primary" to="/contribute">Contribute evidence</Link><Link className="button secondary" to="/synthesize">Build a comparison</Link></div>
    </section>

    <section className="metric-grid six">
      <MetricCard label="Papers" value={compactNumber(metrics.papers)}/><MetricCard label="Extracted endpoints" value={compactNumber(metrics.endpoints)}/>
      <MetricCard label="Evidence slots" value={compactNumber(metrics.evidence_slots)}/><MetricCard label="Appraisals" value={compactNumber(metrics.appraisals)}/>
      <MetricCard label="Contributors" value={compactNumber(metrics.contributors)}/><MetricCard label="Published reviews" value={compactNumber(metrics.published_reviews)}/>
    </section>

    <div className="two-column">
      <section><div className="section-heading"><div><div className="eyebrow">Evidence Commons</div><h2>{q ? `Results for “${q}”` : 'Recently added papers'}</h2></div><Link to="/evidence">Browse all</Link></div>
        <div className="stack">{loading?<div className="card">Loading…</div>:works.map(w=><WorkCard key={w.id} work={w}/>)}</div></section>
      <aside><div className="section-heading"><div><div className="eyebrow">Community</div><h2>Recent contributions</h2></div></div><ActivityList events={events}/></aside>
    </div>

    <section className="section-block"><div className="section-heading"><div><div className="eyebrow">Living evidence</div><h2>Live comparisons</h2></div><Link to="/synthesize">Create one</Link></div>
      <div className="card-grid">{live.map(v=><Link className="card link-card" key={v.id} to={`/live/${v.slug}`}><div className="eyebrow">{v.weighting?.toUpperCase()}</div><h3>{v.title}</h3><p>{v.description||'A live synthesis that updates as consensus evidence changes.'}</p></Link>)}{!live.length&&<div className="card muted">No public live views yet.</div>}</div>
    </section>

    <section className="section-block"><div className="section-heading"><div><div className="eyebrow">Published work</div><h2>Reviews built on the Commons</h2></div><Link to="/reviews">All reviews</Link></div>
      <div className="card-grid">{reviews.map(r=><Link className="card link-card" key={r.id} to={`/review/${r.slug}`}><div className="eyebrow">{r.review_type?.replaceAll('_',' ')}</div><h3>{r.title}</h3><p>{r.abstract||'Open the review to inspect its evidence and audit trail.'}</p></Link>)}{!reviews.length&&<div className="card muted">No public reviews yet.</div>}</div>
    </section>
  </>;
}
