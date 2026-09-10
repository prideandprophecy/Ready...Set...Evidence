import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import ForestPlot from '../components/ForestPlot';
import FacetPicker, { facetFilterObject, facetSummary } from '../components/FacetPicker';
import { RATE_SCALE_OPTIONS, WEIGHTING_OPTIONS, runSynthesis } from '../lib/synthesis';
import { slugify } from '../lib/identifiers';

function cohortTypeArray(value) {
  return value ? [value] : null;
}

function groupTypeLabel(value) {
  if (value === 'overall') return 'Overall cohorts';
  if (value === 'arm') return 'Study arms';
  if (value === 'subgroup') return 'Subgroups';
  return 'All group types';
}

function duplicateCohortWorks(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.work_id)) map.set(row.work_id, new Set());
    map.get(row.work_id).add(row.cohort_id);
  }
  return [...map.entries()].filter(([, ids]) => ids.size > 1).map(([workId]) => workId);
}

function EvidenceTable({ rows, frameworkName }) {
  return <div className="table-wrap"><table><thead><tr><th>Study</th><th>Year</th><th>Group</th><th>Facets</th><th>Access</th><th>Outcome</th><th>Timepoint</th><th>{frameworkName || 'Appraisal'}</th><th>Confirmations</th></tr></thead><tbody>
    {rows.map(r => <tr key={`${r.extraction_id}-${r.cohort_id}`}>
      <td>{r.work_title}</td>
      <td>{r.publication_year}</td>
      <td>{r.cohort_label}<div className="muted tiny">{groupTypeLabel(r.cohort_type)}</div></td>
      <td>{Array.isArray(r.facets) && r.facets.length ? <span className="tiny">{facetSummary(r.facets.map(x => ({ ...x, canonical_label: x.label || x.canonical_label })))}</span> : '—'}</td>
      <td>{r.evidence_visibility === 'organization' ? 'Organization' : r.evidence_visibility}</td>
      <td>{r.outcome_label}</td>
      <td>{r.timepoint_label || '—'}</td>
      <td>{Number.isFinite(Number(r.community_quality_score)) ? `${Number(r.community_quality_score).toFixed(2)} / 5 (n=${r.appraisal_count})` : 'Not appraised'}</td>
      <td>{r.vote_count}</td>
    </tr>)}
  </tbody></table></div>;
}

function ResultBlock({ title, rows, model, frameworkName, suffix }) {
  const ambiguous = duplicateCohortWorks(rows);
  return <section className="section-block">
    <div className="section-heading"><div><div className="eyebrow">Synthesis result</div><h2>{title}</h2></div></div>
    {ambiguous.length > 0 && <div className="subtle-callout"><strong>{ambiguous.length} paper(s) have more than one matching study group.</strong> RSE collapses matching rows within a paper to one study estimate before pooling. Refine the group type or facets if those groups should not be combined.</div>}
    <div className="metric-grid"><div className="metric-card"><div className="metric-value">{model.k}</div><div className="metric-label">Studies</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.mean) ? model.mean.toFixed(3) : '—'}{suffix}</div><div className="metric-label">Pooled estimate</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.ciLower) ? `${model.ciLower.toFixed(3)} to ${model.ciUpper.toFixed(3)}` : '—'}</div><div className="metric-label">95% CI</div></div><div className="metric-card"><div className="metric-value">{Number.isFinite(model.tau2) ? model.tau2.toFixed(4) : '—'}</div><div className="metric-label">Tau²</div></div></div>
    <div className="card"><h2>Forest plot</h2><ForestPlot studies={model.studies} pooled={model} /></div>
    <div className="card"><h2>Included consensus evidence</h2><EvidenceTable rows={rows} frameworkName={frameworkName} /></div>
  </section>;
}

