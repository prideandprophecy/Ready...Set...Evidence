import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Edit3, Flag, Plus, Vote } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { cleanJatsText, formatDate, slugify } from '../lib/identifiers';
import { appraisalComplete, calculateDomainMean, frameworkDomains, makeInitialResponses, scoreLabel, setDomainResponse } from '../lib/appraisal';

const num = v => v === '' || v == null ? null : Number(v);
const emptyEvidence = { cohort_id: '', outcome_label: '', outcome_type: 'proportion', timepoint_label: '', subgroup_label: '', units: '', mean: '', sd: '', n: '', events: '', total_exposure: '', reported_value: '', source_locator: '', extraction_notes: '' };

function ScopeBadge({ visibility, orgName }) {
  if (visibility === 'organization') return <span className="tag private-tag">Organization: {orgName || 'members'}</span>;
  if (visibility === 'private') return <span className="tag private-tag">Private</span>;
  return <span className="tag public-tag">Public</span>;
}

export default function WorkPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [work, setWork] = useState(null);
  const [authors, setAuthors] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [slots, setSlots] = useState([]);
  const [extractions, setExtractions] = useState([]);
  const [votes, setVotes] = useState([]);
  const [appraisals, setAppraisals] = useState([]);
  const [frameworks, setFrameworks] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [workVersions, setWorkVersions] = useState([]);
  const [claimStatus, setClaimStatus] = useState(null);
  const [canEditWork, setCanEditWork] = useState(false);
  const [editingWork, setEditingWork] = useState(false);
  const [workForm, setWorkForm] = useState({});
  const [msg, setMsg] = useState('');

  const [cohortForm, setCohortForm] = useState({ label: 'Overall cohort', patient_population: '', intervention: '', comparator: '', sample_size: '', visibility: 'public', owner_org_id: '' });
  const [ev, setEv] = useState(emptyEvidence);
  const [app, setApp] = useState({ framework_id: '', responses: { domains: {} }, rationale: '', visibility: 'public', owner_org_id: '' });

  useEffect(() => { load(); }, [id, user?.id]);

  async function load() {
    setMsg('');
    const { data: slotIdsData } = await supabase.from('rse_evidence_slots').select('id').eq('work_id', id);
    const slotIds = (slotIdsData || []).map(x => x.id);
    const extractionQuery = slotIds.length
      ? supabase.from('rse_extractions').select('*,creator:rse_profiles!created_by(username,display_name)').in('slot_id', slotIds).order('created_at')
      : Promise.resolve({ data: [] });
    const voteQuery = slotIds.length
      ? supabase.from('rse_extraction_votes').select('*').in('slot_id', slotIds)
      : Promise.resolve({ data: [] });

    const [w, a, c, o, s, e, v, ap, f, myOrgs, versions, claim, editPermission] = await Promise.all([
      supabase.from('rse_works').select('*').eq('id', id).single(),
      supabase.from('rse_work_authors').select('*,linked_profile:rse_profiles!linked_profile_id(username,display_name)').eq('work_id', id).order('author_order'),
      supabase.from('rse_cohorts').select('*').eq('work_id', id).order('created_at'),
      supabase.from('rse_outcome_concepts').select('*').order('label'),
      supabase.from('rse_evidence_slots').select('*').eq('work_id', id).order('created_at'),
      extractionQuery,
      voteQuery,
      supabase.from('rse_appraisals').select('*,profile:rse_profiles!user_id(username,display_name),framework:rse_appraisal_frameworks(name,slug,response_schema)').eq('work_id', id).order('created_at'),
      supabase.from('rse_appraisal_frameworks').select('*').eq('is_public', true).order('name'),
      user ? supabase.from('rse_org_members').select('role,status,org:rse_organizations(id,name,slug)').eq('user_id', user.id).eq('status', 'active') : Promise.resolve({ data: [] }),
      supabase.from('rse_work_versions').select('id,version_no,change_reason,changed_by,created_at').eq('work_id', id).order('version_no', { ascending: false }).limit(8),
      user ? supabase.from('rse_authorship_claims').select('*').eq('work_id', id).eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
      user ? supabase.rpc('rse_can_edit_work', { p_work_id: id, p_user_id: user.id }) : Promise.resolve({ data: false }),
    ]);

    const extractionIds = (e.data || []).map(x => x.id);
    const ch = extractionIds.length
      ? await supabase.from('rse_challenges').select('*').in('extraction_id', extractionIds).order('created_at', { ascending: false })
      : { data: [] };

    setWork(w.data || null);
    setAuthors(a.data || []);
    setCohorts(c.data || []);
    setConcepts(o.data || []);
    setSlots(s.data || []);
    setExtractions(e.data || []);
    setVotes(v.data || []);
    setAppraisals(ap.data || []);
    setFrameworks(f.data || []);
    setChallenges(ch.data || []);
    setOrgs((myOrgs.data || []).map(x => x.org).filter(Boolean));
    setWorkVersions(versions.data || []);
    setClaimStatus(claim.data || null);
    setCanEditWork(Boolean(editPermission.data));

    if (w.data) {
      setWorkForm({
        title: w.data.title || '',
        abstract: cleanJatsText(w.data.abstract || ''),
        journal: w.data.journal || '',
        publication_year: w.data.publication_year || '',
        url: w.data.url || '',
        citation: w.data.citation || '',
        change_reason: '',
      });
    }
    if (!ev.cohort_id && c.data?.[0]) setEv(x => ({ ...x, cohort_id: c.data[0].id }));
    if (!app.framework_id && f.data?.length) { const preferred=(f.data||[]).find(x=>x.slug==='rse-custom')||f.data[0]; chooseFramework(preferred.id, f.data, ap.data || [], w.data?.publication_year); }
  }

  const conceptMap = useMemo(() => new Map(concepts.map(x => [x.id, x])), [concepts]);
  const cohortMap = useMemo(() => new Map(cohorts.map(x => [x.id, x])), [cohorts]);
  const orgMap = useMemo(() => new Map(orgs.map(x => [x.id, x])), [orgs]);
  const selectedFramework = frameworks.find(f => f.id === app.framework_id) || null;
  const domains = frameworkDomains(selectedFramework);
  const appraisalScore = calculateDomainMean(app.responses);
  const voteCount = extractionId => votes.filter(v => v.extraction_id === extractionId).length;
  const myVote = slotId => votes.find(v => v.slot_id === slotId && v.user_id === user?.id)?.extraction_id;

  function chooseFramework(frameworkId, frameworkRows = frameworks, existingRows = appraisals, publicationYear = work?.publication_year) {
    const framework = frameworkRows.find(f => f.id === frameworkId);
    const mine = existingRows.find(a => a.framework_id === frameworkId && a.user_id === user?.id);
    setApp({
      framework_id: frameworkId,
      responses: makeInitialResponses(framework, publicationYear, mine?.responses || null),
      rationale: mine?.rationale || '',
      visibility: mine?.visibility || 'public',
      owner_org_id: mine?.owner_org_id || '',
    });
  }

  async function claim() {
    if (!user) return;
    const { data, error } = await supabase.rpc('rse_claim_authorship', { p_work_id: id });
    setMsg(error ? error.message : data?.status === 'verified' ? 'Authorship verified through your connected ORCID.' : 'Authorship claim submitted for verification.');
    await load();
  }

  async function saveWorkMetadata(e) {
    e.preventDefault();
    if (!canEditWork) return;
    const reason = workForm.change_reason.trim() || 'Metadata correction';
    const { error } = await supabase.rpc('rse_update_work_metadata', {
      p_work_id: id,
      p_title: workForm.title.trim(),
      p_abstract: cleanJatsText(workForm.abstract) || null,
      p_journal: workForm.journal || null,
      p_publication_year: workForm.publication_year ? Number(workForm.publication_year) : null,
      p_url: workForm.url || null,
      p_citation: workForm.citation || null,
      p_change_reason: reason,
    });
    setMsg(error ? error.message : 'Paper metadata updated and recorded in the audit history.');
    if (!error) { setEditingWork(false); await load(); }
  }

  async function addCohort(e) {
    e.preventDefault();
    if (!user) return;
    if (cohortForm.visibility === 'organization' && !cohortForm.owner_org_id) { setMsg('Choose an organization for organization-only evidence.'); return; }
    const payload = {
      ...cohortForm,
      sample_size: num(cohortForm.sample_size),
      owner_org_id: cohortForm.visibility === 'organization' ? cohortForm.owner_org_id : null,
      work_id: id,
      created_by: user.id,
    };
    const { error } = await supabase.from('rse_cohorts').insert(payload);
    setMsg(error ? error.message : 'Cohort added. Evidence extracted into this cohort inherits its access scope.');
    if (!error) {
      setCohortForm({ label: '', patient_population: '', intervention: '', comparator: '', sample_size: '', visibility: 'public', owner_org_id: '' });
      await load();
    }
  }

  async function findOrCreateConcept(label, type) {
    const existing = concepts.find(x => x.label.toLowerCase() === label.toLowerCase());
    if (existing) return existing;
    const { data, error } = await supabase.from('rse_outcome_concepts').insert({ label, slug: `${slugify(label)}-${Math.random().toString(36).slice(2, 6)}`, default_outcome_type: type, created_by: user.id }).select().single();
    if (error) throw error;
    return data;
  }

  async function addExtraction(e) {
    e.preventDefault();
    if (!user) return;
    setMsg('');
    try {
      const cohort = cohorts.find(c => c.id === ev.cohort_id);
      if (!cohort) throw new Error('Choose a cohort first.');
      const concept = await findOrCreateConcept(ev.outcome_label.trim(), ev.outcome_type);
      let { data: slot } = await supabase.from('rse_evidence_slots').select('*')
        .eq('work_id', id).eq('cohort_id', ev.cohort_id).eq('outcome_concept_id', concept.id).eq('outcome_type', ev.outcome_type)
        .ilike('timepoint_label', ev.timepoint_label || '').ilike('subgroup_label', ev.subgroup_label || '').maybeSingle();
      if (!slot) {
        const r = await supabase.from('rse_evidence_slots').insert({
          work_id: id,
          cohort_id: ev.cohort_id,
          outcome_concept_id: concept.id,
          outcome_type: ev.outcome_type,
          timepoint_label: ev.timepoint_label || '',
          subgroup_label: ev.subgroup_label || '',
          units: ev.units || null,
          created_by: user.id,
        }).select().single();
        if (r.error) throw r.error;
        slot = r.data;
      }
      const payload = {
        slot_id: slot.id,
        mean: num(ev.mean), sd: num(ev.sd), n: num(ev.n), events: num(ev.events),
        total_exposure: num(ev.total_exposure), reported_value: num(ev.reported_value),
        source_locator: ev.source_locator || null, extraction_notes: ev.extraction_notes || null,
        created_by: user.id,
      };
      const r = await supabase.from('rse_extractions').insert(payload).select().single();
      if (r.error) throw r.error;
      await supabase.from('rse_extraction_votes').upsert({ slot_id: slot.id, extraction_id: r.data.id, user_id: user.id });
      setMsg(`Extraction added as ${cohort.visibility === 'organization' ? 'organization-only' : cohort.visibility} evidence.`);
      setEv(x => ({ ...emptyEvidence, cohort_id: x.cohort_id, outcome_type: x.outcome_type }));
      await load();
    } catch (err) {
      setMsg(err.code === '23505' ? 'That evidence slot or exact extraction already exists. Confirm the existing extraction instead.' : err.message);
    }
  }

  async function vote(slotId, extractionId) {
    if (!user) return;
    await supabase.from('rse_extraction_votes').upsert({ slot_id: slotId, extraction_id: extractionId, user_id: user.id }, { onConflict: 'slot_id,user_id' });
    await load();
  }

  async function challenge(extractionId) {
    if (!user) return;
    const rationale = window.prompt('Describe the problem with this extraction and the evidence supporting your challenge.');
    if (!rationale) return;
    const reason = window.prompt('Reason code: numerator, denominator, outcome, cohort, timepoint, calculation, source, other', 'other') || 'other';
    const { error } = await supabase.from('rse_challenges').insert({ extraction_id: extractionId, created_by: user.id, reason_code: reason, rationale });
    setMsg(error ? error.message : 'Challenge submitted.');
    await load();
  }

  async function editExtraction(x) {
    if (user?.id !== x.created_by) return;
    const reason = window.prompt('Why are you changing this extraction?', 'Correction after review');
    if (!reason) return;
    const events = window.prompt('Events', x.events ?? '');
    const n = window.prompt('N', x.n ?? '');
    const exposure = window.prompt('Total exposure', x.total_exposure ?? '');
    const mean = window.prompt('Mean', x.mean ?? '');
    const sd = window.prompt('SD', x.sd ?? '');
    const { error } = await supabase.from('rse_extractions').update({ events: num(events), n: num(n), total_exposure: num(exposure), mean: num(mean), sd: num(sd), last_change_reason: reason }).eq('id', x.id);
    setMsg(error ? error.message : 'Extraction updated and a new immutable version was recorded.');
    await load();
  }

  async function resolveChallenge(ch, status) {
    const notes = window.prompt(`Resolution note for ${status}:`, '');
    const { error } = await supabase.from('rse_challenges').update({ status, resolution_notes: notes || null, resolved_by: user.id, resolved_at: new Date().toISOString() }).eq('id', ch.id);
    setMsg(error ? error.message : `Challenge ${status}.`);
    await load();
  }

  async function saveAppraisal(e) {
    e.preventDefault();
    if (!user || !selectedFramework) return;
    if (!appraisalComplete(selectedFramework, app.responses)) { setMsg('Complete every appraisal domain before saving.'); return; }
    if (app.visibility === 'organization' && !app.owner_org_id) { setMsg('Choose the organization that should have access to this appraisal.'); return; }
    const score = calculateDomainMean(app.responses);
    const { error } = await supabase.from('rse_appraisals').upsert({
      work_id: id,
      framework_id: app.framework_id,
      user_id: user.id,
      quality_score: score,
      responses: app.responses,
      rationale: app.rationale || null,
      visibility: app.visibility,
      owner_org_id: app.visibility === 'organization' ? app.owner_org_id : null,
    }, { onConflict: 'work_id,framework_id,user_id' });
    setMsg(error ? error.message : `Appraisal saved at ${score.toFixed(2)} / 5, calculated as the arithmetic mean of the domain scores.`);
    await load();
  }

  if (!work) return <div className="empty-state">Loading paper…</div>;
  const workOrgName = orgMap.get(work.owner_org_id)?.name;

  return <section>
    <div className="page-title"><div>
      <div className="eyebrow">{work.work_type?.replaceAll('_', ' ')} {work.publication_year ? `• ${work.publication_year}` : ''}</div>
      <h1>{work.title}</h1>
      <p>{[work.journal, work.doi && `DOI ${work.doi}`, work.pmid && `PMID ${work.pmid}`].filter(Boolean).join(' • ')}</p>
      <div className="tag-row"><ScopeBadge visibility={work.visibility || (work.is_public ? 'public' : 'private')} orgName={workOrgName} />{claimStatus?.status === 'verified' && <span className="tag verified-tag">Verified author</span>}{claimStatus?.status === 'pending' && <span className="tag">Authorship claim pending</span>}</div>
    </div><div className="row-actions">
      {user && claimStatus?.status !== 'verified' && <button className="button secondary" onClick={claim}>Claim authorship</button>}
      {canEditWork && <button className="button secondary" onClick={() => setEditingWork(!editingWork)}><Edit3 size={15} /> Edit paper metadata</button>}
    </div></div>

    {msg && <div className="notice">{msg}</div>}

    {editingWork && canEditWork && <form className="card form-grid" onSubmit={saveWorkMetadata}>
      <div className="span2"><h2>Edit paper metadata</h2><p className="muted tiny">The original contributor retains edit access. ORCID-verified authors also receive edit access. Every saved metadata revision is versioned rather than overwriting the audit history.</p></div>
      <label className="span2">Title<input required value={workForm.title || ''} onChange={e => setWorkForm({ ...workForm, title: e.target.value })} /></label>
      <label>Journal<input value={workForm.journal || ''} onChange={e => setWorkForm({ ...workForm, journal: e.target.value })} /></label>
      <label>Publication year<input value={workForm.publication_year || ''} onChange={e => setWorkForm({ ...workForm, publication_year: e.target.value })} inputMode="numeric" /></label>
      <label className="span2">URL<input value={workForm.url || ''} onChange={e => setWorkForm({ ...workForm, url: e.target.value })} /></label>
      <label className="span2">Citation<input value={workForm.citation || ''} onChange={e => setWorkForm({ ...workForm, citation: e.target.value })} /></label>
      <label className="span2">Abstract<textarea rows="10" value={workForm.abstract || ''} onChange={e => setWorkForm({ ...workForm, abstract: e.target.value })} /></label>
      <label className="span2">Reason for change<input required value={workForm.change_reason || ''} onChange={e => setWorkForm({ ...workForm, change_reason: e.target.value })} placeholder="e.g., Removed JATS markup; corrected abstract from publisher metadata" /></label>
      <div className="span2 row-actions"><button className="button primary">Save metadata revision</button><button type="button" className="button ghost" onClick={() => setEditingWork(false)}>Cancel</button></div>
    </form>}

    {work.abstract && <div className="card"><h2>Abstract</h2><p className="prewrap">{cleanJatsText(work.abstract)}</p></div>}

    <div className="two-column"><section>
      <div className="card"><h2>Authors</h2>{authors.map(a => <div key={a.id}>{a.linked_profile?.username ? <Link to={`/u/${a.linked_profile.username}`}>{a.full_name}</Link> : a.full_name} {a.orcid && <span className="muted tiny">ORCID {a.orcid}</span>}</div>)}{!authors.length && <div className="muted">No author metadata.</div>}</div>
      <div className="section-heading"><div><div className="eyebrow">Structured evidence</div><h2>Evidence slots and competing extractions</h2></div></div>
      {slots.map(s => {
        const cohort = cohortMap.get(s.cohort_id);
        return <div className="card evidence-slot" key={s.id}>
          <div className="slot-head"><div><h3>{conceptMap.get(s.outcome_concept_id)?.label || 'Outcome'}</h3><div className="muted">{cohort?.label} {s.timepoint_label && `• ${s.timepoint_label}`} {s.subgroup_label && `• ${s.subgroup_label}`} • {s.outcome_type}</div><div className="tag-row"><ScopeBadge visibility={cohort?.visibility || 'public'} orgName={orgMap.get(cohort?.owner_org_id)?.name} /></div></div><span className="tag">{extractions.filter(x => x.slot_id === s.id).length} proposal(s)</span></div>
          {extractions.filter(x => x.slot_id === s.id).map(x => <div className={`extraction-row ${myVote(s.id) === x.id ? 'selected' : ''}`} key={x.id}><div><strong>{s.outcome_type === 'continuous' ? `mean ${x.mean} (SD ${x.sd}), n=${x.n}` : s.outcome_type === 'rate' ? `${x.events} events / ${x.total_exposure} exposure` : `${x.events}/${x.n}`}</strong><div className="muted tiny">Source: {x.source_locator || 'not specified'} • Extracted by {x.creator?.display_name || x.creator?.username || 'contributor'} • {voteCount(x.id)} confirmations</div>{x.extraction_notes && <div className="tiny">{x.extraction_notes}</div>}</div><div className="row-actions">{user && <button className="button mini" onClick={() => vote(s.id, x.id)}><Vote size={14} /> {myVote(s.id) === x.id ? 'Confirmed' : 'Confirm'}</button>}{user && <button className="button mini ghost" onClick={() => challenge(x.id)}><Flag size={14} /> Challenge</button>}{user?.id === x.created_by && <button className="button mini ghost" onClick={() => editExtraction(x)}>Edit</button>}</div></div>)}
        </div>;
      })}
      {!slots.length && <div className="empty-state">No structured endpoints yet. Be the first contributor.</div>}
    </section>

    <aside>
      {user && <>
        <form className="card form-stack" onSubmit={addCohort}><h2><Plus size={17} /> Add cohort</h2>
          <label>Evidence access<select value={cohortForm.visibility} onChange={e => setCohortForm({ ...cohortForm, visibility: e.target.value, owner_org_id: e.target.value === 'organization' ? cohortForm.owner_org_id : '' })}><option value="public">Public Commons</option><option value="private">Private to me</option><option value="organization">Organization only</option></select></label>
          {cohortForm.visibility === 'organization' && <label>Organization<select required value={cohortForm.owner_org_id} onChange={e => setCohortForm({ ...cohortForm, owner_org_id: e.target.value })}><option value="">Select</option>{orgs.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
          <label>Label<input required value={cohortForm.label} onChange={e => setCohortForm({ ...cohortForm, label: e.target.value })} /></label>
          <label>Patient population<input value={cohortForm.patient_population} onChange={e => setCohortForm({ ...cohortForm, patient_population: e.target.value })} /></label>
          <label>Intervention/device/drug<input value={cohortForm.intervention} onChange={e => setCohortForm({ ...cohortForm, intervention: e.target.value })} /></label>
          <label>Comparator<input value={cohortForm.comparator} onChange={e => setCohortForm({ ...cohortForm, comparator: e.target.value })} /></label>
          <label>Sample size<input value={cohortForm.sample_size} onChange={e => setCohortForm({ ...cohortForm, sample_size: e.target.value })} /></label>
          <button className="button secondary">Add cohort</button>
        </form>

        <form className="card form-stack" onSubmit={addExtraction}><h2>Extract endpoint</h2>
          <label>Cohort<select required value={ev.cohort_id} onChange={e => setEv({ ...ev, cohort_id: e.target.value })}><option value="">Select</option>{cohorts.map(c => <option value={c.id} key={c.id}>{c.label} [{c.visibility || 'public'}]</option>)}</select></label>
          <p className="muted tiny">The extraction inherits the selected cohort's access scope.</p>
          <label>Outcome concept<input required list="outcomes" value={ev.outcome_label} onChange={e => setEv({ ...ev, outcome_label: e.target.value })} /><datalist id="outcomes">{concepts.map(o => <option value={o.label} key={o.id} />)}</datalist></label>
          <label>Type<select value={ev.outcome_type} onChange={e => setEv({ ...ev, outcome_type: e.target.value })}><option value="proportion">Proportion</option><option value="rate">Rate</option><option value="continuous">Continuous</option></select></label>
          <label>Timepoint<input value={ev.timepoint_label} onChange={e => setEv({ ...ev, timepoint_label: e.target.value })} placeholder="e.g., 90 days" /></label>
          <label>Subgroup<input value={ev.subgroup_label} onChange={e => setEv({ ...ev, subgroup_label: e.target.value })} /></label>
          {ev.outcome_type === 'continuous' ? <><label>Mean<input value={ev.mean} onChange={e => setEv({ ...ev, mean: e.target.value })} /></label><label>SD<input value={ev.sd} onChange={e => setEv({ ...ev, sd: e.target.value })} /></label><label>N<input value={ev.n} onChange={e => setEv({ ...ev, n: e.target.value })} /></label></> : ev.outcome_type === 'rate' ? <><label>Events<input value={ev.events} onChange={e => setEv({ ...ev, events: e.target.value })} /></label><label>Total exposure<input value={ev.total_exposure} onChange={e => setEv({ ...ev, total_exposure: e.target.value })} /></label></> : <><label>Events<input value={ev.events} onChange={e => setEv({ ...ev, events: e.target.value })} /></label><label>N<input value={ev.n} onChange={e => setEv({ ...ev, n: e.target.value })} /></label></>}
          <label>Source location<input value={ev.source_locator} onChange={e => setEv({ ...ev, source_locator: e.target.value })} placeholder="Table 2, p. 7" /></label>
          <label>Notes<textarea rows="3" value={ev.extraction_notes} onChange={e => setEv({ ...ev, extraction_notes: e.target.value })} /></label>
          <button className="button primary">Add extraction</button>
        </form>
      </>}

      <div className="card"><h2>Community appraisal</h2><p className="muted tiny">Every appraisal score is calculated as the arithmetic mean of its domain scores. RAW uses the selected framework's community mean appraisal.</p>
        {appraisals.map(a => <div className="appraisal-row" key={a.id}><div><strong>{Number(a.quality_score).toFixed(2)} / 5</strong><div className="tiny">{scoreLabel(a.quality_score)}</div></div><div>{a.profile?.display_name || a.profile?.username}<div className="muted tiny">{a.framework?.name} • {a.visibility || 'public'}</div>{a.rationale && <div className="muted tiny">{a.rationale}</div>}</div></div>)}
        {user && selectedFramework && <form className="form-stack compact" onSubmit={saveAppraisal}>
          <label>Framework<select value={app.framework_id} onChange={e => chooseFramework(e.target.value)}>{frameworks.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label>
          {selectedFramework.description && <p className="muted tiny">{selectedFramework.description}</p>}
          {domains.map(domain => <label key={domain.key}>{domain.label}<select required value={app.responses?.domains?.[domain.key]?.value || ''} onChange={e => setApp({ ...app, responses: setDomainResponse(app.responses, domain, e.target.value) })}><option value="">Select</option>{(domain.options || []).map(o => <option value={o.value} key={o.value}>{o.label}</option>)}</select>{domain.description && <span className="muted tiny">{domain.description}{domain.auto === 'temporality_from_publication_year' && work.publication_year ? ` Auto-suggested from ${work.publication_year}; you may override it.` : ''}</span>}</label>)}
          <div className="score-preview"><span>Calculated appraisal</span><strong>{Number.isFinite(appraisalScore) ? `${appraisalScore.toFixed(2)} / 5` : 'Complete domains'}</strong></div>
          <label>Appraisal access<select value={app.visibility} onChange={e => setApp({ ...app, visibility: e.target.value, owner_org_id: e.target.value === 'organization' ? app.owner_org_id : '' })}><option value="public">Public community appraisal</option><option value="private">Private to me</option><option value="organization">Organization only</option></select></label>
          {app.visibility === 'organization' && <label>Organization<select required value={app.owner_org_id} onChange={e => setApp({ ...app, owner_org_id: e.target.value })}><option value="">Select</option>{orgs.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
          <label>Rationale<textarea rows="3" value={app.rationale} onChange={e => setApp({ ...app, rationale: e.target.value })} /></label>
          <button className="button secondary">Save independent appraisal</button>
        </form>}
      </div>

      <div className="card"><h2>Open challenges</h2>{challenges.filter(c => c.status === 'open').map(c => { const x = extractions.find(e => e.id === c.extraction_id); return <div className="challenge" key={c.id}><strong>{c.reason_code}</strong><p>{c.rationale}</p><div className="muted tiny">{formatDate(c.created_at)}</div>{user?.id === x?.created_by && <div className="row-actions"><button className="button mini" onClick={() => resolveChallenge(c, 'accepted')}><Check size={13} /> Accept</button><button className="button mini ghost" onClick={() => resolveChallenge(c, 'rejected')}>Reject</button></div>}</div>; })}{!challenges.some(c => c.status === 'open') && <div className="muted">No open challenges.</div>}</div>

      {canEditWork && <div className="card"><h2>Paper metadata history</h2>{workVersions.map(v => <div className="history-row" key={v.id}><strong>v{v.version_no}</strong><div className="muted tiny">{formatDate(v.created_at)}{v.change_reason ? ` • ${v.change_reason}` : ''}</div></div>)}{!workVersions.length && <div className="muted">No revisions recorded yet.</div>}</div>}
    </aside></div>
  </section>;
}
