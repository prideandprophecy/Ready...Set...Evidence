import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCcw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { DoiLink } from './Common';
import { formatDate } from '../lib/identifiers';

const statusLabel = status => status === 'verified'
  ? 'Verified'
  : status === 'rejected'
    ? 'Not verified'
    : 'Pending verification';

const methodLabel = method => method === 'verified_orcid_match'
  ? 'Exact ORCID match'
  : method === 'manual_admin_review'
    ? 'Manual platform review'
    : 'Manual review required';

function authorText(a) {
  if (!a) return 'Select author';
  const name = a.full_name || [a.given_name, a.family_name].filter(Boolean).join(' ') || `Author ${a.author_order || ''}`;
  return `${name}${a.orcid ? ` • ORCID ${a.orcid}` : ''}`;
}

function ClaimCard({ claim, canManageOwn, canAdjudicate, onReload, adminContext = false }) {
  const authors = Array.isArray(claim.authors) ? claim.authors : [];
  const [authorId, setAuthorId] = useState(claim.work_author_id || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setAuthorId(claim.work_author_id || ''), [claim.work_author_id]);

  const selectedAuthor = useMemo(() => authors.find(a => a.id === authorId), [authors, authorId]);

  async function saveAuthor(nextId = authorId) {
    if (!nextId) return;
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('rse_update_authorship_claim_author', {
      p_claim_id: claim.claim_id,
      p_work_author_id: nextId,
    });
    if (error) setMessage(error.message);
    else setMessage(data?.status === 'verified' ? 'Authorship verified by exact ORCID match.' : 'Author identity saved for review.');
    setBusy(false);
    if (!error) await onReload();
  }

  async function recheck() {
    setBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('rse_claim_authorship', { p_work_id: claim.work_id });
    if (error) setMessage(error.message);
    else setMessage(data?.status === 'verified' ? 'Authorship verified by exact ORCID match.' : 'No exact trusted ORCID match was found. The claim remains pending for manual review.');
    setBusy(false);
    if (!error) await onReload();
  }

  async function withdraw() {
    if (!window.confirm('Withdraw this unresolved authorship claim?')) return;
    setBusy(true); setMessage('');
    const { error } = await supabase.rpc('rse_withdraw_authorship_claim', { p_claim_id: claim.claim_id });
    if (error) setMessage(error.message);
    setBusy(false);
    if (!error) await onReload();
  }

  async function adjudicate(status) {
    if (status === 'verified' && !authorId) {
      setMessage('Select which author on the paper this profile represents before verifying.');
      return;
    }
    const note = window.prompt(
      status === 'verified' ? 'Optional verification note:' : 'Reason the claim could not be verified:',
      status === 'verified' ? '' : 'Unable to establish authorship from available evidence.'
    );
    if (note === null) return;
    const claimantName = claim.display_name || claim.username || 'this contributor';
    if (adminContext && claim.user_id && status === 'verified' && !window.confirm(`Verify ${claimantName} as ${authorText(selectedAuthor)}? This decision will be recorded as manual platform review.`)) return;

    setBusy(true); setMessage('');
    const { error } = await supabase.rpc('rse_adjudicate_authorship_claim', {
      p_claim_id: claim.claim_id,
      p_status: status,
      p_work_author_id: authorId || null,
      p_note: note || null,
    });
    if (error) setMessage(error.message);
    else setMessage(status === 'verified' ? 'Claim verified.' : 'Claim rejected.');
    setBusy(false);
    if (!error) await onReload();
  }

  return <div className="card" style={{ padding: 16, marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        {adminContext && claim.username && <div className="eyebrow"><Link to={`/u/${claim.username}`}>{claim.display_name || claim.username}</Link>{claim.profile_orcid ? ` • ORCID ${claim.profile_orcid}` : ' • ORCID not connected'}{claim.orcid_verified_at ? ' • verified identity' : ''}</div>}
        <h3 style={{ marginBottom: 4 }}><Link to={`/work/${claim.work_id}`}>{claim.work_title}</Link></h3>
        <div className="muted tiny">
          {[claim.journal, claim.publication_year].filter(Boolean).join(' • ')}
          {claim.doi ? <> • <DoiLink doi={claim.doi} /></> : null}
        </div>
        <div className="tag-row" style={{ marginTop: 8 }}>
          <span className={`tag ${claim.status === 'verified' ? 'verified-tag' : ''}`}>{statusLabel(claim.status)}</span>
          <span className="tag">{methodLabel(claim.verification_method)}</span>
        </div>
        <div className="muted tiny" style={{ marginTop: 8 }}>Claimed {formatDate(claim.created_at)}{claim.reviewed_at ? ` • reviewed ${formatDate(claim.reviewed_at)}` : ''}</div>
        {claim.note && <div className="subtle-callout" style={{ marginTop: 10 }}><strong>Review note:</strong> {claim.note}</div>}
      </div>
    </div>

    {(canManageOwn || canAdjudicate) && claim.status !== 'verified' && <div style={{ marginTop: 14 }}>
      <label style={{ display: 'block' }}>Which author are you / is this profile?
        <select value={authorId} onChange={e => setAuthorId(e.target.value)} style={{ width: '100%', marginTop: 5 }}>
          <option value="">Select author from article metadata</option>
          {authors.map(a => <option key={a.id} value={a.id}>{authorText(a)}</option>)}
        </select>
      </label>
      {canManageOwn && authorId && authorId !== claim.work_author_id && <button disabled={busy} className="button mini secondary" style={{ marginTop: 8 }} onClick={() => saveAuthor(authorId)}>Save author identity</button>}
    </div>}

    {canManageOwn && claim.status !== 'verified' && <div className="row-actions" style={{ marginTop: 12 }}>
      <button disabled={busy} className="button mini secondary" onClick={recheck}><RefreshCcw size={14} /> Recheck with ORCID</button>
      <button disabled={busy} className="button mini ghost" onClick={withdraw}><Trash2 size={14} /> Withdraw</button>
    </div>}

    {canAdjudicate && claim.status === 'pending' && <div className="row-actions" style={{ marginTop: 12 }}>
      <button disabled={busy || !authorId} className="button mini primary" onClick={() => adjudicate('verified')}><ShieldCheck size={14} /> Verify claim</button>
      <button disabled={busy} className="button mini ghost" onClick={() => adjudicate('rejected')}><XCircle size={14} /> Reject</button>
    </div>}

    {message && <div className="notice" style={{ marginTop: 10 }}>{message}</div>}
  </div>;
}

export default function AuthorshipClaimsPanel({ targetProfile, isSelf, isPlatformAdmin }) {
  const [claims, setClaims] = useState([]);
  const [adminQueue, setAdminQueue] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const canSeeTargetClaims = Boolean(targetProfile?.id && (isSelf || isPlatformAdmin));

  useEffect(() => {
    if (canSeeTargetClaims) load();
    else { setClaims([]); setAdminQueue([]); }
  }, [targetProfile?.id, isSelf, isPlatformAdmin]);

  async function load() {
    if (!targetProfile?.id) return;
    setLoading(true); setMessage('');

    const targetReq = supabase.rpc('rse_authorship_claims_for_profile', { p_profile_id: targetProfile.id });
    const queueReq = isPlatformAdmin && isSelf
      ? supabase.rpc('rse_pending_authorship_claims')
      : Promise.resolve({ data: [], error: null });

    const [targetResult, queueResult] = await Promise.all([targetReq, queueReq]);
    if (targetResult.error) setMessage(targetResult.error.message);
    if (queueResult.error) setMessage(queueResult.error.message);
    setClaims(targetResult.data || []);
    setAdminQueue(queueResult.data || []);
    setLoading(false);
  }

  if (!canSeeTargetClaims) return null;

  return <>
    <div className="card section-block">
      <div className="section-heading"><div><div className="eyebrow"><CheckCircle2 size={15} /> Research identity</div><h2>{isSelf ? 'Your authorship claims' : `Authorship claims for ${targetProfile.display_name || targetProfile.username}`}</h2></div></div>
      {isSelf && <p className="muted">Exact ORCID matches verify automatically. If article metadata does not contain your ORCID, identify yourself in the author list and the claim can be reviewed by a platform administrator. You cannot manually approve your own claim from this section.</p>}
      {isPlatformAdmin && !isSelf && <p className="muted">As a platform administrator, you can adjudicate unresolved claims for this contributor. Manual decisions are stored separately from automatic ORCID verification.</p>}
      {loading ? <div className="muted">Loading authorship claims…</div> : claims.map(c => <ClaimCard key={c.claim_id} claim={c} canManageOwn={isSelf} canAdjudicate={isPlatformAdmin && !isSelf} onReload={load} />)}
      {!loading && !claims.length && <div className="muted">No authorship claims.</div>}
      {message && <div className="notice">{message}</div>}
    </div>

    {isPlatformAdmin && isSelf && <div className="card section-block">
      <div className="section-heading"><div><div className="eyebrow"><ShieldCheck size={15} /> Platform administration</div><h2>Pending authorship queue</h2></div><span className="tag">{adminQueue.length} pending</span></div>
      <p className="muted">This queue contains every unresolved authorship claim in RSE. Choose the corresponding article author before manually verifying a claim. The decision, administrator, timestamp, and note are retained in the claim audit record.</p>
      {adminQueue.map(c => <ClaimCard key={`admin-${c.claim_id}`} claim={c} canManageOwn={false} canAdjudicate={true} onReload={load} adminContext />)}
      {!adminQueue.length && <div className="muted">No pending authorship claims.</div>}
    </div>}
  </>;
}