export default function SynthesizePage() {
  const { user } = useAuth();
  const [rowsA, setRowsA] = useState([]);
  const [rowsB, setRowsB] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [frameworks, setFrameworks] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [outcome, setOutcome] = useState('');
  const [frameworkId, setFrameworkId] = useState('');
  const [facetsA, setFacetsA] = useState([]);
  const [facetsB, setFacetsB] = useState([]);
  const [groupTypeA, setGroupTypeA] = useState('');
  const [groupTypeB, setGroupTypeB] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [weighting, setWeighting] = useState('raw');
  const [rateScale, setRateScale] = useState('per_1000_days');
  const [percent, setPercent] = useState(true);
  const [scope, setScope] = useState('public');
  const [orgId, setOrgId] = useState('');
  const [includePrivate, setIncludePrivate] = useState(false);
  const [requireAppraisal, setRequireAppraisal] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [labelA, setLabelA] = useState('Evidence set A');
  const [labelB, setLabelB] = useState('Evidence set B');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { loadOptions(); }, [user?.id]);
  useEffect(() => { if (outcome && frameworkId) loadRows(); }, [outcome, frameworkId]);

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

  async function fetchRows(facets, groupType) {
    const selectedOrg = scope === 'organization' ? orgId || null : null;
    return supabase.rpc('rse_get_synthesis_rows_v2', {
      p_outcome_concept_id: outcome,
      p_framework_id: frameworkId || null,
      p_org_id: selectedOrg,
      p_include_private: Boolean(includePrivate && user),
      p_facet_filters: facetFilterObject(facets),
      p_cohort_types: cohortTypeArray(groupType),
      p_year_min: yearMin ? Number(yearMin) : null,
      p_year_max: yearMax ? Number(yearMax) : null,
    });
  }

  async function loadRows() {
    if (!outcome) return;
    if (scope === 'organization' && !orgId) { setMsg('Select an organization before loading organization evidence.'); return; }
    setLoading(true);
    setMsg('');
    const [a, b] = await Promise.all([
      fetchRows(facetsA, groupTypeA),
      compareMode ? fetchRows(facetsB, groupTypeB) : Promise.resolve({ data: [], error: null }),
    ]);
    if (a.error || b.error) setMsg(a.error?.message || b.error?.message);
    setRowsA(a.data || []);
    setRowsB(b.data || []);
    setLoading(false);
  }

  const filteredA = useMemo(() => rowsA.filter(r => !requireAppraisal || !frameworkId || Number.isFinite(Number(r.community_quality_score))), [rowsA, requireAppraisal, frameworkId]);
  const filteredB = useMemo(() => rowsB.filter(r => !requireAppraisal || !frameworkId || Number.isFinite(Number(r.community_quality_score))), [rowsB, requireAppraisal, frameworkId]);
  const modelA = useMemo(() => runSynthesis(filteredA, { weighting, rateScale, proportionAsPercent: percent }), [filteredA, weighting, rateScale, percent]);
  const modelB = useMemo(() => runSynthesis(filteredB, { weighting, rateScale, proportionAsPercent: percent }), [filteredB, weighting, rateScale, percent]);
  const type = filteredA[0]?.outcome_type || filteredB[0]?.outcome_type;
  const suffix = type === 'proportion' && percent ? '%' : type === 'rate' ? ` (${RATE_SCALE_OPTIONS.find(x => x[0] === rateScale)?.[1]})` : '';
  const selectedFramework = frameworks.find(x => x.id === frameworkId);
  const searchOrgId = scope === 'organization' ? orgId || null : null;

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
      description: compareMode ? 'Live side-by-side synthesis of two filtered evidence sets in Ready...Set...Evidence.' : 'Live synthesis from current consensus evidence in Ready...Set...Evidence.',
      outcome_concept_id: outcome,
      filters: {
        version: 2,
        facet_filters_a: facetFilterObject(facetsA),
        facets_a: facetsA.map(x => ({ id: x.id, label: x.canonical_label || x.label, concept_type: x.concept_type })),
        cohort_type_a: groupTypeA || null,
        compare_mode: Boolean(compareMode),
        label_a: labelA,
        facet_filters_b: compareMode ? facetFilterObject(facetsB) : {},
        facets_b: compareMode ? facetsB.map(x => ({ id: x.id, label: x.canonical_label || x.label, concept_type: x.concept_type })) : [],
        cohort_type_b: compareMode ? groupTypeB || null : null,
        label_b: compareMode ? labelB : null,
        year_min: yearMin ? Number(yearMin) : null,
        year_max: yearMax ? Number(yearMax) : null,
      },
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
    <div className="page-title"><div><div className="eyebrow">Reusable synthesis</div><h1>Build a comparison from structured evidence</h1><p>Filter cohorts using reusable concepts rather than matching free text. Within a category, selected concepts are OR alternatives; across categories, categories are AND filters.</p></div></div>

    <div className="card form-stack">
      <div className="filter-grid">
        <label>Outcome<select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="">Select outcome</option>{concepts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Evidence scope<select value={scope} onChange={e => { setScope(e.target.value); if (e.target.value !== 'organization') setOrgId(''); }}><option value="public">Public Commons</option>{user && <option value="organization">Public + organization evidence</option>}</select></label>
        {scope === 'organization' && <label>Organization<select value={orgId} onChange={e => setOrgId(e.target.value)}><option value="">Select organization</option>{orgs.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
        {user && <label className="checkbox"><input type="checkbox" checked={includePrivate} onChange={e => setIncludePrivate(e.target.checked)} /> Include my private evidence</label>}
        <label>Appraisal framework<select value={frameworkId} onChange={e => setFrameworkId(e.target.value)}><option value="">No appraisal framework</option>{frameworks.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
        <label className="checkbox"><input type="checkbox" checked={requireAppraisal} onChange={e => setRequireAppraisal(e.target.checked)} /> Require selected appraisal</label>
        <label>Year from<input value={yearMin} onChange={e => setYearMin(e.target.value)} inputMode="numeric" /></label>
        <label>Year to<input value={yearMax} onChange={e => setYearMax(e.target.value)} inputMode="numeric" /></label>
        <label>Weighting<select value={weighting} onChange={e => setWeighting(e.target.value)}>{WEIGHTING_OPTIONS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
        <label>Rate display<select value={rateScale} onChange={e => setRateScale(e.target.value)}>{RATE_SCALE_OPTIONS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
        <label className="checkbox"><input type="checkbox" checked={percent} onChange={e => setPercent(e.target.checked)} /> Show proportions as percent</label>
        <label className="checkbox"><input type="checkbox" checked={compareMode} onChange={e => setCompareMode(e.target.checked)} /> Compare two filtered evidence sets</label>
      </div>

      <div className={compareMode ? 'two-column' : ''}>
        <div className="card" style={{ margin: 0 }}>
          {compareMode && <label>Set A label<input value={labelA} onChange={e => setLabelA(e.target.value)} /></label>}
          <label>Group type<select value={groupTypeA} onChange={e => setGroupTypeA(e.target.value)}><option value="">All group types</option><option value="overall">Overall cohorts only</option><option value="arm">Study arms only</option><option value="subgroup">Subgroups only</option></select></label>
          <FacetPicker selected={facetsA} onAdd={x => setFacetsA(v => v.some(y => y.id === x.id) ? v : [...v, x])} onRemove={x => setFacetsA(v => v.filter(y => y.id !== x.id))} searchOrgId={searchOrgId} includePrivate={includePrivate} label={compareMode ? 'Set A facets' : 'Cohort facets'} help="Examples: Pediatric; a disease/indication; a therapy; a specific device or drug; a setting; or a generic characteristic/variant. No device-specific attribute categories are hard-coded." />
        </div>

        {compareMode && <div className="card" style={{ margin: 0 }}>
          <label>Set B label<input value={labelB} onChange={e => setLabelB(e.target.value)} /></label>
          <label>Group type<select value={groupTypeB} onChange={e => setGroupTypeB(e.target.value)}><option value="">All group types</option><option value="overall">Overall cohorts only</option><option value="arm">Study arms only</option><option value="subgroup">Subgroups only</option></select></label>
          <FacetPicker selected={facetsB} onAdd={x => setFacetsB(v => v.some(y => y.id === x.id) ? v : [...v, x])} onRemove={x => setFacetsB(v => v.filter(y => y.id !== x.id))} searchOrgId={searchOrgId} includePrivate={includePrivate} label="Set B facets" help="Set B is independently filtered using the same AND-across-categories / OR-within-category logic." />
        </div>}
      </div>

      <div className="row-actions"><button className="button primary" onClick={loadRows} disabled={loading}>{loading ? 'Loading…' : 'Run synthesis'}</button><button className="button secondary" onClick={saveLive}>Save as live evidence page</button></div>
    </div>

    {selectedFramework && <div className="subtle-callout"><strong>{selectedFramework.name}</strong> is the active appraisal framework. Each contributor's appraisal is the arithmetic mean of its domain scores. RAW uses the study-level community mean for that selected framework.</div>}
    {compareMode && <div className="subtle-callout"><strong>Comparison mode is side-by-side evidence synthesis.</strong> It does not treat two separately pooled evidence sets as though they were a randomized head-to-head effect. Direct within-study comparisons are recorded on paper pages and can support dedicated comparative-effect synthesis later.</div>}
    {msg && <div className="notice">{msg}</div>}

    <ResultBlock title={compareMode ? labelA : 'Selected evidence'} rows={filteredA} model={modelA} frameworkName={selectedFramework?.name} suffix={suffix} />
    {compareMode && <ResultBlock title={labelB} rows={filteredB} model={modelB} frameworkName={selectedFramework?.name} suffix={suffix} />}
  </section>;
}
