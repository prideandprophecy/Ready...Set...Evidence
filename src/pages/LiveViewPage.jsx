import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Camera, Edit3, Trash2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { FavoriteButton, ProfileLink } from '../components/Common';
import { runSynthesis } from '../lib/synthesis';
import ForestPlot from '../components/ForestPlot';
import ZonedComparisonPlot from '../components/ZonedComparisonPlot';
import { formatDate } from '../lib/identifiers';
import { facetSummary } from '../components/FacetPicker';

function cohortTypeArray(value) {
  return value ? [value] : null;
}

function StudyList({ model }) {
  if (!model?.studies?.length) return <div className="muted">No usable studies.</div>;
  return <div className="stack compact">{model.studies.slice(0, 100).map(study => <div className="duplicate-row" key={study.workId}>
    <div><Link to={`/work/${study.workId}`}><strong>{study.label}</strong></Link><div className="muted tiny">{study.title}{study.cohortCount > 1 ? ` • ${study.cohortCount} cohorts merged` : ''}</div></div>
    <span className="muted tiny">{Number.isFinite(study.poolWeightPct) ? `${study.poolWeightPct.toFixed(1)}% weight` : ''}</span>
  </div>)}{model.studies.length > 100 && <div className="muted tiny">Showing the first 100 of {model.studies.length.toLocaleString()} included studies.</div>}</div>;
}

function Result({ title, rows, model, view, plotId }) {
  return <section className="section-block">
    <div className="section-heading"><div><div className="eyebrow">Living result</div><h2>{title}</h2></div></div>
    <div className="metric-grid"><div className="metric-card"><div className="metric-value">{model.k || 0}</div><div className="metric-label">Studies</div></div><div className="metric-card"><div className="metric-value">{rows.length.toLocaleString()}</div><div className="metric-label">Matched endpoint records</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.mean) ? model.mean.toFixed(3) : '—'}</div><div className="metric-label">Current pooled estimate</div></div></div>
    <div className="card"><ForestPlot studies={model.studies} pooled={model} title={`${title} forest plot`} plotId={plotId} rateScale={view.rate_scale} proportionAsPercent={view.proportion_as_percent} /></div>
    <div className="card"><h3>Included studies</h3><StudyList model={model} /></div>
  </section>;
}

