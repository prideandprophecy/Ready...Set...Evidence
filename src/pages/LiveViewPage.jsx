import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
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
    };
  }

  async function load() {
    setMessage('');
    setOverlapCount(0);
    const { data: v, error } = await supabase.from('rse_live_views').select('*,owner:rse_profiles!owner_user_id(username,display_name)').eq('slug', slug).single();
    if (error || !v) { setView(null); return; }
    setView(v);
    const f = v.filters || {};

    try {
      if (f.compare_mode) {
        const { data, error: compareError } = await supabase.rpc('rse_get_synthesis_comparison_rows_v1', {
          ...common(v),
          p_facet_filters_a: f.facet_filters_a || {},
          p_cohort_types_a: cohortTypeArray(f.cohort_type_a || null),
          p_facet_filters_b: f.facet_filters_b || {},
          p_cohort_types_b: cohortTypeArray(f.cohort_type_b || null),
          p_exclude_overlap: f.exclude_overlap_from_b !== false,
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
        const { data, error: rowsError } = await supabase.rpc('rse_get_synthesis_rows_v3', {
          ...common(v),
          p_facet_filters: f.facet_filters_a || {},
          p_cohort_types: cohortTypeArray(f.cohort_type_a || null),
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

  const modelA = useMemo(() => view ? runSynthesis(rowsA, { weighting: view.weighting, rateScale: view.rate_scale, proportionAsPercent: view.proportion_as_percent }) : { studies: [] }, [view, rowsA]);
  const modelB = useMemo(() => view ? runSynthesis(rowsB, { weighting: view.weighting, rateScale: view.rate_scale, proportionAsPercent: view.proportion_as_percent }) : { studies: [] }, [view, rowsB]);

  if (!view) return <div className="empty-state">Evidence page not found.</div>;
  const f = view.filters || {};
  const isOwner = user?.id === view.owner_user_id;

  return <section>
    <div className="page-title"><div><div className="eyebrow">Evidence Page • Living</div><h1>{view.title}</h1><p>{view.description}</p><div className="muted tiny">Updated from current consensus evidence whenever this page is opened • configuration saved {formatDate(view.updated_at)} • {view.weighting?.toUpperCase()} • by <ProfileLink profile={view.owner} /></div></div><div className="row-actions"><FavoriteButton targetType="live_view" targetId={view.id} />{isOwner && <button className="button ghost" onClick={removePage}><Trash2 size={15} /> Delete</button>}</div></div>
    {message && <div className="notice">{message}</div>}
    {f.compare_mode && f.exclude_overlap_from_b !== false && overlapCount > 0 && <div className="notice">{overlapCount.toLocaleString()} overlapping consensus endpoint{overlapCount === 1 ? '' : 's'} removed from {f.label_b || 'Set B'} because the same endpoint also matched {f.label_a || 'Set A'}.</div>}
    {f.compare_mode && <div className="card section-block"><ZonedComparisonPlot modelA={modelA} modelB={modelB} labelA={f.label_a || 'Evidence set A'} labelB={f.label_b || 'Evidence set B'} direction={f.outcome_direction || ''} rateScale={view.rate_scale} proportionAsPercent={view.proportion_as_percent} plotId={`live-zoned-${view.id}`} /></div>}
    <Result title={f.label_a || 'Selected evidence'} rows={rowsA} model={modelA} view={view} plotId={`live-a-${view.id}`} />
    {f.compare_mode && <Result title={f.label_b || 'Comparison evidence'} rows={rowsB} model={modelB} view={view} plotId={`live-b-${view.id}`} />}
    {Array.isArray(f.facets_a) && f.facets_a.length > 0 && <div className="subtle-callout"><strong>Set A facets:</strong> {facetSummary(f.facets_a.map(x => ({ ...x, canonical_label: x.label || x.canonical_label })))}.</div>}
  </section>;
}
