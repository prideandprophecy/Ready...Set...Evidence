import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Edit3, Flag, Plus, Trash2, Vote } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { cleanJatsText, formatDate, slugify } from '../lib/identifiers';
import { appraisalComplete, calculateDomainMean, frameworkDomains, makeInitialResponses, scoreLabel, setDomainResponse } from '../lib/appraisal';
import FacetPicker, { facetSummary, facetTypeLabel } from '../components/FacetPicker';

const num = v => v === '' || v == null ? null : Number(v);
const emptyEvidence = { cohort_id: '', outcome_label: '', outcome_type: 'proportion', timepoint_label: '', subgroup_label: '', units: '', mean: '', sd: '', n: '', events: '', total_exposure: '', reported_value: '', source_locator: '', extraction_notes: '' };
const emptyCohort = { label: 'Overall cohort', description: '', cohort_type: 'overall', parent_cohort_id: '', sample_size: '', visibility: 'public', owner_org_id: '' };

function ScopeBadge({ visibility, orgName }) {
  if (visibility === 'organization') return <span className="tag private-tag">Organization: {orgName || 'members'}</span>;
  if (visibility === 'private') return <span className="tag private-tag">Private</span>;
  return <span className="tag public-tag">Public</span>;
}

function GroupTypeBadge({ type }) {
  const label = type === 'arm' ? 'Study arm' : type === 'subgroup' ? 'Subgroup' : 'Overall cohort';
  return <span className="tag">{label}</span>;
}

function ProposalList({ items = [], canResolve = false, onResolve }) {
  if (!items.length) return null;
  return <div className="subtle-callout" style={{ marginTop: 12 }}>
    <strong>Suggested edits</strong>
    {items.map(p => <div key={p.id} style={{ marginTop: 10 }}>
      <div className="tiny"><strong>{p.creator?.display_name || p.creator?.username || 'Contributor'}</strong>: {p.rationale}</div>
      <div className="muted tiny">{Object.entries(p.proposed_patch || {}).map(([k, v]) => `${k.replaceAll('_', ' ')} → ${v ?? 'blank'}`).join(' • ')}</div>
      {canResolve && <div className="row-actions" style={{ marginTop: 6 }}>
        <button type="button" className="button mini" onClick={() => onResolve(p, 'accepted')}>Accept</button>
        <button type="button" className="button mini ghost" onClick={() => onResolve(p, 'rejected')}>Reject</button>
      </div>}
    </div>)}
  </div>;
}

