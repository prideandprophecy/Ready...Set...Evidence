import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import ForestPlot from '../components/ForestPlot';
import { RATE_SCALE_OPTIONS, WEIGHTING_OPTIONS, runSynthesis } from '../lib/synthesis';
import { slugify } from '../lib/identifiers';

export default function SynthesizePage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [frameworks, setFrameworks] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [outcome, setOutcome] = useState('');
  const [frameworkId, setFrameworkId] = useState('');
  const [cohort, setCohort] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [weighting, setWeighting] = useState('raw');
  const [rateScale, setRateScale] = useState('per_1000_days');
  const [percent, setPercent] = useState(true);
  const [scope, setScope] = useState('public');
  const [orgId, setOrgId] = useState('');
  const [includePrivate, setIncludePrivate] = useState(false);
  const [requireAppraisal, setRequireAppraisal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { loadOptions(); }, [user?.id]);
  useEffect(() => { if (outcome) loadRows(); }, [outcome, frameworkId, scope, orgId, includePrivate]);

  async function loadOptions() {
    const [c, f, o] = await Promise.all([
      supabase.from('rse_outcome_concepts').select('id,label,default_outcome_type').order('label'),
      supabase.from('rse_appraisal_frameworks').select('id,name,slug,description').eq('is_public', true).order('name'),
      user ? supabase.from('rse_org_members').select('org:rse_organizations(id,name)').eq('user_id', user.id).eq('status', 'active') : Promise.resolve({ data: [] }),
    ]);
    setConcepts(c.data || []);
    setFrameworks(f.data || []);
    setOrgs((o.data || []).map(x => x.org).filter(Boolean));
    if (!outcome && c.data?.[0]) setOutcome(c.data[0].id);
    const preferred = (f.data || []).find(x => x.slug === 'rse-custom') || f.data?.[0];
    if (!frameworkId && preferred) setFrameworkId(preferred.id);
  }

  async function loadRows() {
    if (!outcome) return;
    setLoading(true);
    setMsg('');
    const selectedOrg = scope === 'organization' ? orgId || null : null;
    const { data, error } = await supabase.rpc('rse_get_synthesis_rows', {
      p_outcome_concept_id: outcome,
      p_framework_id: frameworkId || null,
      p_org_id: selectedOrg,
      p_include_private: Boolean(includePrivate && user),
    });
    if (error) setMsg(error.message);
    setRows(data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (cohort && !(r.cohort_label || '').toLowerCase().includes(cohort.toLowerCase()) && !(r.intervention || '').toLowerCase().includes(cohort.toLowerCase())) return false;
    if (yearMin && Number(r.publication_year) < Number(yearMin)) return false;
    if (yearMax && Number(r.publication_year) > Number(yearMax)) return false;
    if (requireAppraisal && frameworkId && !Number.isFinite(Number(r.community_quality_score))) return false;
    return true;
  }), [rows, cohort, yearMin, yearMax, requireAppraisal, frameworkId]);

  const model = useMemo(() => runSynthesis(filtered, { weighting, rateScale, proportionAsPercent: percent }), [filtered, weighting, rateScale, percent]);
  const type = filtered[0]?.outcome_type;
  const suffix = type === 'proportion' && percent ? '%' : type === 'rate' ? ` (${RATE_SCALE_OPTIONS.find(x => x[0] === rateScale)?.[1]})` : '';
  const selectedFramework = frameworks.find(x => x.id === frameworkId);

  async function saveLive() {
    if (!user) { setMsg('Sign in to save a live comparison.'); return; }
    const title = window.prompt('Title for this live evidence page', concepts.find(x => x.id === outcome)?.label || 'Live evidence');
    if (!title) return;

    const liveVisibility = scope === 'organization' ? 'organization' : includePrivate ? 'private' : 'public';
    const liveOrgId = liveVisibility === 'organization' ? orgId : null;
    if (liveVisibility === 'organization' && !liveOrgId) { setMsg('Select an organization before saving an organization live view.'); return; }

    const payload = {
      slug: `${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      description: 'Live synthesis from current consensus evidence in Ready...Set...Evidence.',
      outcome_concept_id: outcome,
      filters: { cohort_contains: cohort || null, year_min: yearMin ? Number(yearMin) : null, year_max: yearMax ? Number(yearMax) : null },
      weighting,
      rate_scale: rateScale,
      proportion_as_percent: percent,
      owner_user_id: user.id,
      owner_org_id: liveOrgId,
      visibility: liveVisibility,
      is_public: liveVisibility === 'public',
      appraisal_framework_id: frameworkId || null,
      require_appraisal: Boolean(requireAppraisal),
      include_private: Boolean(liveVisibility === 'private' && includePrivate),
    };
    const { data, error } = await supabase.from('rse_live_views').insert(payload).select().single();
    setMsg(error ? error.message : `Live view created: /live/${data.slug}`);
  }

  return <section>
    <div className="page-title"><div><div className="eyebrow">Reusable synthesis</div><h1>Build a comparison from shared or private evidence</h1><p>Choose the appraisal framework used by RAW. Each contributor's appraisal is the arithmetic mean of that framework's domain scores; the study-level community appraisal is the mean of those independent appraisals.</p></div></div>

    <div className="card filter-grid">
      <label>Outcome<select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="">Select outcome</option>{concepts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Evidence scope<select value={scope} onChange={e => { setScope(e.target.value); if (e.target.value !== 'organization') setOrgId(''); }}><option value="public">Public Commons</option>{user && <option value="organization">Public + organization evidence</option>}</select></label>
      {scope === 'organization' && <label>Organization<select value={orgId} onChange={e => setOrgId(e.target.value)}><option value="">Select organization</option>{orgs.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
      {user && <label className="checkbox"><input type="checkbox" checked={includePrivate} onChange={e => setIncludePrivate(e.target.checked)} /> Include my private evidence</label>}
      <label>Appraisal framework<select value={frameworkId} onChange={e => setFrameworkId(e.target.value)}><option value="">No appraisal framework</option>{frameworks.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
      <label className="checkbox"><input type="checkbox" checked={requireAppraisal} onChange={e => setRequireAppraisal(e.target.checked)} /> Require selected appraisal</label>
      <label>Cohort/intervention contains<input value={cohort} onChange={e => setCohort(e.target.value)} placeholder="e.g., tunneled catheter" /></label>
      <label>Year from<input value={yearMin} onChange={e => setYearMin(e.target.value)} /></label>
      <label>Year to<input value={yearMax} onChange={e => setYearMax(e.target.value)} /></label>
      <label>Weighting<select value={weighting} onChange={e => setWeighting(e.target.value)}>{WEIGHTING_OPTIONS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
      <label>Rate display<select value={rateScale} onChange={e => setRateScale(e.target.value)}>{RATE_SCALE_OPTIONS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
      <label className="checkbox"><input type="checkbox" checked={percent} onChange={e => setPercent(e.target.checked)} /> Show proportions as percent</label>
      <button className="button secondary" onClick={loadRows} disabled={loading}>{loading ? 'Loading…' : 'Refresh evidence'}</button>
      <button className="button secondary" onClick={saveLive}>Save as live evidence page</button>
    </div>

    {selectedFramework && <div className="subtle-callout"><strong>{selectedFramework.name}</strong> is the active appraisal framework. For RAW, the appraisal-weighted point estimate uses the selected framework score; the RAW confidence interval retains random-effects uncertainty.</div>}
    {msg && <div className="notice">{msg}</div>}

    <div className="metric-grid"><div className="metric-card"><div className="metric-value">{model.k}</div><div className="metric-label">Studies</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.mean) ? model.mean.toFixed(3) : '—'}{suffix}</div><div className="metric-label">Pooled estimate</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.ciLower) ? `${model.ciLower.toFixed(3)} to ${model.ciUpper.toFixed(3)}` : '—'}</div><div className="metric-label">95% CI</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.tau2) ? model.tau2.toFixed(4) : '—'}</div><div className="metric-label">Tau²</div></div></div>

    <div className="card"><h2>Forest plot</h2><ForestPlot studies={model.studies} pooled={model} /></div>
    <div className="card"><h2>Included consensus evidence</h2><div className="table-wrap"><table><thead><tr><th>Study</th><th>Year</th><th>Cohort</th><th>Access</th><th>Outcome</th><th>Timepoint</th><th>{selectedFramework?.name || 'Appraisal'}</th><th>Confirmations</th></tr></thead><tbody>{filtered.map(r => <tr key={r.extraction_id}><td>{r.work_title}</td><td>{r.publication_year}</td><td>{r.cohort_label}</td><td>{r.evidence_visibility === 'organization' ? 'Organization' : r.evidence_visibility}</td><td>{r.outcome_label}</td><td>{r.timepoint_label || '—'}</td><td>{Number.isFinite(Number(r.community_quality_score)) ? `${Number(r.community_quality_score).toFixed(2)} / 5 (n=${r.appraisal_count})` : 'Unappraised'}</td><td>{r.vote_count}</td></tr>)}</tbody></table></div></div>
  </section>;
}
