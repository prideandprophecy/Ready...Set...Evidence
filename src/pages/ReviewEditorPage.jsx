import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { DoiLink, RequireAuth } from '../components/Common';

export default function ReviewEditorPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [review, setReview] = useState(null);
  const [sourceLive, setSourceLive] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [found, setFound] = useState([]);
  const [links, setLinks] = useState([]);
  const [searches, setSearches] = useState([]);
  const [newSearch, setNewSearch] = useState({ database_name: 'PubMed', search_string: '', date_run: '', result_count: '' });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (user) load(); }, [slug, user?.id]);
  if (!user) return <RequireAuth />;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('rse_reviews').select('*').eq('slug', slug).maybeSingle();
    if (error || !data) { setReview(null); setLoading(false); return; }
    setReview(data);
    const [l, s, live] = await Promise.all([
      supabase.from('rse_review_work_links').select('*,work:rse_works(id,title,publication_year,journal,doi)').eq('review_id', data.id),
      supabase.from('rse_review_searches').select('*').eq('review_id', data.id).order('created_at'),
      data.source_live_view_id
        ? supabase.from('rse_live_views').select('id,slug,title').eq('id', data.source_live_view_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setLinks(l.data || []);
    setSearches(s.data || []);
    setSourceLive(live.data || null);
    setLoading(false);
  }

  const frozenSnapshot = Boolean(review?.status === 'published' && review?.frozen_at);
  const fromLivingPage = Boolean(review?.source_live_view_id);

  async function save() {
    if (!review) return;
    setMsg('');
    const payload = {
      title: review.title,
      research_question: review.research_question,
      abstract: review.abstract,
      protocol_text: review.protocol_text,
      methods_text: review.methods_text,
      inclusion_criteria: review.inclusion_criteria,
      exclusion_criteria: review.exclusion_criteria,
      visibility: review.visibility,
    };
    if (!frozenSnapshot) {
      payload.review_type = review.review_type;
      payload.version_tag = review.version_tag;
    }
    const { error } = await supabase.from('rse_reviews').update(payload).eq('id', review.id).eq('owner_user_id', user.id);
    setMsg(error ? error.message : frozenSnapshot ? 'Snapshot description and methods saved. Frozen evidence was not changed.' : 'Review workspace saved.');
  }

  async function findWorks() {
    if (!searchQ.trim()) { setFound([]); return; }
    const { data, error } = await supabase.rpc('rse_search_public_works', {
      p_query: searchQ.trim(), p_year: null, p_limit: 20, p_offset: 0,
    });
    if (error) setMsg(error.message); else setFound(data || []);
  }

  async function addWork(work) {
    if (frozenSnapshot) return;
    const { error } = await supabase.from('rse_review_work_links').upsert({ review_id: review.id, work_id: work.id, decision: 'include', added_by: user.id });
    if (error) setMsg(error.message); else load();
  }

  async function setDecision(link, decision) {
    if (frozenSnapshot) return;
    const reason = decision === 'exclude' ? window.prompt('Exclusion reason') || 'Not specified' : null;
    const { error } = await supabase.from('rse_review_work_links').update({ decision, exclusion_reason: reason }).eq('review_id', review.id).eq('work_id', link.work_id);
    if (error) setMsg(error.message); else load();
  }

  async function addSearch(e) {
    e.preventDefault();
    const { error } = await supabase.from('rse_review_searches').insert({
      review_id: review.id,
      database_name: newSearch.database_name,
      search_string: newSearch.search_string,
      date_run: newSearch.date_run || null,
      result_count: newSearch.result_count ? Number(newSearch.result_count) : null,
      created_by: user.id,
    });
    if (error) setMsg(error.message);
    else {
      setNewSearch({ database_name: 'PubMed', search_string: '', date_run: '', result_count: '' });
      load();
    }
  }

  async function publishLegacyReview() {
    if (!review || frozenSnapshot) return;
    await save();
    const { error: snapshotError } = await supabase.rpc('rse_snapshot_review', { p_review_id: review.id });
    if (snapshotError) { setMsg(snapshotError.message); return; }
    const { error } = await supabase.from('rse_reviews').update({
      status: 'published',
      visibility: review.visibility === 'private' ? 'public' : review.visibility,
      published_at: new Date().toISOString(),
    }).eq('id', review.id);
    if (error) setMsg(error.message); else navigate(`/review/${review.slug}`);
  }

  if (loading) return <div className="empty-state">Loading evidence snapshot…</div>;
  if (!review) return <div className="empty-state">Evidence snapshot not found.</div>;
  if (review.owner_user_id !== user.id) return <div className="empty-state">You do not have edit access to this evidence page.</div>;

  return <section>
    <div className="page-title"><div><div className="eyebrow">Evidence Page • {frozenSnapshot ? 'Frozen snapshot' : 'Review workspace'}</div><h1>{review.title}</h1>{frozenSnapshot && <p className="muted">You can correct the title, interpretation, methods, and other descriptive metadata. The evidence versions and evidence-set membership captured by this snapshot are immutable. Create a new snapshot from the living page when the underlying evidence configuration changes.</p>}{sourceLive && <div className="muted tiny">Snapshot of <Link to={`/live/${sourceLive.slug}`}>{sourceLive.title}</Link></div>}</div><div className="row-actions"><button className="button secondary" onClick={save}>Save changes</button>{sourceLive && <Link className="button primary" to={`/live/${sourceLive.slug}`}>Open living page</Link>}{!frozenSnapshot && <button className="button primary" onClick={publishLegacyReview}>Freeze evidence and publish</button>}<button className="button ghost" onClick={() => navigate(`/review/${review.slug}`)}>Done</button></div></div>
    {msg && <div className="notice">{msg}</div>}

    <div className="two-column"><section>
      <div className="card form-stack">
        <label>Title<input value={review.title || ''} onChange={e => setReview({ ...review, title: e.target.value })} /></label>
        {!frozenSnapshot && <label>Review type<select value={review.review_type || 'systematic_review'} onChange={e => setReview({ ...review, review_type: e.target.value })}><option value="systematic_review">Systematic review</option><option value="rapid_review">Rapid review</option><option value="scoping_review">Scoping review</option><option value="live_review">Live review</option><option value="comparison">Comparison</option></select></label>}
        <label>Research question<textarea rows="2" value={review.research_question || ''} onChange={e => setReview({ ...review, research_question: e.target.value })} /></label>
        <label>Abstract / summary<textarea rows="4" value={review.abstract || ''} onChange={e => setReview({ ...review, abstract: e.target.value })} /></label>
        <label>Protocol<textarea rows="5" value={review.protocol_text || ''} onChange={e => setReview({ ...review, protocol_text: e.target.value })} /></label>
        <label>Methods<textarea rows="5" value={review.methods_text || ''} onChange={e => setReview({ ...review, methods_text: e.target.value })} /></label>
        <label>Inclusion criteria<textarea rows="3" value={review.inclusion_criteria || ''} onChange={e => setReview({ ...review, inclusion_criteria: e.target.value })} /></label>
        <label>Exclusion criteria<textarea rows="3" value={review.exclusion_criteria || ''} onChange={e => setReview({ ...review, exclusion_criteria: e.target.value })} /></label>
        <label>Visibility<select value={review.visibility || 'private'} onChange={e => setReview({ ...review, visibility: e.target.value })}><option value="private">Private</option>{review.owner_org_id && <option value="organization">Organization</option>}<option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
        {!frozenSnapshot && <label>Version<input value={review.version_tag || ''} onChange={e => setReview({ ...review, version_tag: e.target.value })} /></label>}
      </div>

      <div className="card">
        <h2>{frozenSnapshot ? 'Frozen evidence membership' : 'Review evidence set'}</h2>
        {frozenSnapshot && <p className="muted tiny">These paper links describe the evidence captured when the snapshot was created. They cannot be added, removed, or reclassified from this editor.</p>}
        {!frozenSnapshot && <><div className="inline-form"><input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Find by title, author, DOI, PMID, journal..." /><button type="button" className="button secondary" onClick={findWorks}>Find</button></div>{found.map(w => <div className="duplicate-row" key={w.id}><div>{w.title}<div className="muted tiny">{[w.first_author, w.publication_year, w.journal].filter(Boolean).join(' • ')}{w.doi ? <> • <DoiLink doi={w.doi} /></> : null}</div></div><button type="button" className="button mini" onClick={() => addWork(w)}>Add</button></div>)}</>}
        <h3>{frozenSnapshot ? 'Captured works' : 'Linked works'}</h3>
        {links.map(x => <div className="duplicate-row" key={x.work_id}><div>{x.work?.title || 'Restricted work'}<div className="muted tiny">{x.work?.publication_year || ''}{x.work?.doi ? <> • <DoiLink doi={x.work.doi} /></> : null} • {x.decision}{x.exclusion_reason ? ` • ${x.exclusion_reason}` : ''}</div></div>{!frozenSnapshot && <div className="row-actions"><button type="button" className="button mini" onClick={() => setDecision(x, 'include')}>Include</button><button type="button" className="button mini ghost" onClick={() => setDecision(x, 'exclude')}>Exclude</button></div>}</div>)}
        {!links.length && <div className="muted">No linked works.</div>}
      </div>
    </section><aside>
      <form className="card form-stack" onSubmit={addSearch}><h2>Add literature-search record</h2><p className="muted tiny">Search audit records are descriptive provenance. Adding one to a frozen snapshot does not alter its frozen evidence.</p><label>Database<input value={newSearch.database_name} onChange={e => setNewSearch({ ...newSearch, database_name: e.target.value })} /></label><label>Search string<textarea required rows="6" value={newSearch.search_string} onChange={e => setNewSearch({ ...newSearch, search_string: e.target.value })} /></label><label>Date run<input type="date" value={newSearch.date_run} onChange={e => setNewSearch({ ...newSearch, date_run: e.target.value })} /></label><label>Result count<input inputMode="numeric" value={newSearch.result_count} onChange={e => setNewSearch({ ...newSearch, result_count: e.target.value })} /></label><button className="button secondary">Add search record</button></form>
      <div className="card"><h2>Recorded searches</h2>{searches.map(s => <div className="search-record" key={s.id}><strong>{s.database_name}</strong><div className="muted tiny">{s.date_run || 'Date not recorded'} • {s.result_count ?? '—'} results</div><pre>{s.search_string}</pre></div>)}{!searches.length && <div className="muted">No searches recorded.</div>}</div>
    </aside></div>
  </section>;
}