export default function LiveViewPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [view, setView] = useState(null);
  const [rowsA, setRowsA] = useState([]);
  const [rowsB, setRowsB] = useState([]);
  const [overlapCount, setOverlapCount] = useState(0);
  const [message, setMessage] = useState('');
  const [snapshots, setSnapshots] = useState([]);

  useEffect(() => { load(); }, [slug, user?.id]);

  function common(v) {
    const f = v.filters || {};
    return {
      p_outcome_concept_id: v.outcome_concept_id,
      p_framework_id: v.appraisal_framework_id || null,
      p_org_id: v.visibility === 'organization' ? v.owner_org_id || null : null,
      p_include_private: Boolean(v.include_private),
      p_year_min: f.year_min || null,
      p_year_max: f.year_max || null,
      p_work_types: Array.isArray(f.work_types) && f.work_types.length ? f.work_types : null,
      p_study_designs: Array.isArray(f.study_designs) && f.study_designs.length ? f.study_designs : null,
    };
  }

  async function load() {
    setMessage('');
    setOverlapCount(0);
    const { data: v, error } = await supabase.from('rse_live_views').select('*,owner:rse_profiles!owner_user_id(username,display_name)').eq('slug', slug).single();
    if (error || !v) { setView(null); return; }
    setView(v);
    const { data: snapshotRows } = await supabase.from('rse_reviews').select('id,slug,title,version_tag,published_at,status').eq('source_live_view_id', v.id).order('snapshot_number', { ascending: false });
    setSnapshots(snapshotRows || []);
    const f = v.filters || {};

    try {
      if (f.compare_mode) {
        const { data, error: compareError } = await supabase.rpc('rse_get_synthesis_comparison_rows_v2', {
          ...common(v),
          p_facet_filters_a: f.facet_filters_a || {},
          p_cohort_types_a: cohortTypeArray(f.cohort_type_a || null),
          p_facet_filters_b: f.facet_filters_b || {},
          p_cohort_types_b: cohortTypeArray(f.cohort_type_b || null),
          p_exclude_overlap: f.exclude_overlap_from_b !== false,
          p_mixed_mode_a: f.mixed_mode_a || 'all',
          p_mixed_mode_b: f.mixed_mode_b || 'all',
          p_excluded_work_ids_a: Array.isArray(f.excluded_work_ids_a) && f.excluded_work_ids_a.length ? f.excluded_work_ids_a : null,
          p_excluded_work_ids_b: Array.isArray(f.excluded_work_ids_b) && f.excluded_work_ids_b.length ? f.excluded_work_ids_b : null,
        });
        if (compareError) throw compareError;
        let all = data || [];
        let a = all.filter(row => row.set_code === 'A');
        let b = all.filter(row => row.set_code === 'B');
        if (v.require_appraisal && v.appraisal_framework_id) {
          a = a.filter(row => Number.isFinite(Number(row.community_quality_score)));
          b = b.filter(row => Number.isFinite(Number(row.community_quality_score)));
        }
        setRowsA(a);
        setRowsB(b);
        setOverlapCount(Number(all[0]?.overlap_count) || 0);
      } else {
        const { data, error: rowsError } = await supabase.rpc('rse_get_synthesis_rows_v4', {
          ...common(v),
          p_facet_filters: f.facet_filters_a || {},
          p_cohort_types: cohortTypeArray(f.cohort_type_a || null),
          p_mixed_mode: f.mixed_mode_a || 'all',
          p_excluded_work_ids: Array.isArray(f.excluded_work_ids_a) && f.excluded_work_ids_a.length ? f.excluded_work_ids_a : null,
        });
        if (rowsError) throw rowsError;
        let a = data || [];
        if (v.require_appraisal && v.appraisal_framework_id) a = a.filter(row => Number.isFinite(Number(row.community_quality_score)));
        setRowsA(a);
        setRowsB([]);
      }
    } catch (err) {
      setMessage(err.message || 'Unable to load live evidence.');
    }
  }

  async function removePage() {
    if (!user || user.id !== view?.owner_user_id) return;
    if (!window.confirm(`Delete living evidence page “${view.title}”? This cannot be undone.`)) return;
    const { error } = await supabase.from('rse_live_views').delete().eq('id', view.id).eq('owner_user_id', user.id);
    if (error) setMessage(error.message);
    else navigate('/pages');
  }

  async function createSnapshot() {
    if (!user || user.id !== view?.owner_user_id) return;
    const title = window.prompt('Snapshot title', view.title);
    if (!title) return;
    const version = window.prompt('Snapshot version (optional; leave blank for automatic numbering)', '');
    if (version === null) return;
    setMessage('Creating frozen snapshot…');
    const { data: reviewId, error } = await supabase.rpc('rse_create_snapshot_from_live_view_v1', {
      p_live_view_id: view.id,
      p_title: title,
      p_version_tag: version.trim() || null,
    });
    if (error) { setMessage(error.message); return; }
    const { data: review, error: fetchError } = await supabase.from('rse_reviews').select('slug').eq('id', reviewId).single();
    if (fetchError) { setMessage(fetchError.message); return; }
    navigate(`/review/${review.slug}`);
  }

  const modelA = useMemo(() => view ? runSynthesis(rowsA, { weighting: view.weighting, rateScale: view.rate_scale, proportionAsPercent: view.proportion_as_percent }) : { studies: [] }, [view, rowsA]);
  const modelB = useMemo(() => view ? runSynthesis(rowsB, { weighting: view.weighting, rateScale: view.rate_scale, proportionAsPercent: view.proportion_as_percent }) : { studies: [] }, [view, rowsB]);

  if (!view) return <div className="empty-state">Evidence page not found.</div>;
  const f = view.filters || {};
  const isOwner = user?.id === view.owner_user_id;
  const labelA = f.label_a || 'Primary evidence';
  const labelB = f.label_b || 'Comparator evidence';

  return <section>
    <div className="page-title"><div><div className="eyebrow">Evidence Page • Living</div><h1>{view.title}</h1><p>{view.description}</p><div className="muted tiny">Updated from current consensus evidence whenever this page is opened • configuration saved {formatDate(view.updated_at)} • {view.weighting?.toUpperCase()} • by <ProfileLink profile={view.owner} /></div></div><div className="row-actions"><FavoriteButton targetType="live_view" targetId={view.id} />{isOwner && <Link className="button secondary" to={`/live/${view.slug}/edit`}><Edit3 size={15} /> Edit living page</Link>}{isOwner && <button className="button primary" onClick={createSnapshot}><Camera size={15} /> Create snapshot</button>}{isOwner && <button className="button ghost" onClick={removePage}><Trash2 size={15} /> Delete</button>}</div></div>
    {message && <div className="notice">{message}</div>}
    {f.compare_mode && f.exclude_overlap_from_b !== false && overlapCount > 0 && <div className="notice">{overlapCount.toLocaleString()} overlapping consensus endpoint{overlapCount === 1 ? '' : 's'} removed from {labelB} because the same endpoint also matched {labelA}.</div>}
    {f.compare_mode && <div className="card section-block"><ZonedComparisonPlot modelA={modelA} modelB={modelB} labelA={labelA} labelB={labelB} direction={f.outcome_direction || ''} rateScale={view.rate_scale} proportionAsPercent={view.proportion_as_percent} plotId={`live-zoned-${view.id}`} /></div>}
    <Result title={f.compare_mode ? labelA : 'Selected evidence'} rows={rowsA} model={modelA} view={view} plotId={`live-a-${view.id}`} />
    {f.compare_mode && <Result title={labelB} rows={rowsB} model={modelB} view={view} plotId={`live-b-${view.id}`} />}
    {Array.isArray(f.facets_a) && f.facets_a.length > 0 && <div className="subtle-callout"><strong>{labelA} facets:</strong> {facetSummary(f.facets_a.map(x => ({ ...x, canonical_label: x.label || x.canonical_label })))}.</div>}
    <div className="card section-block"><h2>Saved configuration</h2><div className="muted tiny">{f.mixed_mode_a === 'exclude' ? `${labelA}: mixed cohorts excluded` : f.mixed_mode_a === 'only' ? `${labelA}: mixed cohorts only` : `${labelA}: mixed and non-mixed cohorts`} {f.compare_mode ? ` • ${f.mixed_mode_b === 'exclude' ? `${labelB}: mixed cohorts excluded` : f.mixed_mode_b === 'only' ? `${labelB}: mixed cohorts only` : `${labelB}: mixed and non-mixed cohorts`}` : ''}{Array.isArray(f.study_designs) && f.study_designs.length ? ` • Study-design filters: ${f.study_designs.map(x => x.replaceAll('_',' ')).join(', ')}` : ''}{Array.isArray(f.work_types) && f.work_types.length ? ` • Source-type filters: ${f.work_types.map(x => x.replaceAll('_',' ')).join(', ')}` : ''}</div>{Array.isArray(f.excluded_works_a) && f.excluded_works_a.length > 0 && <div style={{ marginTop: 10 }}><strong className="tiny">Excluded from {labelA}</strong>{f.excluded_works_a.map(x => <div className="muted tiny" key={x.id}>{x.label || x.title || x.id}{x.reason ? ` — ${x.reason}` : ''}</div>)}</div>}{f.compare_mode && Array.isArray(f.excluded_works_b) && f.excluded_works_b.length > 0 && <div style={{ marginTop: 10 }}><strong className="tiny">Excluded from {labelB}</strong>{f.excluded_works_b.map(x => <div className="muted tiny" key={x.id}>{x.label || x.title || x.id}{x.reason ? ` — ${x.reason}` : ''}</div>)}</div>}</div>
    <div className="card section-block"><div className="section-heading"><div><div className="eyebrow">Reproducibility</div><h2>Frozen snapshots</h2><p className="muted tiny">Snapshots preserve the exact endpoint versions, evidence-set membership, appraisal aggregates, and living-page configuration captured at that time.</p></div>{isOwner && <button className="button secondary" onClick={createSnapshot}><Camera size={15} /> Create snapshot</button>}</div>{snapshots.map(x => <div className="duplicate-row" key={x.id}><div><Link to={`/review/${x.slug}`}>{x.title}</Link><div className="muted tiny">v{x.version_tag} • {x.published_at ? `captured ${formatDate(x.published_at)}` : x.status}</div></div></div>)}{!snapshots.length && <div className="muted">No snapshots have been created from this living page yet.</div>}</div>
  </section>;
}
