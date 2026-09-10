import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { runSynthesis } from '../lib/synthesis';
import ForestPlot from '../components/ForestPlot';
import { formatDate } from '../lib/identifiers';
import { useAuth } from '../context/AuthContext';

export default function LiveViewPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [view, setView] = useState(null);
  const [rows, setRows] = useState([]);
  const [framework, setFramework] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, [slug, user?.id]);

  async function load() {
    setLoading(true); setError('');
    const { data: v, error: ve } = await supabase.from('rse_live_views').select('*').eq('slug', slug).maybeSingle();
    if (ve || !v) { setView(null); setError(ve?.message || 'Live view not found or you do not have access.'); setLoading(false); return; }
    setView(v);

    const [r, f] = await Promise.all([
      supabase.rpc('rse_get_synthesis_rows', {
        p_outcome_concept_id: v.outcome_concept_id,
        p_framework_id: v.appraisal_framework_id || null,
        p_org_id: v.visibility === 'organization' ? v.owner_org_id : null,
        p_include_private: Boolean(v.visibility === 'private' && v.include_private),
      }),
      v.appraisal_framework_id ? supabase.from('rse_appraisal_frameworks').select('id,name').eq('id', v.appraisal_framework_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (r.error) setError(r.error.message);
    setRows(r.data || []);
    setFramework(f.data || null);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!view) return [];
    const f = view.filters || {};
    return rows.filter(r =>
      (!f.cohort_contains || `${r.cohort_label || ''} ${r.intervention || ''}`.toLowerCase().includes(String(f.cohort_contains).toLowerCase())) &&
      (!f.year_min || r.publication_year >= f.year_min) &&
      (!f.year_max || r.publication_year <= f.year_max) &&
      (!view.require_appraisal || Number.isFinite(Number(r.community_quality_score)))
    );
  }, [view, rows]);

  const model = useMemo(() => view ? runSynthesis(filtered, { weighting: view.weighting, rateScale: view.rate_scale, proportionAsPercent: view.proportion_as_percent }) : { studies: [] }, [view, filtered]);

  if (loading) return <div className="empty-state">Loading live evidence…</div>;
  if (!view) return <div className="empty-state">{error || 'Live view not found.'}</div>;

  return <section>
    <div className="page-title"><div><div className="eyebrow">Live body of evidence • {view.visibility || (view.is_public ? 'public' : 'private')}</div><h1>{view.title}</h1><p>{view.description}</p><div className="muted tiny">Updated from current consensus evidence whenever this page is opened • configuration saved {formatDate(view.updated_at)}{framework ? ` • appraisal: ${framework.name}` : ''}</div></div></div>
    {error && <div className="notice">{error}</div>}
    <div className="metric-grid"><div className="metric-card"><div className="metric-value">{model.k || 0}</div><div className="metric-label">Studies</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.mean) ? model.mean.toFixed(3) : '—'}</div><div className="metric-label">Current pooled estimate</div></div><div className="metric-card"><div className="metric-value">{view.weighting.toUpperCase()}</div><div className="metric-label">Weighting</div></div><div className="metric-card"><div className="metric-value">{framework?.name || 'None'}</div><div className="metric-label">Appraisal framework</div></div></div>
    <div className="card"><ForestPlot studies={model.studies} pooled={model} /></div>
  </section>;
}