export default function WorkPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [work, setWork] = useState(null);
  const [authors, setAuthors] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [cohortFacets, setCohortFacets] = useState({});
  const [comparisons, setComparisons] = useState([]);
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
  const [editProposals, setEditProposals] = useState([]);
  const [editingCohortId, setEditingCohortId] = useState(null);
  const [cohortEdit, setCohortEdit] = useState({});
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [slotEdit, setSlotEdit] = useState({});
  const [msg, setMsg] = useState('');

  const [cohortForm, setCohortForm] = useState(emptyCohort);
  const [pendingFacets, setPendingFacets] = useState([]);
  const [compareForm, setCompareForm] = useState({ label: '', group_a_cohort_id: '', group_b_cohort_id: '' });
  const [ev, setEv] = useState(emptyEvidence);
  const [app, setApp] = useState({ framework_id: '', responses: { domains: {} }, rationale: '', visibility: 'public', owner_org_id: '' });

  useEffect(() => { load(); }, [id, user?.id]);

  async function load() {
    setMsg('');
    const [w, a, c, o, s, ap, f, myOrgs, versions, claim, editPermission] = await Promise.all([
      supabase.from('rse_works').select('*').eq('id', id).single(),
      supabase.from('rse_work_authors').select('*,linked_profile:rse_profiles!linked_profile_id(username,display_name)').eq('work_id', id).order('author_order'),
      supabase.from('rse_cohorts').select('*').eq('work_id', id).order('created_at'),
      supabase.from('rse_outcome_concepts').select('*').order('label'),
      supabase.from('rse_evidence_slots').select('*').eq('work_id', id).order('created_at'),
      supabase.from('rse_appraisals').select('*,profile:rse_profiles!user_id(username,display_name),framework:rse_appraisal_frameworks(name,slug,response_schema)').eq('work_id', id).order('created_at'),
      supabase.from('rse_appraisal_frameworks').select('*').eq('is_public', true).order('name'),
      user ? supabase.from('rse_org_members').select('role,status,org:rse_organizations(id,name,slug)').eq('user_id', user.id).eq('status', 'active') : Promise.resolve({ data: [] }),
      supabase.from('rse_work_versions').select('id,version_no,change_reason,changed_by,created_at').eq('work_id', id).order('version_no', { ascending: false }).limit(8),
      user ? supabase.from('rse_authorship_claims').select('*').eq('work_id', id).eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
      user ? supabase.rpc('rse_can_edit_work', { p_work_id: id, p_user_id: user.id }) : Promise.resolve({ data: false }),
    ]);

    const cohortIds = (c.data || []).map(x => x.id);
    const slotIds = (s.data || []).map(x => x.id);

    const [facetLinks, comps, e, v] = await Promise.all([
      cohortIds.length ? supabase.from('rse_cohort_concepts').select('cohort_id,concept:rse_concepts(id,canonical_label,concept_type,visibility,owner_org_id,parent_concept_id,created_by)').in('cohort_id', cohortIds) : Promise.resolve({ data: [] }),
      supabase.from('rse_comparisons').select('*').eq('work_id', id).order('created_at'),
      slotIds.length ? supabase.from('rse_extractions').select('*,creator:rse_profiles!created_by(username,display_name)').in('slot_id', slotIds).order('created_at') : Promise.resolve({ data: [] }),
      slotIds.length ? supabase.from('rse_extraction_votes').select('*').in('slot_id', slotIds) : Promise.resolve({ data: [] }),
    ]);

    const extractionIds = (e.data || []).map(x => x.id);
    const ch = extractionIds.length
      ? await supabase.from('rse_challenges').select('*').in('extraction_id', extractionIds).order('created_at', { ascending: false })
      : { data: [] };

    const conceptIds = [...new Set((facetLinks.data || []).map(x => x.concept?.id).filter(Boolean))];
    const proposalTargetIds = [...new Set([...cohortIds, ...slotIds, ...extractionIds, ...conceptIds])];
    const proposals = proposalTargetIds.length
      ? await supabase.from('rse_edit_proposals')
          .select('*,creator:rse_profiles!created_by(username,display_name)')
          .in('target_id', proposalTargetIds)
          .order('created_at', { ascending: false })
      : { data: [] };

    const facetMap = {};
    for (const link of facetLinks.data || []) {
      if (!facetMap[link.cohort_id]) facetMap[link.cohort_id] = [];
      if (link.concept) facetMap[link.cohort_id].push(link.concept);
    }
    Object.values(facetMap).forEach(items => items.sort((x, y) => `${x.concept_type}:${x.canonical_label}`.localeCompare(`${y.concept_type}:${y.canonical_label}`)));

    setWork(w.data || null);
    setAuthors(a.data || []);
    setCohorts(c.data || []);
    setCohortFacets(facetMap);
    setComparisons(comps.data || []);
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
    setEditProposals(proposals.data || []);

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
    if (!compareForm.group_a_cohort_id && c.data?.length >= 2) setCompareForm(x => ({ ...x, group_a_cohort_id: c.data[0].id, group_b_cohort_id: c.data[1].id }));
    if (!app.framework_id && f.data?.length) {
      const preferred = (f.data || []).find(x => x.slug === 'rse-custom') || f.data[0];
      chooseFramework(preferred.id, f.data, ap.data || [], w.data?.publication_year);
    }
  }

  const conceptMap = useMemo(() => new Map(concepts.map(x => [x.id, x])), [concepts]);
  const cohortMap = useMemo(() => new Map(cohorts.map(x => [x.id, x])), [cohorts]);
  const orgMap = useMemo(() => new Map(orgs.map(x => [x.id, x])), [orgs]);
  const selectedFramework = frameworks.find(f => f.id === app.framework_id) || null;
  const domains = frameworkDomains(selectedFramework);
  const appraisalScore = calculateDomainMean(app.responses);
  const voteCount = extractionId => votes.filter(v => v.extraction_id === extractionId).length;
  const myVote = slotId => votes.find(v => v.slot_id === slotId && v.user_id === user?.id)?.extraction_id;

  function canEditGroup(cohort) {
    if (!user || !cohort) return false;
    return canEditWork || cohort.created_by === user.id || (cohort.visibility === 'organization' && orgs.some(o => o.id === cohort.owner_org_id));
  }

  function canEditSlot(slot) {
    if (!user || !slot) return false;
    return canEditWork || slot.created_by === user.id;
  }

  const proposalsFor = (targetType, targetId) =>
    editProposals.filter(p => p.target_type === targetType && p.target_id === targetId && p.status === 'open');

  async function submitEditProposal(targetType, targetId, proposalKind, proposedPatch, rationale) {
    if (!user) return;
    const { error } = await supabase.from('rse_edit_proposals').insert({
      target_type: targetType,
      target_id: targetId,
      proposal_kind: proposalKind || 'edit',
      proposed_patch: proposedPatch || {},
      rationale,
      created_by: user.id,
    });
    setMsg(error ? error.message : 'Suggested edit submitted for review.');
    if (!error) await load();
  }

  async function resolveEditProposal(proposal, status) {
    if (!user) return;
    const notes = window.prompt(`Resolution note for ${status}:`, '') || null;
    const { error } = await supabase.rpc('rse_resolve_edit_proposal', {
      p_proposal_id: proposal.id,
      p_status: status,
      p_resolution_notes: notes,
    });
    setMsg(error ? error.message : `Suggested edit ${status}.`);
    if (!error) await load();
  }

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
      label: cohortForm.label.trim(),
      description: cohortForm.description || null,
      cohort_type: cohortForm.cohort_type,
      parent_cohort_id: cohortForm.parent_cohort_id || null,
      sample_size: num(cohortForm.sample_size),
      visibility: cohortForm.visibility,
      owner_org_id: cohortForm.visibility === 'organization' ? cohortForm.owner_org_id : null,
      work_id: id,
      created_by: user.id,
    };
    const { data, error } = await supabase.from('rse_cohorts').insert(payload).select().single();
    if (error) {
      setMsg(error.message);
      return;
    }

    let facetError = null;
    if (pendingFacets.length) {
      const rows = pendingFacets.map(concept => ({ cohort_id: data.id, concept_id: concept.id, created_by: user.id }));
      const facetResult = await supabase.from('rse_cohort_concepts').upsert(rows, { onConflict: 'cohort_id,concept_id' });
      facetError = facetResult.error;
    }

    if (facetError) {
      setMsg(`Study group added, but its structured facets could not be linked: ${facetError.message}`);
    } else {
      setMsg(`Study group added${pendingFacets.length ? ` with ${pendingFacets.length} structured facet${pendingFacets.length === 1 ? '' : 's'}` : ''}.`);
    }
    setCohortForm({ ...emptyCohort, label: '' });
    setPendingFacets([]);
    setEv(x => ({ ...x, cohort_id: x.cohort_id || data.id }));
    await load();
  }

  async function addFacet(cohort, concept) {
    if (!user || !canEditGroup(cohort)) return;
    const { error } = await supabase.from('rse_cohort_concepts').upsert({ cohort_id: cohort.id, concept_id: concept.id, created_by: user.id }, { onConflict: 'cohort_id,concept_id' });
    setMsg(error ? error.message : `${concept.canonical_label} added to ${cohort.label}.`);
    if (!error) await load();
  }

  async function removeFacet(cohort, concept) {
    if (!user || !canEditGroup(cohort)) return;
    const { error } = await supabase.from('rse_cohort_concepts').delete().eq('cohort_id', cohort.id).eq('concept_id', concept.id);
    setMsg(error ? error.message : `${concept.canonical_label} removed from ${cohort.label}.`);
    if (!error) await load();
  }

  function startEditCohort(cohort) {
    setEditingCohortId(cohort.id);
    setCohortEdit({
      label: cohort.label || '',
      description: cohort.description || '',
      cohort_type: cohort.cohort_type || 'overall',
      parent_cohort_id: cohort.parent_cohort_id || '',
      sample_size: cohort.sample_size ?? '',
      visibility: cohort.visibility || 'public',
      owner_org_id: cohort.owner_org_id || '',
      change_reason: '',
    });
  }

  async function saveCohortEdit(e, cohort) {
    e.preventDefault();
    if (!canEditGroup(cohort)) return;
    const payload = {
      label: cohortEdit.label.trim(),
      description: cohortEdit.description || null,
      cohort_type: cohortEdit.cohort_type,
      parent_cohort_id: cohortEdit.cohort_type === 'overall' ? null : (cohortEdit.parent_cohort_id || null),
      sample_size: num(cohortEdit.sample_size),
      visibility: cohortEdit.visibility,
      owner_org_id: cohortEdit.visibility === 'organization' ? (cohortEdit.owner_org_id || null) : null,
      last_change_reason: cohortEdit.change_reason.trim() || 'Study-group correction',
    };
    const { error } = await supabase.from('rse_cohorts').update(payload).eq('id', cohort.id);
    setMsg(error ? error.message : 'Study group updated and versioned.');
    if (!error) {
      setEditingCohortId(null);
      setCohortEdit({});
      await load();
    }
  }

  async function proposeCohortEdit(cohort) {
    if (!user) return;
    const label = window.prompt('Proposed study-group label', cohort.label || '');
    if (label == null) return;
    const description = window.prompt('Proposed description / notes', cohort.description || '');
    if (description == null) return;
    const sampleSize = window.prompt('Proposed sample size', cohort.sample_size ?? '');
    if (sampleSize == null) return;
    const rationale = window.prompt('Why should this study group be changed?');
    if (!rationale) return;
    const patch = {};
    if (label.trim() !== (cohort.label || '')) patch.label = label.trim();
    if (description !== (cohort.description || '')) patch.description = description;
    if (String(sampleSize) !== String(cohort.sample_size ?? '')) patch.sample_size = sampleSize;
    if (!Object.keys(patch).length) {
      setMsg('No changes were proposed.');
      return;
    }
    await submitEditProposal('cohort', cohort.id, 'edit', patch, rationale);
  }

  async function suggestFacetRename(concept) {
    if (!user) return;
    const proposed = window.prompt('Proposed canonical name for this facet', concept.canonical_label || '');
    if (!proposed || proposed.trim() === concept.canonical_label) return;
    const rationale = window.prompt('Why should this canonical facet name change?');
    if (!rationale) return;
    await submitEditProposal('concept', concept.id, 'rename', { canonical_label: proposed.trim() }, rationale);
  }

  function startEditSlot(slot) {
    setEditingSlotId(slot.id);
    setSlotEdit({
      cohort_id: slot.cohort_id || '',
      outcome_type: slot.outcome_type || 'proportion',
      timepoint_label: slot.timepoint_label || '',
      units: slot.units || '',
      notes: slot.notes || '',
      change_reason: '',
    });
  }

  async function saveSlotEdit(e, slot) {
    e.preventDefault();
    if (!canEditSlot(slot)) return;
    const { error } = await supabase.from('rse_evidence_slots').update({
      cohort_id: slotEdit.cohort_id,
      outcome_type: slotEdit.outcome_type,
      timepoint_label: slotEdit.timepoint_label || '',
      units: slotEdit.units || null,
      notes: slotEdit.notes || null,
      last_change_reason: slotEdit.change_reason.trim() || 'Endpoint-definition correction',
    }).eq('id', slot.id);
    setMsg(error ? error.message : 'Endpoint definition updated and versioned.');
    if (!error) {
      setEditingSlotId(null);
      setSlotEdit({});
      await load();
    }
  }

  async function proposeSlotEdit(slot) {
    if (!user) return;
    const timepoint = window.prompt('Proposed timepoint', slot.timepoint_label || '');
    if (timepoint == null) return;
    const units = window.prompt('Proposed units', slot.units || '');
    if (units == null) return;
    const notes = window.prompt('Proposed endpoint notes', slot.notes || '');
    if (notes == null) return;
    const rationale = window.prompt('Why should this endpoint definition be changed?');
    if (!rationale) return;
    const patch = {};
    if (timepoint !== (slot.timepoint_label || '')) patch.timepoint_label = timepoint;
    if (units !== (slot.units || '')) patch.units = units;
    if (notes !== (slot.notes || '')) patch.notes = notes;
    if (!Object.keys(patch).length) {
      setMsg('No changes were proposed.');
      return;
    }
    await submitEditProposal('evidence_slot', slot.id, 'edit', patch, rationale);
  }

  async function proposeExtractionEdit(x) {
    if (!user) return;
    const events = window.prompt('Proposed events', x.events ?? '');
    if (events == null) return;
    const n = window.prompt('Proposed N', x.n ?? '');
    if (n == null) return;
    const exposure = window.prompt('Proposed total exposure', x.total_exposure ?? '');
    if (exposure == null) return;
    const mean = window.prompt('Proposed mean', x.mean ?? '');
    if (mean == null) return;
    const sd = window.prompt('Proposed SD', x.sd ?? '');
    if (sd == null) return;
    const source = window.prompt('Proposed source location', x.source_locator ?? '');
    if (source == null) return;
    const rationale = window.prompt('Why should this extraction be corrected?');
    if (!rationale) return;
    const patch = { events, n, total_exposure: exposure, mean, sd, source_locator: source };
    await submitEditProposal('extraction', x.id, 'edit', patch, rationale);
  }

  async function addComparison(e) {
    e.preventDefault();
    if (!user || !canEditWork) return;
    if (!compareForm.group_a_cohort_id || !compareForm.group_b_cohort_id || compareForm.group_a_cohort_id === compareForm.group_b_cohort_id) {
      setMsg('Choose two different study groups.');
      return;
    }
    const a = cohortMap.get(compareForm.group_a_cohort_id);
    const b = cohortMap.get(compareForm.group_b_cohort_id);
    const label = compareForm.label.trim() || `${a?.label || 'Group A'} vs ${b?.label || 'Group B'}`;
    const { error } = await supabase.from('rse_comparisons').insert({ work_id: id, label, group_a_cohort_id: compareForm.group_a_cohort_id, group_b_cohort_id: compareForm.group_b_cohort_id, created_by: user.id });
    setMsg(error ? error.message : 'Within-study comparison recorded.');
    if (!error) { setCompareForm({ label: '', group_a_cohort_id: '', group_b_cohort_id: '' }); await load(); }
  }

  async function deleteComparison(comparisonId) {
    if (!canEditWork) return;
    const { error } = await supabase.from('rse_comparisons').delete().eq('id', comparisonId);
    setMsg(error ? error.message : 'Comparison removed.');
    if (!error) await load();
  }

  async function findOrCreateOutcomeConcept(label, type) {
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
      if (!cohort) throw new Error('Choose a study group first.');
      const concept = await findOrCreateOutcomeConcept(ev.outcome_label.trim(), ev.outcome_type);
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
          subgroup_label: '',
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
      <div className="muted" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {work.journal && <span>{work.journal}</span>}
        {work.journal && (work.doi || work.pmid) && <span>•</span>}
        {work.doi && <a href={`https://doi.org/${String(work.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`} target="_blank" rel="noreferrer">DOI {String(work.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}</a>}
        {work.doi && work.pmid && <span>•</span>}
        {work.pmid && <span>PMID {work.pmid}</span>}
      </div>
      <div className="tag-row"><ScopeBadge visibility={work.visibility || (work.is_public ? 'public' : 'private')} orgName={workOrgName} />{claimStatus?.status === 'verified' && <span className="tag verified-tag">Verified author</span>}{claimStatus?.status === 'pending' && <span className="tag">Authorship claim pending</span>}</div>
    </div><div className="row-actions">
      {user && claimStatus?.status !== 'verified' && <button className="button secondary" onClick={claim}>Claim authorship</button>}
      {canEditWork && <button className="button secondary" onClick={() => setEditingWork(!editingWork)}><Edit3 size={15} /> Edit paper metadata</button>}
    </div></div>

    {msg && <div className="notice">{msg}</div>}

    {editingWork && canEditWork && <form className="card form-grid" onSubmit={saveWorkMetadata}>
      <div className="span2"><h2>Edit paper metadata</h2><p className="muted tiny">The original contributor retains edit access. ORCID-verified authors also receive edit access. Every saved metadata revision is versioned.</p></div>
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

    <div className="card">
      <div className="section-heading"><div><div className="eyebrow">Study structure</div><h2>Cohorts, arms, and subgroups</h2></div></div>
      <p className="muted">Groups carry reusable structured facets. The facet system is domain-neutral: a group can be tagged with populations, conditions, interventions, devices, drugs/biologics, procedures, tests, exposures, settings, geography, characteristics/variants, or other concepts.</p>
      <div className="stack">
        {cohorts.map(c => {
          const parent = cohortMap.get(c.parent_cohort_id);
          const facets = cohortFacets[c.id] || [];
          return <div className="card" key={c.id} style={{ margin: 0 }}>
            <div className="slot-head">
              <div><h3>{c.label}</h3><div className="tag-row"><GroupTypeBadge type={c.cohort_type} /><ScopeBadge visibility={c.visibility || 'public'} orgName={orgMap.get(c.owner_org_id)?.name} /></div></div>
              <div className="row-actions">
                {c.sample_size != null && <span className="tag">n={c.sample_size}</span>}
                {user && (canEditGroup(c)
                  ? <button type="button" className="button mini ghost" onClick={() => startEditCohort(c)}><Edit3 size={13} /> Edit group</button>
                  : <button type="button" className="button mini ghost" onClick={() => proposeCohortEdit(c)}>Suggest edit</button>)}
              </div>
            </div>
            {parent && <div className="muted tiny">Parent group: {parent.label}</div>}
            {c.description && <p>{c.description}</p>}
            {(c.patient_population || c.intervention || c.indication || c.comparator) && <div className="subtle-callout"><strong>Legacy cohort fields:</strong> {[c.patient_population, c.intervention, c.indication, c.comparator].filter(Boolean).join(' • ')}. These remain preserved but new synthesis uses structured facets.</div>}

            {editingCohortId === c.id && canEditGroup(c) && <form className="form-grid" onSubmit={e => saveCohortEdit(e, c)} style={{ marginTop: 14 }}>
              <label>Group type<select value={cohortEdit.cohort_type || 'overall'} onChange={e => setCohortEdit({ ...cohortEdit, cohort_type: e.target.value, parent_cohort_id: e.target.value === 'overall' ? '' : cohortEdit.parent_cohort_id })}><option value="overall">Overall cohort</option><option value="arm">Study arm</option><option value="subgroup">Subgroup</option></select></label>
              {cohortEdit.cohort_type !== 'overall' && <label>Parent group<select value={cohortEdit.parent_cohort_id || ''} onChange={e => setCohortEdit({ ...cohortEdit, parent_cohort_id: e.target.value })}><option value="">None</option>{cohorts.filter(x => x.id !== c.id).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>}
              <label className="span2">Label<input required value={cohortEdit.label || ''} onChange={e => setCohortEdit({ ...cohortEdit, label: e.target.value })} /></label>
              <label className="span2">Description / notes<textarea rows="3" value={cohortEdit.description || ''} onChange={e => setCohortEdit({ ...cohortEdit, description: e.target.value })} /></label>
              <label>Sample size<input value={cohortEdit.sample_size ?? ''} onChange={e => setCohortEdit({ ...cohortEdit, sample_size: e.target.value })} /></label>
              <label>Evidence access<select value={cohortEdit.visibility || 'public'} onChange={e => setCohortEdit({ ...cohortEdit, visibility: e.target.value, owner_org_id: e.target.value === 'organization' ? cohortEdit.owner_org_id : '' })}><option value="public">Public Commons</option><option value="private">Private to me</option><option value="organization">Organization only</option></select></label>
              {cohortEdit.visibility === 'organization' && <label className="span2">Organization<select required value={cohortEdit.owner_org_id || ''} onChange={e => setCohortEdit({ ...cohortEdit, owner_org_id: e.target.value })}><option value="">Select</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
              <label className="span2">Reason for change<input required value={cohortEdit.change_reason || ''} onChange={e => setCohortEdit({ ...cohortEdit, change_reason: e.target.value })} placeholder="What changed and why?" /></label>
              <div className="span2 row-actions"><button className="button primary">Save group revision</button><button type="button" className="button ghost" onClick={() => setEditingCohortId(null)}>Cancel</button></div>
            </form>}

            {facets.length > 0 && <div className="tag-row">{facets.map(f => <span className="tag" key={f.id}><span className="muted tiny">{facetTypeLabel(f.concept_type)}:</span>&nbsp;{f.canonical_label}{user && <button type="button" title="Suggest a better canonical name" onClick={() => suggestFacetRename(f)} style={{ border: 0, background: 'transparent', color: '#143A6F', padding: '0 0 0 6px', cursor: 'pointer', fontSize: '.78em' }}>rename?</button>}</span>)}</div>}
            {canEditGroup(c) && <FacetPicker
              selected={facets}
              onAdd={concept => addFacet(c, concept)}
              onRemove={concept => removeFacet(c, concept)}
              allowCreate
              conceptVisibility={c.visibility || 'public'}
              ownerOrgId={c.owner_org_id || null}
              searchOrgId={c.visibility === 'organization' ? c.owner_org_id : null}
              includePrivate={c.visibility === 'private'}
              label="Add or remove structured facets"
              help="Examples can be as broad or granular as the evidence requires. Characteristics/variants are generic, not device-specific fields."
            />}
            <ProposalList items={proposalsFor('cohort', c.id)} canResolve={canEditGroup(c)} onResolve={resolveEditProposal} />
            {facets.map(f => <ProposalList key={`proposal-${f.id}`} items={proposalsFor('concept', f.id)} canResolve={f.created_by === user?.id || (f.visibility === 'organization' && orgs.some(o => o.id === f.owner_org_id))} onResolve={resolveEditProposal} />)}
          </div>;
        })}
        {!cohorts.length && <div className="empty-state">No study groups yet.</div>}
      </div>
    </div>

    {comparisons.length > 0 && <div className="card"><h2>Within-study comparisons</h2><p className="muted tiny">These records describe which study groups were directly compared. They do not by themselves manufacture a comparative effect estimate.</p>{comparisons.map(c => <div className="duplicate-row" key={c.id}><div><strong>{c.label}</strong><div className="muted tiny">{cohortMap.get(c.group_a_cohort_id)?.label} vs {cohortMap.get(c.group_b_cohort_id)?.label}</div></div>{canEditWork && <button className="button mini ghost" onClick={() => deleteComparison(c.id)}><Trash2 size={13} /> Remove</button>}</div>)}</div>}

    <div className="two-column"><section>
      <div className="card"><h2>Authors</h2>{authors.map(a => <div key={a.id}>{a.linked_profile?.username ? <Link to={`/u/${a.linked_profile.username}`}>{a.full_name}</Link> : a.full_name} {a.orcid && <span className="muted tiny">ORCID {a.orcid}</span>}</div>)}{!authors.length && <div className="muted">No author metadata.</div>}</div>
      <div className="section-heading"><div><div className="eyebrow">Structured evidence</div><h2>Evidence slots and competing extractions</h2></div></div>
      {slots.map(s => {
        const cohort = cohortMap.get(s.cohort_id);
        const facets = cohortFacets[s.cohort_id] || [];
        return <div className="card evidence-slot" key={s.id}>
          <div className="slot-head">
            <div><h3>{conceptMap.get(s.outcome_concept_id)?.label || 'Outcome'}</h3><div className="muted">{cohort?.label} {s.timepoint_label && `• ${s.timepoint_label}`} {s.subgroup_label && `• legacy subgroup: ${s.subgroup_label}`} • {s.outcome_type}</div>{facets.length > 0 && <div className="muted tiny">{facetSummary(facets)}</div>}<div className="tag-row"><ScopeBadge visibility={cohort?.visibility || 'public'} orgName={orgMap.get(cohort?.owner_org_id)?.name} /></div></div>
            <div className="row-actions"><span className="tag">{extractions.filter(x => x.slot_id === s.id).length} proposal(s)</span>{user && (canEditSlot(s) ? <button type="button" className="button mini ghost" onClick={() => startEditSlot(s)}><Edit3 size={13} /> Edit endpoint</button> : <button type="button" className="button mini ghost" onClick={() => proposeSlotEdit(s)}>Suggest endpoint edit</button>)}</div>
          </div>

          {editingSlotId === s.id && canEditSlot(s) && <form className="form-grid" onSubmit={e => saveSlotEdit(e, s)} style={{ margin: '12px 0' }}>
            <label>Study group<select value={slotEdit.cohort_id || ''} onChange={e => setSlotEdit({ ...slotEdit, cohort_id: e.target.value })}>{cohorts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <label>Outcome type<select value={slotEdit.outcome_type || 'proportion'} onChange={e => setSlotEdit({ ...slotEdit, outcome_type: e.target.value })}><option value="proportion">Proportion</option><option value="rate">Rate</option><option value="continuous">Continuous</option></select></label>
            <label>Timepoint<input value={slotEdit.timepoint_label || ''} onChange={e => setSlotEdit({ ...slotEdit, timepoint_label: e.target.value })} /></label>
            <label>Units<input value={slotEdit.units || ''} onChange={e => setSlotEdit({ ...slotEdit, units: e.target.value })} /></label>
            <label className="span2">Endpoint notes<textarea rows="2" value={slotEdit.notes || ''} onChange={e => setSlotEdit({ ...slotEdit, notes: e.target.value })} /></label>
            <label className="span2">Reason for change<input required value={slotEdit.change_reason || ''} onChange={e => setSlotEdit({ ...slotEdit, change_reason: e.target.value })} placeholder="What changed and why?" /></label>
            <div className="span2 row-actions"><button className="button primary">Save endpoint revision</button><button type="button" className="button ghost" onClick={() => setEditingSlotId(null)}>Cancel</button></div>
          </form>}

          <ProposalList items={proposalsFor('evidence_slot', s.id)} canResolve={canEditSlot(s)} onResolve={resolveEditProposal} />

          {extractions.filter(x => x.slot_id === s.id).map(x => <div key={x.id}>
            <div className={`extraction-row ${myVote(s.id) === x.id ? 'selected' : ''}`}><div><strong>{s.outcome_type === 'continuous' ? `mean ${x.mean} (SD ${x.sd}), n=${x.n}` : s.outcome_type === 'rate' ? `${x.events} events / ${x.total_exposure} exposure` : `${x.events}/${x.n}`}</strong><div className="muted tiny">Source: {x.source_locator || 'not specified'} • Extracted by {x.creator?.display_name || x.creator?.username || 'contributor'} • {voteCount(x.id)} confirmations</div>{x.extraction_notes && <div className="tiny">{x.extraction_notes}</div>}</div><div className="row-actions">{user && <button className="button mini" onClick={() => vote(s.id, x.id)}><Vote size={14} /> {myVote(s.id) === x.id ? 'Confirmed' : 'Confirm'}</button>}{user && <button className="button mini ghost" onClick={() => challenge(x.id)}><Flag size={14} /> Challenge</button>}{user?.id === x.created_by ? <button className="button mini ghost" onClick={() => editExtraction(x)}>Edit values</button> : user && <button className="button mini ghost" onClick={() => proposeExtractionEdit(x)}>Suggest correction</button>}</div></div>
            <ProposalList items={proposalsFor('extraction', x.id)} canResolve={user?.id === x.created_by || canEditWork} onResolve={resolveEditProposal} />
          </div>)}
        </div>;
      })}
      {!slots.length && <div className="empty-state">No structured endpoints yet. Be the first contributor.</div>}
    </section>

    <aside>
      {user && <>
        <form className="card form-stack" onSubmit={addCohort}><h2><Plus size={17} /> Add study group</h2>
          <p className="muted tiny">Create the analytical group first, then attach reusable facets to it. A subgroup can optionally point to its parent group.</p>
          <label>Evidence access<select value={cohortForm.visibility} onChange={e => setCohortForm({ ...cohortForm, visibility: e.target.value, owner_org_id: e.target.value === 'organization' ? cohortForm.owner_org_id : '' })}><option value="public">Public Commons</option><option value="private">Private to me</option><option value="organization">Organization only</option></select></label>
          {cohortForm.visibility === 'organization' && <label>Organization<select required value={cohortForm.owner_org_id} onChange={e => setCohortForm({ ...cohortForm, owner_org_id: e.target.value })}><option value="">Select</option>{orgs.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
          <label>Group type<select value={cohortForm.cohort_type} onChange={e => setCohortForm({ ...cohortForm, cohort_type: e.target.value, parent_cohort_id: e.target.value === 'overall' ? '' : cohortForm.parent_cohort_id })}><option value="overall">Overall cohort</option><option value="arm">Study arm</option><option value="subgroup">Subgroup</option></select></label>
          {cohortForm.cohort_type !== 'overall' && <label>Parent group, optional<select value={cohortForm.parent_cohort_id} onChange={e => setCohortForm({ ...cohortForm, parent_cohort_id: e.target.value })}><option value="">None</option>{cohorts.map(c => <option value={c.id} key={c.id}>{c.label}</option>)}</select></label>}
          <label>Label<input required value={cohortForm.label} onChange={e => setCohortForm({ ...cohortForm, label: e.target.value })} placeholder="e.g., Treatment arm A, Pediatric subgroup" /></label>
          <label>Description / notes<textarea rows="3" value={cohortForm.description} onChange={e => setCohortForm({ ...cohortForm, description: e.target.value })} placeholder="Narrative details that do not need to be synthesis filters" /></label>
          <label>Sample size<input value={cohortForm.sample_size} onChange={e => setCohortForm({ ...cohortForm, sample_size: e.target.value })} /></label>

          <div className="subtle-callout">
            <strong>Structured cohort facets</strong>
            <div className="muted tiny">Add the attributes you expect to filter on later in synthesis. Examples: Pediatric, a disease/indication, a named device or drug, a treatment strategy, a setting, or a characteristic/variant. These are reusable controlled concepts rather than free-text cohort fields.</div>
          </div>
          <FacetPicker
            selected={pendingFacets}
            onAdd={concept => setPendingFacets(current => current.some(x => x.id === concept.id) ? current : [...current, concept])}
            onRemove={concept => setPendingFacets(current => current.filter(x => x.id !== concept.id))}
            allowCreate
            conceptVisibility={cohortForm.visibility || 'public'}
            ownerOrgId={cohortForm.owner_org_id || null}
            searchOrgId={cohortForm.visibility === 'organization' ? cohortForm.owner_org_id : null}
            includePrivate={cohortForm.visibility === 'private'}
            label="Add facets before saving this study group"
            help="Choose a facet category, type at least two characters, select an existing suggestion when possible, or create a new canonical concept when the concept does not exist."
          />

          {pendingFacets.length > 0 && <div className="muted tiny">These {pendingFacets.length} facet{pendingFacets.length === 1 ? '' : 's'} will be attached automatically when you save the study group.</div>}
          <button className="button secondary">Add study group</button>
        </form>

        {canEditWork && cohorts.length >= 2 && <form className="card form-stack" onSubmit={addComparison}><h2>Define direct comparison</h2>
          <p className="muted tiny">Use this when the study directly compares two arms/groups. Comparator is a relationship between groups rather than a free-text cohort property.</p>
          <label>Group A<select required value={compareForm.group_a_cohort_id} onChange={e => setCompareForm({ ...compareForm, group_a_cohort_id: e.target.value })}><option value="">Select</option>{cohorts.map(c => <option value={c.id} key={c.id}>{c.label}</option>)}</select></label>
          <label>Group B<select required value={compareForm.group_b_cohort_id} onChange={e => setCompareForm({ ...compareForm, group_b_cohort_id: e.target.value })}><option value="">Select</option>{cohorts.map(c => <option value={c.id} key={c.id}>{c.label}</option>)}</select></label>
          <label>Label, optional<input value={compareForm.label} onChange={e => setCompareForm({ ...compareForm, label: e.target.value })} placeholder="Defaults to Group A vs Group B" /></label>
          <button className="button secondary">Save comparison</button>
        </form>}

        <form className="card form-stack" onSubmit={addExtraction}><h2>Extract endpoint</h2>
          <label>Study group<select required value={ev.cohort_id} onChange={e => setEv({ ...ev, cohort_id: e.target.value })}><option value="">Select</option>{cohorts.map(c => <option value={c.id} key={c.id}>{c.label} [{c.cohort_type || 'overall'} • {c.visibility || 'public'}]</option>)}</select></label>
          <p className="muted tiny">Population/subgroup information belongs on the selected study group as structured facets. The extraction inherits that group's access scope.</p>
          <label>Outcome concept<input required list="outcomes" value={ev.outcome_label} onChange={e => setEv({ ...ev, outcome_label: e.target.value })} /><datalist id="outcomes">{concepts.map(o => <option value={o.label} key={o.id} />)}</datalist></label>
          <label>Type<select value={ev.outcome_type} onChange={e => setEv({ ...ev, outcome_type: e.target.value })}><option value="proportion">Proportion</option><option value="rate">Rate</option><option value="continuous">Continuous</option></select></label>
          <label>Timepoint<input value={ev.timepoint_label} onChange={e => setEv({ ...ev, timepoint_label: e.target.value })} placeholder="e.g., 90 days" /></label>
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
