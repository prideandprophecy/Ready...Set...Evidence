import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Edit3, Trash2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { FavoriteButton, ProfileLink } from '../components/Common';
import { formatDate } from '../lib/identifiers';

export default function ReviewPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [review, setReview] = useState(null);
  const [works, setWorks] = useState([]);
  const [searches, setSearches] = useState([]);
  const [legacyFrozen, setLegacyFrozen] = useState([]);
  const [snapshotEvidence, setSnapshotEvidence] = useState([]);
  const [sourceLive, setSourceLive] = useState(null);
  const [org, setOrg] = useState(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [slug, user?.id]);

  async function load() {
    setLoading(true);
    const { data: r, error } = await supabase.from('rse_reviews').select('*,owner:rse_profiles!owner_user_id(username,display_name)').eq('slug', slug).maybeSingle();
    if (error || !r) { setReview(null); setLoading(false); return; }
    setReview(r);
    const [w, s, f, se, live, o] = await Promise.all([
      supabase.from('rse_review_work_links').select('decision,exclusion_reason,work:rse_works(id,title,publication_year,journal,visibility)').eq('review_id', r.id),
      supabase.from('rse_review_searches').select('*').eq('review_id', r.id).order('created_at'),
      supabase.from('rse_review_extraction_links').select('extraction_version_id,version:rse_extraction_versions(id,version_no,payload,created_at)').eq('review_id', r.id),
      supabase.from('rse_snapshot_evidence').select('extraction_version_id,set_code,work_id,community_quality_score,appraisal_count').eq('review_id', r.id),
      r.source_live_view_id ? supabase.from('rse_live_views').select('id,slug,title,description,updated_at').eq('id', r.source_live_view_id).maybeSingle() : Promise.resolve({ data: null }),
      r.owner_org_id ? supabase.from('rse_organizations').select('id,slug,name').eq('id', r.owner_org_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setWorks(w.data || []);
    setSearches(s.data || []);
    setLegacyFrozen(f.data || []);
    setSnapshotEvidence(se.data || []);
    setSourceLive(live.data || null);
    setOrg(o.data || null);
    setLoading(false);
  }

  const config = review?.snapshot_config || {};
  const filters = config.filters || {};
  const labelA = filters.label_a || 'Primary evidence';
  const labelB = filters.label_b || 'Comparator evidence';
  const snapshotCounts = useMemo(() => ({
    A: snapshotEvidence.filter(x => x.set_code === 'A').length,
    B: snapshotEvidence.filter(x => x.set_code === 'B').length,
  }), [snapshotEvidence]);

  async function fork() {
    if (!user) return navigate('/auth');
    const { data, error } = await supabase.rpc('rse_fork_review', { p_review_id: review.id });
    if (error) setMsg(error.message);
    else {
      const { data: r } = await supabase.from('rse_reviews').select('slug').eq('id', data).single();
      navigate(`/review/${r.slug}/edit`);
    }
  }

  async function removeReview() {
    if (!user || user.id !== review?.owner_user_id) return;
    const warning = review.status === 'published'
      ? `Permanently delete frozen evidence snapshot “${review.title}”? Its frozen evidence links and audit records will also be deleted. This cannot be undone.`
      : `Delete review workspace “${review.title}”? This cannot be undone.`;
    if (!window.confirm(warning)) return;
    const { error } = await supabase.from('rse_reviews').delete().eq('id', review.id).eq('owner_user_id', user.id);
    if (error) setMsg(error.message); else navigate('/pages');
  }

  if (loading) return <div className="empty-state">Loading evidence page…</div>;
  if (!review) return <div className="empty-state">Evidence page not found or you do not have access.</div>;
  const canEdit = user?.id === review.owner_user_id;
  const isFrozenSnapshot = review.status === 'published' && Boolean(review.frozen_at);
  const frozenEndpointCount = snapshotEvidence.length || legacyFrozen.length;

  return <section>
    <div className="page-title"><div><div className="eyebrow">Evidence Page • {isFrozenSnapshot ? 'Frozen snapshot' : 'Review workspace'} • v{review.version_tag} • {review.visibility}</div><h1>{review.title}</h1><p>{review.research_question}</p><div className="muted tiny">{review.published_at ? `Captured ${formatDate(review.published_at)}` : 'Draft'} {review.frozen_at ? `• Evidence frozen ${formatDate(review.frozen_at)}` : ''}{org ? <> • <Link to={`/org/${org.slug}`}>{org.name}</Link></> : null} • by <ProfileLink profile={review.owner} /></div>{sourceLive && <div className="muted tiny">Snapshot of living Evidence Page: <Link to={`/live/${sourceLive.slug}`}>{sourceLive.title}</Link></div>}</div><div className="row-actions"><FavoriteButton targetType="review" targetId={review.id} />{canEdit && <Link className="button secondary" to={`/review/${slug}/edit`}><Edit3 size={15} /> {isFrozenSnapshot ? 'Edit snapshot details' : 'Edit'}</Link>}{sourceLive && <Link className="button primary" to={`/live/${sourceLive.slug}`}>Open living page</Link>}{!sourceLive && <button className="button ghost" onClick={fork}>Fork</button>}{canEdit && <button className="button ghost" onClick={removeReview}><Trash2 size={15} /> Delete</button>}</div></div>
    {msg && <div className="notice">{msg}</div>}
    {isFrozenSnapshot && <div className="subtle-callout"><strong>Frozen evidence is immutable.</strong> You can edit this snapshot's title, summary, methods, search audit, and visibility, but changing the underlying evidence requires editing the living page and creating a new snapshot.</div>}

    <div className="metric-grid">
      <div className="metric-card"><div className="metric-value">{frozenEndpointCount}</div><div className="metric-label">Frozen endpoint versions</div></div>
      {snapshotEvidence.length > 0 && <div className="metric-card"><div className="metric-value">{snapshotCounts.A}</div><div className="metric-label">{labelA}</div></div>}
      {snapshotEvidence.length > 0 && filters.compare_mode && <div className="metric-card"><div className="metric-value">{snapshotCounts.B}</div><div className="metric-label">{labelB}</div></div>}
      {review.snapshot_number && <div className="metric-card"><div className="metric-value">#{review.snapshot_number}</div><div className="metric-label">Snapshot number</div></div>}
    </div>

    <div className="two-column"><section>
      <div className="card"><h2>Abstract / summary</h2><p>{review.abstract || 'Not provided.'}</p></div>
      <div className="card"><h2>Methods and protocol</h2><h3>Protocol</h3><p className="prewrap">{review.protocol_text || 'Not provided.'}</p><h3>Methods</h3><p className="prewrap">{review.methods_text || 'Not provided.'}</p><h3>Inclusion criteria</h3><p className="prewrap">{review.inclusion_criteria || 'Not provided.'}</p><h3>Exclusion criteria</h3><p className="prewrap">{review.exclusion_criteria || 'Not provided.'}</p></div>
      <div className="card"><h2>Included and excluded works</h2>{works.map(x => <div className="duplicate-row" key={x.work?.id || `${x.decision}-${x.exclusion_reason}`}><div>{x.work ? <Link to={`/work/${x.work.id}`}>{x.work.title}</Link> : <span>Restricted work</span>}<div className="muted tiny">{x.work?.publication_year || ''} • {x.decision}{x.work?.visibility ? ` • ${x.work.visibility}` : ''}{x.exclusion_reason ? ` • ${x.exclusion_reason}` : ''}</div></div></div>)}{!works.length && <div className="muted">No linked works.</div>}</div>
    </section><aside>
      {sourceLive && <div className="card"><h2>Snapshot configuration</h2><p className="muted tiny">Captured from <Link to={`/live/${sourceLive.slug}`}>{sourceLive.title}</Link>. This configuration is preserved with the snapshot.</p><div className="stack compact"><div><strong>Weighting:</strong> {config.weighting || '—'}</div><div><strong>Appraisal required:</strong> {config.require_appraisal ? 'Yes' : 'No'}</div><div><strong>Comparison:</strong> {filters.compare_mode ? `${labelA} vs ${labelB}` : labelA}</div>{Array.isArray(filters.study_designs) && filters.study_designs.length > 0 && <div><strong>Study designs:</strong> {filters.study_designs.map(x => x.replaceAll('_', ' ')).join(', ')}</div>}{Array.isArray(filters.work_types) && filters.work_types.length > 0 && <div><strong>Source types:</strong> {filters.work_types.map(x => x.replaceAll('_', ' ')).join(', ')}</div>}{Array.isArray(filters.excluded_works_a) && filters.excluded_works_a.length > 0 && <div><strong>Excluded from {labelA}:</strong> {filters.excluded_works_a.map(x => `${x.label || x.title || x.id}${x.reason ? ` (${x.reason})` : ''}`).join('; ')}</div>}{filters.compare_mode && Array.isArray(filters.excluded_works_b) && filters.excluded_works_b.length > 0 && <div><strong>Excluded from {labelB}:</strong> {filters.excluded_works_b.map(x => `${x.label || x.title || x.id}${x.reason ? ` (${x.reason})` : ''}`).join('; ')}</div>}</div></div>}
      <div className="card"><h2>Search audit</h2>{searches.map(s => <div className="search-record" key={s.id}><strong>{s.database_name}</strong><div className="muted tiny">Run {s.date_run || 'date not recorded'} • {s.result_count ?? '—'} results</div><pre>{s.search_string}</pre></div>)}{!searches.length && <div className="muted">No searches recorded.</div>}</div>
      <div className="card"><h2>Frozen evidence</h2><p><strong>{frozenEndpointCount}</strong> endpoint versions preserved for this snapshot.</p><p className="muted tiny">Frozen versions do not change when the living Commons is corrected later. Public snapshots freeze only public evidence; organization snapshots may include evidence shared with that organization.</p></div>
    </aside></div>
  </section>;
}
