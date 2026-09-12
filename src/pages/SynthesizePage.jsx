import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import ForestPlot from '../components/ForestPlot';
import ZonedComparisonPlot from '../components/ZonedComparisonPlot';
import FacetPicker, { facetFilterObject, facetSummary } from '../components/FacetPicker';
import {
  OUTCOME_DIRECTION_OPTIONS,
  RATE_SCALE_OPTIONS,
  WEIGHTING_OPTIONS,
  formatOutcomeValue,
  runSynthesis,
} from '../lib/synthesis';
import { slugify } from '../lib/identifiers';
import { STUDY_DESIGN_OPTIONS, WORK_TYPE_OPTIONS, studyDesignLabel, workTypeLabel } from '../lib/studyDesigns';

function cohortTypeArray(value) {
  return value ? [value] : null;
}

function outcomeTypeLabel(value) {
  if (value === 'proportion') return 'Proportion';
  if (value === 'rate') return 'Rate';
  if (value === 'continuous') return 'Continuous';
  return value || 'Outcome';
}

function groupTypeLabel(value) {
  if (value === 'overall') return 'Overall cohort';
  if (value === 'arm') return 'Study arm';
  if (value === 'subgroup') return 'Subgroup';
  return 'Study group';
}

function StudyEvidenceTable({ studies = [], outcomeType, proportionAsPercent, label = 'Included studies', onExclude }) {
  const [page, setPage] = useState(0);
  const pageSize = 50;
  useEffect(() => { setPage(0); }, [studies]);
  if (!studies.length) return <div className="empty-state">No usable studies after the selected filters.</div>;
  const pages = Math.max(1, Math.ceil(studies.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = studies.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const format = value => formatOutcomeValue(value, outcomeType, { proportionAsPercent });

  return <div>
    <div className="section-heading" style={{ marginBottom: 10 }}>
      <div><h3 style={{ marginBottom: 2 }}>{label}</h3><div className="muted tiny">Study-level view. Endpoint records matching the active filters are collapsed within each publication before between-study pooling.</div></div>
      <div className="muted tiny">{studies.length.toLocaleString()} studies</div>
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Study</th><th>Cohorts merged</th><th>Matched endpoint records</th><th>Appraisal</th><th>Study estimate (95% CI)</th><th>Pool weight</th>{onExclude && <th>Include</th>}</tr></thead>
      <tbody>{visible.map(study => <tr key={study.workId}>
        <td>
          <Link to={`/work/${study.workId}`}><strong>{study.label}</strong></Link>
          <div className="muted tiny">{study.title}</div>
          {study.continuityNotes?.length ? <div className="muted tiny">{study.continuityNotes.join('; ')}</div> : null}
        </td>
        <td>{study.cohortCount || 1}{study.cohortLabels?.length ? <div className="muted tiny">{study.cohortLabels.slice(0, 3).join(' • ')}{study.cohortLabels.length > 3 ? '…' : ''}</div> : null}</td>
        <td>{study.endpointCount || 1}</td>
        <td>{Number.isFinite(study.qualityScore) ? `${study.qualityScore.toFixed(2)} / 5` : 'Not appraised'}{study.appraisalCount ? <div className="muted tiny">n={study.appraisalCount} appraisal{study.appraisalCount === 1 ? '' : 's'}</div> : null}</td>
        <td>{format(study.y)} ({format(study.ciLower)} to {format(study.ciUpper)}){study.denominatorLabel ? <div className="muted tiny">{study.denominatorLabel}</div> : null}</td>
        <td>{Number.isFinite(study.poolWeightPct) ? `${study.poolWeightPct.toFixed(1)}%` : '—'}</td>
        {onExclude && <td><button type="button" className="button mini ghost" onClick={() => onExclude(study)}>Exclude article</button></td>}
      </tr>)}</tbody>
    </table></div>
    {pages > 1 && <div className="row-actions" style={{ marginTop: 12 }}>
      <button type="button" className="button mini ghost" disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button>
      <span className="muted tiny">Showing {(safePage * pageSize + 1).toLocaleString()}–{Math.min(studies.length, (safePage + 1) * pageSize).toLocaleString()} of {studies.length.toLocaleString()}</span>
      <button type="button" className="button mini ghost" disabled={safePage >= pages - 1} onClick={() => setPage(p => Math.min(pages - 1, p + 1))}>Next</button>
    </div>}
  </div>;
}

function ResultBlock({ title, rows, model, frameworkName, suffix, rateScale, percent, plotId, onExclude }) {
  const outcomeType = rows[0]?.outcome_type || model.studies?.[0]?.outcomeType;
  return <section className="section-block">
    <div className="section-heading"><div><div className="eyebrow">Evidence set</div><h2>{title}</h2></div></div>
    <div className="metric-grid">
      <div className="metric-card"><div className="metric-value">{model.k || 0}</div><div className="metric-label">Studies</div></div>
      <div className="metric-card"><div className="metric-value">{rows.length.toLocaleString()}</div><div className="metric-label">Matched endpoint records</div></div>
      <div className="metric-card"><div className="metric-value">{Number.isFinite(model.mean) ? model.mean.toFixed(3) : '—'}{suffix}</div><div className="metric-label">Pooled estimate</div></div>
      <div className="metric-card"><div className="metric-value">{Number.isFinite(model.ciLower) ? `${model.ciLower.toFixed(3)} to ${model.ciUpper.toFixed(3)}` : '—'}</div><div className="metric-label">95% CI</div></div>
      <div className="metric-card"><div className="metric-value">{Number.isFinite(model.tau2) ? model.tau2.toFixed(4) : '—'}</div><div className="metric-label">Tau²</div></div>
    </div>
    <div className="card"><ForestPlot studies={model.studies} pooled={model} title={`${title} forest plot`} plotId={plotId} rateScale={rateScale} proportionAsPercent={percent} /></div>
    <div className="card"><StudyEvidenceTable studies={model.studies} outcomeType={outcomeType} proportionAsPercent={percent} label={`Included studies${frameworkName ? ` • ${frameworkName}` : ''}`} onExclude={onExclude} /></div>
  </section>;
}

export default function SynthesizePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { slug: editSlug } = useParams();
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
  const [mixedModeA, setMixedModeA] = useState('all');
  const [mixedModeB, setMixedModeB] = useState('all');
  const [workTypes, setWorkTypes] = useState([]);
  const [studyDesigns, setStudyDesigns] = useState([]);
  const [excludedWorksA, setExcludedWorksA] = useState([]);
  const [excludedWorksB, setExcludedWorksB] = useState([]);
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
  const [labelA, setLabelA] = useState('Primary evidence');
  const [labelB, setLabelB] = useState('Comparator evidence');
  const [outcomeDirection, setOutcomeDirection] = useState('');
  const [excludeOverlap, setExcludeOverlap] = useState(true);
  const [overlapCount, setOverlapCount] = useState(0);
  const [hasRun, setHasRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [editingView, setEditingView] = useState(null);
  const [pageTitle, setPageTitle] = useState('');
  const [pageDescription, setPageDescription] = useState('');

  useEffect(() => { loadOptions(); }, [user?.id]);
  useEffect(() => { if (editSlug && user) loadExistingView(); }, [editSlug, user?.id]);

  function invalidate() {
    if (hasRun) setHasRun(false);
  }

  function toggleArrayValue(setter, value) {
    setter(current => current.includes(value) ? current.filter(x => x !== value) : [...current, value]);
    invalidate();
  }

  async function loadExistingView() {
    const { data, error } = await supabase.from('rse_live_views').select('*').eq('slug', editSlug).maybeSingle();
    if (error || !data) { setMsg(error?.message || 'Living evidence page not found.'); return; }
    if (data.owner_user_id !== user.id) { setMsg('Only the owner can edit this living evidence page.'); return; }
    const f = data.filters || {};
    setEditingView(data);
    setPageTitle(data.title || '');
    setPageDescription(data.description || '');
    setOutcome(data.outcome_concept_id || '');
    setFrameworkId(data.appraisal_framework_id || '');
    setFacetsA(Array.isArray(f.facets_a) ? f.facets_a.map(x => ({ ...x, canonical_label: x.canonical_label || x.label })) : []);
    setFacetsB(Array.isArray(f.facets_b) ? f.facets_b.map(x => ({ ...x, canonical_label: x.canonical_label || x.label })) : []);
    setGroupTypeA(f.cohort_type_a || '');
    setGroupTypeB(f.cohort_type_b || '');
    setMixedModeA(f.mixed_mode_a || 'all');
    setMixedModeB(f.mixed_mode_b || 'all');
    setWorkTypes(Array.isArray(f.work_types) ? f.work_types : []);
    setStudyDesigns(Array.isArray(f.study_designs) ? f.study_designs : []);
    setExcludedWorksA(Array.isArray(f.excluded_works_a) ? f.excluded_works_a : (f.excluded_work_ids_a || []).map(id => ({ id, label: id })));
    setExcludedWorksB(Array.isArray(f.excluded_works_b) ? f.excluded_works_b : (f.excluded_work_ids_b || []).map(id => ({ id, label: id })));
    setYearMin(f.year_min ?? '');
    setYearMax(f.year_max ?? '');
    setWeighting(data.weighting || 'raw');
    setRateScale(data.rate_scale || 'per_1000_days');
    setPercent(data.proportion_as_percent !== false);
    setScope(data.visibility === 'organization' ? 'organization' : 'public');
    setOrgId(data.owner_org_id || '');
    setIncludePrivate(Boolean(data.include_private || data.visibility === 'private'));
    setRequireAppraisal(data.require_appraisal !== false);
    setCompareMode(Boolean(f.compare_mode));
    setLabelA(f.label_a || 'Primary evidence');
    setLabelB(f.label_b || 'Comparator evidence');
    setOutcomeDirection(f.outcome_direction || '');
    setExcludeOverlap(f.exclude_overlap_from_b !== false);
    setHasRun(false);
  }

  async function loadOptions() {
    const [c, f, o] = await Promise.all([
      supabase.from('rse_outcome_concepts').select('id,label,default_outcome_type').order('label'),
      supabase.from('rse_appraisal_frameworks').select('id,name,slug,description').eq('is_public', true).order('name'),
      user ? supabase.from('rse_org_members').select('org:rse_organizations(id,name)').eq('user_id', user.id).eq('status', 'active') : Promise.resolve({ data: [] }),
    ]);
    setConcepts(c.data || []);
    setFrameworks(f.data || []);
    setOrgs((o.data || []).map(x => x.org).filter(Boolean));
    const preferred = (f.data || []).find(x => x.slug === 'rse-custom') || f.data?.[0];
    if (!editSlug && !frameworkId && preferred) setFrameworkId(preferred.id);
  }

  function commonRpcArgs() {
    return {
      p_outcome_concept_id: outcome,
      p_framework_id: frameworkId || null,
      p_org_id: scope === 'organization' ? orgId || null : null,
      p_include_private: Boolean(includePrivate && user),
      p_year_min: yearMin ? Number(yearMin) : null,
      p_year_max: yearMax ? Number(yearMax) : null,
      p_work_types: workTypes.length ? workTypes : null,
      p_study_designs: studyDesigns.length ? studyDesigns : null,
    };
  }

  async function loadRows() {
    if (!outcome) { setMsg('Select an outcome before running synthesis.'); return; }
    if (scope === 'organization' && !orgId) { setMsg('Select an organization before loading organization evidence.'); return; }
    setLoading(true);
    setMsg('');
    setOverlapCount(0);

    try {
      if (compareMode) {
        const { data, error } = await supabase.rpc('rse_get_synthesis_comparison_rows_v2', {
          ...commonRpcArgs(),
          p_facet_filters_a: facetFilterObject(facetsA),
          p_cohort_types_a: cohortTypeArray(groupTypeA),
          p_facet_filters_b: facetFilterObject(facetsB),
          p_cohort_types_b: cohortTypeArray(groupTypeB),
          p_exclude_overlap: Boolean(excludeOverlap),
          p_mixed_mode_a: mixedModeA,
          p_mixed_mode_b: mixedModeB,
          p_excluded_work_ids_a: excludedWorksA.length ? excludedWorksA.map(x => x.id) : null,
          p_excluded_work_ids_b: excludedWorksB.length ? excludedWorksB.map(x => x.id) : null,
        });
        if (error) throw error;
        const all = data || [];
        setRowsA(all.filter(row => row.set_code === 'A'));
        setRowsB(all.filter(row => row.set_code === 'B'));
        setOverlapCount(Number(all[0]?.overlap_count) || 0);
      } else {
        const { data, error } = await supabase.rpc('rse_get_synthesis_rows_v4', {
          ...commonRpcArgs(),
          p_facet_filters: facetFilterObject(facetsA),
          p_cohort_types: cohortTypeArray(groupTypeA),
          p_mixed_mode: mixedModeA,
          p_excluded_work_ids: excludedWorksA.length ? excludedWorksA.map(x => x.id) : null,
        });
        if (error) throw error;
        setRowsA(data || []);
        setRowsB([]);
      }
      setHasRun(true);
    } catch (error) {
      setRowsA([]);
      setRowsB([]);
      setHasRun(false);
      setMsg(error.message || 'Unable to load synthesis evidence.');
    } finally {
      setLoading(false);
    }
  }

  const filteredA = useMemo(
    () => rowsA.filter(row => !requireAppraisal || !frameworkId || Number.isFinite(Number(row.community_quality_score))),
    [rowsA, requireAppraisal, frameworkId]
  );
  const filteredB = useMemo(
    () => rowsB.filter(row => !requireAppraisal || !frameworkId || Number.isFinite(Number(row.community_quality_score))),
    [rowsB, requireAppraisal, frameworkId]
  );
  const modelA = useMemo(() => runSynthesis(filteredA, { weighting, rateScale, proportionAsPercent: percent }), [filteredA, weighting, rateScale, percent]);
  const modelB = useMemo(() => runSynthesis(filteredB, { weighting, rateScale, proportionAsPercent: percent }), [filteredB, weighting, rateScale, percent]);
  const type = filteredA[0]?.outcome_type || filteredB[0]?.outcome_type || concepts.find(x => x.id === outcome)?.default_outcome_type;
  const suffix = type === 'proportion' && percent ? '%' : type === 'rate' ? ` (${RATE_SCALE_OPTIONS.find(x => x[0] === rateScale)?.[1]})` : '';
  const selectedFramework = frameworks.find(x => x.id === frameworkId);
  const searchOrgId = scope === 'organization' ? orgId || null : null;
  const displayLabelA = labelA.trim() || 'Primary evidence';
  const displayLabelB = labelB.trim() || 'Comparator evidence';

  function excludeStudy(setCode, study) {
    const reason = window.prompt(`Reason for excluding ${study.label} from ${setCode === 'B' ? displayLabelB : displayLabelA} (optional)`, '');
    if (reason === null) return;
    const item = { id: study.workId, label: study.label, title: study.title, reason: reason.trim() || null };
    if (setCode === 'B') setExcludedWorksB(current => current.some(x => x.id === item.id) ? current : [...current, item]);
    else setExcludedWorksA(current => current.some(x => x.id === item.id) ? current : [...current, item]);
    setHasRun(false);
    setMsg(`${study.label} excluded from ${setCode === 'B' ? displayLabelB : displayLabelA}${item.reason ? `: ${item.reason}` : ''}. Run synthesis again to apply the article exclusion.`);
  }

  function restoreExcluded(setCode, id) {
    if (setCode === 'B') setExcludedWorksB(current => current.filter(x => x.id !== id));
    else setExcludedWorksA(current => current.filter(x => x.id !== id));
    invalidate();
  }

  async function saveLive() {
    if (!user) { setMsg('Sign in to save a living evidence page.'); return; }
    if (!editingView && !hasRun) { setMsg('Run the synthesis before saving a living evidence page.'); return; }

    const title = editingView
      ? pageTitle.trim()
      : window.prompt('Title for this living evidence page', concepts.find(x => x.id === outcome)?.label || 'Living evidence');
    if (!title) return;
    const description = editingView
      ? pageDescription.trim()
      : (window.prompt('Short description', compareMode ? `Living RSE zoned comparison of ${displayLabelA} and ${displayLabelB}.` : 'Living synthesis from current consensus evidence in Ready...Set...Evidence.') || '');

    const liveVisibility = scope === 'organization' ? 'organization' : includePrivate ? 'private' : 'public';
    const liveOrgId = liveVisibility === 'organization' ? orgId : null;
    const filters = {
      version: 4,
      facet_filters_a: facetFilterObject(facetsA),
      facets_a: facetsA.map(x => ({ id: x.id, label: x.canonical_label || x.label, concept_type: x.concept_type })),
      cohort_type_a: groupTypeA || null,
      mixed_mode_a: mixedModeA,
      compare_mode: Boolean(compareMode),
      label_a: displayLabelA,
      facet_filters_b: compareMode ? facetFilterObject(facetsB) : {},
      facets_b: compareMode ? facetsB.map(x => ({ id: x.id, label: x.canonical_label || x.label, concept_type: x.concept_type })) : [],
      cohort_type_b: compareMode ? groupTypeB || null : null,
      mixed_mode_b: compareMode ? mixedModeB : 'all',
      label_b: compareMode ? displayLabelB : null,
      outcome_direction: compareMode ? outcomeDirection || null : null,
      exclude_overlap_from_b: compareMode ? Boolean(excludeOverlap) : false,
      work_types: workTypes,
      study_designs: studyDesigns,
      excluded_work_ids_a: excludedWorksA.map(x => x.id),
      excluded_works_a: excludedWorksA,
      excluded_work_ids_b: compareMode ? excludedWorksB.map(x => x.id) : [],
      excluded_works_b: compareMode ? excludedWorksB : [],
      year_min: yearMin ? Number(yearMin) : null,
      year_max: yearMax ? Number(yearMax) : null,
    };
    const payload = {
      title, description: description || null, outcome_concept_id: outcome, filters, weighting,
      rate_scale: rateScale, proportion_as_percent: percent, owner_org_id: liveOrgId,
      visibility: liveVisibility, is_public: liveVisibility === 'public',
      appraisal_framework_id: frameworkId || null, require_appraisal: Boolean(requireAppraisal),
      include_private: Boolean(liveVisibility === 'private' && includePrivate),
    };

    if (editingView) {
      const { error } = await supabase.from('rse_live_views').update(payload).eq('id', editingView.id).eq('owner_user_id', user.id);
      if (error) setMsg(error.message);
      else navigate(`/live/${editingView.slug}`);
      return;
    }

    const { data, error } = await supabase.from('rse_live_views').insert({
      ...payload,
      slug: `${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`,
      owner_user_id: user.id,
    }).select().single();
    setMsg(error ? error.message : `Living evidence page created: /live/${data.slug}`);
  }

  return <section>
    <div className="page-title"><div><div className="eyebrow">{editingView ? 'Evidence Page • Edit living page' : 'Reusable synthesis'}</div><h1>{editingView ? `Edit ${editingView.title}` : 'Build a comparison from structured evidence'}</h1><p>{editingView ? 'Update the living page configuration, rerun the synthesis to preview changes, then save.' : 'Select an outcome and filters, then explicitly run the synthesis. RSE does not load a broad endpoint table on initial page load.'}</p></div></div>

    {editingView && <div className="card form-grid"><label className="span2">Page title<input value={pageTitle} onChange={e => setPageTitle(e.target.value)} /></label><label className="span2">Description<textarea rows="3" value={pageDescription} onChange={e => setPageDescription(e.target.value)} /></label></div>}

    <div className="card form-stack">
      <div className="filter-grid">
        <label>Outcome<select value={outcome} onChange={e => { setOutcome(e.target.value); invalidate(); }}><option value="">Select outcome</option>{concepts.map(c => <option key={c.id} value={c.id}>{c.label} • {outcomeTypeLabel(c.default_outcome_type)}</option>)}</select></label>
        <label>Evidence scope<select value={scope} onChange={e => { setScope(e.target.value); if (e.target.value !== 'organization') setOrgId(''); invalidate(); }}><option value="public">Public Commons</option>{user && <option value="organization">Public + organization evidence</option>}</select></label>
        {scope === 'organization' && <label>Organization<select value={orgId} onChange={e => { setOrgId(e.target.value); invalidate(); }}><option value="">Select organization</option>{orgs.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
        {user && <label className="checkbox"><input type="checkbox" checked={includePrivate} onChange={e => { setIncludePrivate(e.target.checked); invalidate(); }} /> Include my private evidence</label>}
        <label>Appraisal framework<select value={frameworkId} onChange={e => { setFrameworkId(e.target.value); invalidate(); }}><option value="">No appraisal framework</option>{frameworks.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
        <label className="checkbox"><input type="checkbox" checked={requireAppraisal} onChange={e => { setRequireAppraisal(e.target.checked); invalidate(); }} /> Require selected appraisal</label>
        <label>Year from<input value={yearMin} onChange={e => { setYearMin(e.target.value); invalidate(); }} inputMode="numeric" /></label>
        <label>Year to<input value={yearMax} onChange={e => { setYearMax(e.target.value); invalidate(); }} inputMode="numeric" /></label>
        <label>Weighting<select value={weighting} onChange={e => { setWeighting(e.target.value); invalidate(); }}>{WEIGHTING_OPTIONS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
        <label>Rate display<select value={rateScale} onChange={e => { setRateScale(e.target.value); invalidate(); }}>{RATE_SCALE_OPTIONS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>
        <label className="checkbox"><input type="checkbox" checked={percent} onChange={e => { setPercent(e.target.checked); invalidate(); }} /> Show proportions as percent</label>
        <label className="checkbox"><input type="checkbox" checked={compareMode} onChange={e => { setCompareMode(e.target.checked); invalidate(); }} /> Compare two evidence sets</label>
        {compareMode && <label>Outcome direction<select value={outcomeDirection} onChange={e => { setOutcomeDirection(e.target.value); invalidate(); }}><option value="">Select for zoning</option>{OUTCOME_DIRECTION_OPTIONS.map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select></label>}
        {compareMode && <label className="checkbox"><input type="checkbox" checked={excludeOverlap} onChange={e => { setExcludeOverlap(e.target.checked); invalidate(); }} /> Remove {displayLabelA} endpoint overlap from {displayLabelB}</label>}
      </div>

      <details className="subtle-callout"><summary><strong>Additional evidence filters</strong></summary><div className="two-column" style={{ marginTop: 12 }}><div><strong className="tiny">Publication / source type</strong><div className="tag-row">{WORK_TYPE_OPTIONS.map(([value, text]) => <label className="checkbox" key={value}><input type="checkbox" checked={workTypes.includes(value)} onChange={() => toggleArrayValue(setWorkTypes, value)} /> {text}</label>)}</div></div><div><strong className="tiny">Study design</strong><div className="tag-row">{STUDY_DESIGN_OPTIONS.map(([value, text]) => <label className="checkbox" key={value}><input type="checkbox" checked={studyDesigns.includes(value)} onChange={() => toggleArrayValue(setStudyDesigns, value)} /> {text}</label>)}</div></div></div><p className="muted tiny">Leave a category blank to include all values. Selecting only Randomized controlled trial provides an RCT-only synthesis.</p></details>

      <div className={compareMode ? 'two-column' : ''}>
        <div className="card" style={{ margin: 0 }}>
          {compareMode && <label>Primary evidence label<input value={labelA} onChange={e => { setLabelA(e.target.value); invalidate(); }} /></label>}
          <div className="eyebrow">{compareMode ? displayLabelA : 'Selected evidence'}</div><label>Group type<select value={groupTypeA} onChange={e => { setGroupTypeA(e.target.value); invalidate(); }}><option value="">All group types</option><option value="overall">Overall cohorts only</option><option value="arm">Study arms only</option><option value="subgroup">Subgroups only</option></select></label>
          <label>Mixed-cohort handling<select value={mixedModeA} onChange={e => { setMixedModeA(e.target.value); invalidate(); }}><option value="all">Include mixed and non-mixed cohorts</option><option value="exclude">Exclude mixed cohorts</option><option value="only">Mixed cohorts only</option></select></label>
          <FacetPicker selected={facetsA} onAdd={concept => { setFacetsA(values => values.some(x => x.id === concept.id) ? values : [...values, concept]); invalidate(); }} onRemove={concept => { setFacetsA(values => values.filter(x => x.id !== concept.id)); invalidate(); }} searchOrgId={searchOrgId} includePrivate={includePrivate} label={compareMode ? `${displayLabelA} facets` : 'Cohort facets'} help="Within a facet category, selected concepts are OR alternatives. Across categories, categories are AND filters." />
        </div>

        {compareMode && <div className="card" style={{ margin: 0 }}>
          <label>Comparator evidence label<input value={labelB} onChange={e => { setLabelB(e.target.value); invalidate(); }} /></label>
          <div className="eyebrow">{displayLabelB}</div><label>Group type<select value={groupTypeB} onChange={e => { setGroupTypeB(e.target.value); invalidate(); }}><option value="">All group types</option><option value="overall">Overall cohorts only</option><option value="arm">Study arms only</option><option value="subgroup">Subgroups only</option></select></label>
          <label>Mixed-cohort handling<select value={mixedModeB} onChange={e => { setMixedModeB(e.target.value); invalidate(); }}><option value="all">Include mixed and non-mixed cohorts</option><option value="exclude">Exclude mixed cohorts</option><option value="only">Mixed cohorts only</option></select></label>
          <FacetPicker selected={facetsB} onAdd={concept => { setFacetsB(values => values.some(x => x.id === concept.id) ? values : [...values, concept]); invalidate(); }} onRemove={concept => { setFacetsB(values => values.filter(x => x.id !== concept.id)); invalidate(); }} searchOrgId={searchOrgId} includePrivate={includePrivate} label={`${displayLabelB} facets`} help={`${displayLabelB} is filtered independently. With overlap removal enabled, any consensus endpoint that also matches ${displayLabelA} is removed from ${displayLabelB}.`} />
        </div>}
      </div>

      {(excludedWorksA.length > 0 || (compareMode && excludedWorksB.length > 0)) && <div className="subtle-callout"><strong>Article exclusions</strong>{excludedWorksA.length > 0 && <div className="tag-row"><span className="muted tiny">{displayLabelA}:</span>{excludedWorksA.map(x => <button type="button" className="button mini ghost" key={x.id} onClick={() => restoreExcluded('A', x.id)}>{x.label || x.title || x.id}{x.reason ? ` — ${x.reason}` : ''} ×</button>)}</div>}{compareMode && excludedWorksB.length > 0 && <div className="tag-row"><span className="muted tiny">{displayLabelB}:</span>{excludedWorksB.map(x => <button type="button" className="button mini ghost" key={x.id} onClick={() => restoreExcluded('B', x.id)}>{x.label || x.title || x.id}{x.reason ? ` — ${x.reason}` : ''} ×</button>)}</div>}<div className="muted tiny">Click an excluded article to restore it. Article exclusions are saved with living Evidence Pages.</div></div>}

      <div className="row-actions"><button className="button primary" onClick={loadRows} disabled={loading}>{loading ? 'Running…' : 'Run synthesis'}</button><button className="button secondary" onClick={saveLive}>{editingView ? 'Save living page changes' : 'Save as living evidence page'}</button>{editingView && <button type="button" className="button ghost" onClick={() => navigate(`/live/${editingView.slug}`)}>Cancel</button>}</div>
    </div>

    {selectedFramework && <div className="subtle-callout"><strong>{selectedFramework.name}</strong> is the active appraisal framework. Each contributor's appraisal is the arithmetic mean of its domain scores. RAW uses the study-level community mean for that selected framework.</div>}
    {compareMode && <div className="subtle-callout"><strong>Endpoint-specific comparison sets.</strong> {displayLabelA} and {displayLabelB} are independently filtered. When overlap removal is enabled, an endpoint matching both sets remains in {displayLabelA} and is excluded only from {displayLabelB}. Other endpoints from the same paper remain eligible for {displayLabelB} if they independently meet its filters.</div>}
    {msg && <div className="notice">{msg}</div>}

    {!hasRun && <div className="empty-state" style={{ marginTop: 24 }}><strong>No synthesis has been run yet.</strong><br />Choose an outcome and any desired evidence filters, then click Run synthesis.</div>}

    {hasRun && compareMode && <>
      {excludeOverlap && overlapCount > 0 && <div className="notice">{overlapCount.toLocaleString()} consensus endpoint{overlapCount === 1 ? '' : 's'} matched both evidence sets and {overlapCount === 1 ? 'was' : 'were'} removed from {displayLabelB}.</div>}
      <div className="card section-block"><ZonedComparisonPlot modelA={modelA} modelB={modelB} labelA={displayLabelA} labelB={displayLabelB} direction={outcomeDirection} rateScale={rateScale} proportionAsPercent={percent} /></div>
      <div className="section-heading"><div><div className="eyebrow">Supporting plots</div><h2>Individual evidence-set forest plots</h2><p>The zoned comparison is the primary RSE comparison view. The separate forest plots remain available to inspect each pooled evidence set independently.</p></div></div>
    </>}

    {hasRun && <ResultBlock title={compareMode ? displayLabelA : 'Selected evidence'} rows={filteredA} model={modelA} frameworkName={selectedFramework?.name} suffix={suffix} rateScale={rateScale} percent={percent} plotId="rse-forest-a" onExclude={study => excludeStudy('A', study)} />}
    {hasRun && compareMode && <ResultBlock title={displayLabelB} rows={filteredB} model={modelB} frameworkName={selectedFramework?.name} suffix={suffix} rateScale={rateScale} percent={percent} plotId="rse-forest-b" onExclude={study => excludeStudy('B', study)} />}

    {hasRun && <div className="subtle-callout"><strong>Filter summary:</strong> {facetsA.length ? `${displayLabelA}: ${facetSummary(facetsA)}.` : `${displayLabelA} has no facet restrictions.`}{compareMode ? ` ${facetsB.length ? `${displayLabelB}: ${facetSummary(facetsB)}.` : `${displayLabelB} has no facet restrictions.`}` : ''} {groupTypeA ? `${displayLabelA} group type: ${groupTypeLabel(groupTypeA)}.` : ''} {mixedModeA === 'exclude' ? `${displayLabelA} excludes mixed cohorts.` : mixedModeA === 'only' ? `${displayLabelA} includes only mixed cohorts.` : ''} {workTypes.length ? `Source types: ${workTypes.map(workTypeLabel).join(', ')}.` : ''} {studyDesigns.length ? `Study designs: ${studyDesigns.map(studyDesignLabel).join(', ')}.` : ''}</div>}
  </section>;
}
