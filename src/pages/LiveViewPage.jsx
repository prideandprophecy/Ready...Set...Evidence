import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { runSynthesis } from '../lib/synthesis';
import ForestPlot from '../components/ForestPlot';
import { formatDate } from '../lib/identifiers';
import { facetSummary } from '../components/FacetPicker';

function cohortTypeArray(value) {
  return value ? [value] : null;
}

function Result({ title, rows, model }) {
  return <section className="section-block">
    <div className="section-heading"><div><div className="eyebrow">Live result</div><h2>{title}</h2></div></div>
    <div className="metric-grid"><div className="metric-card"><div className="metric-value">{model.k || 0}</div><div className="metric-label">Studies</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.mean) ? model.mean.toFixed(3) : '—'}</div><div className="metric-label">Current pooled estimate</div></div></div>
    <div className="card"><ForestPlot studies={model.studies} pooled={model} /></div>
    <div className="card"><h3>Current evidence</h3>{rows.map(r => <div className="duplicate-row" key={`${r.extraction_id}-${r.cohort_id}`}><div><strong>{r.work_title}</strong><div className="muted tiny">{r.cohort_label}{Array.isArray(r.facets) && r.facets.length ? ` • ${facetSummary(r.facets.map(x => ({ ...x, canonical_label: x.label || x.canonical_label })))}` : ''}</div></div><span className="muted tiny">{r.publication_year || ''}</span></div>)}</div>
  </section>;
}

export default function LiveViewPage() {
  const { slug } = useParams();
  const [view, setView] = useState(null);
  const [rowsA, setRowsA] = useState([]);
  const [rowsB, setRowsB] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => { load(); }, [slug]);

  async function fetchRows(v, facetFilters, cohortType) {
    const f = v.filters || {};
    const { data, error } = await supabase.rpc('rse_get_synthesis_rows_v2', {
      p_outcome_concept_id: v.outcome_concept_id,
      p_framework_id: v.appraisal_framework_id || null,
      p_org_id: v.visibility === 'organization' ? v.owner_org_id || null : null,
      p_include_private: Boolean(v.include_private),
      p_facet_filters: facetFilters || {},
      p_cohort_types: cohortTypeArray(cohortType),
      p_year_min: f.year_min || null,
      p_year_max: f.year_max || null,
    });
    if (error) throw error;
    let rows = data || [];
    // Backward compatibility for live views created before structured facets.
    if (f.cohort_contains) {
      const q = String(f.cohort_contains).toLowerCase();
      rows = rows.filter(r => `${r.cohort_label || ''} ${r.intervention || ''}`.toLowerCase().includes(q));
    }
    if (v.require_appraisal && v.appraisal_framework_id) rows = rows.filter(r => Number.isFinite(Number(r.community_quality_score)));
    return rows;
  }

  async function load() {
    setMessage('');
    const { data: v, error } = await supabase.from('rse_live_views').select('*').eq('slug', slug).single();
    if (error || !v) { setView(null); return; }
    setView(v);
    const f = v.filters || {};
    try {
      const a = await fetchRows(v, f.facet_filters_a || {}, f.cohort_type_a || null);
      const b = f.compare_mode ? await fetchRows(v, f.facet_filters_b || {}, f.cohort_type_b || null) : [];
      setRowsA(a);
      setRowsB(b);
    } catch (err) {
      setMessage(err.message || 'Unable to load live evidence.');
    }
  }

  const modelA = useMemo(() => view ? runSynthesis(rowsA, { weighting: view.weighting, rateScale: view.rate_scale, proportionAsPercent: view.proportion_as_percent }) : { studies: [] }, [view, rowsA]);
  const modelB = useMemo(() => view ? runSynthesis(rowsB, { weighting: view.weighting, rateScale: view.rate_scale, proportionAsPercent: view.proportion_as_percent }) : { studies: [] }, [view, rowsB]);

  if (!view) return <div className="empty-state">Live view not found.</div>;
  const f = view.filters || {};

  return <section>
    <div className="page-title"><div><div className="eyebrow">Live body of evidence</div><h1>{view.title}</h1><p>{view.description}</p><div className="muted tiny">Updated from current consensus evidence whenever this page is opened • configuration saved {formatDate(view.updated_at)} • {view.weighting?.toUpperCase()}</div></div></div>
    {message && <div className="notice">{message}</div>}
    {f.compare_mode && <div className="subtle-callout">This page compares two independently filtered evidence sets side by side. It does not convert them into a head-to-head comparative effect unless such an effect is explicitly extracted in a future comparative-outcome model.</div>}
    <Result title={f.label_a || 'Selected evidence'} rows={rowsA} model={modelA} />
    {f.compare_mode && <Result title={f.label_b || 'Comparison evidence'} rows={rowsB} model={modelB} />}
  </section>;
}
