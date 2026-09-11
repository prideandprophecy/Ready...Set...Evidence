import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Edit3, X } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { WorkCard } from '../components/Common';
import { normalizeWebsiteUrl } from '../lib/identifiers';

const EMPTY_FORM = {
  name: '',
  description: '',
  website_url: '',
  logo_url: '',
  organization_type: 'research_group',
  join_policy: 'request',
};

export default function OrganizationPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [pendingMembers, setPendingMembers] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [works, setWorks] = useState([]);
  const [liveViews, setLiveViews] = useState([]);
  const [membership, setMembership] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, [slug, user?.id]);

  async function load() {
    const { data: o, error: orgError } = await supabase.from('rse_organizations').select('*').eq('slug', slug).single();
    if (orgError) { console.error(orgError); setOrg(null); return; }

    setOrg(o);
    setForm({
      name: o.name || '', description: o.description || '', website_url: o.website_url || '', logo_url: o.logo_url || '',
      organization_type: o.organization_type || 'research_group', join_policy: o.join_policy || 'request',
    });

    const myReq = user ? supabase.from('rse_org_members').select('*').eq('org_id', o.id).eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null });
    const { data: myMembership } = await myReq;
    setMembership(myMembership || null);
    const isAdmin = Boolean(user && (o.created_by === user.id || (myMembership?.status === 'active' && ['owner', 'admin'].includes(myMembership.role))));

    const [m, p, r, w, l] = await Promise.all([
      supabase.from('rse_org_members').select('role,status,profile:rse_profiles!user_id(id,username,display_name)').eq('org_id', o.id).eq('status', 'active'),
      isAdmin ? supabase.from('rse_org_members').select('org_id,user_id,role,status,created_at,profile:rse_profiles!user_id(id,username,display_name)').eq('org_id', o.id).eq('status', 'pending').order('created_at') : Promise.resolve({ data: [] }),
      supabase.from('rse_reviews').select('id,slug,title,status,visibility').eq('owner_org_id', o.id).order('updated_at', { ascending: false }),
      supabase.from('rse_works').select('id,title,journal,publication_year,work_type,doi,visibility,owner_org_id').eq('owner_org_id', o.id).eq('visibility', 'organization').order('created_at', { ascending: false }).limit(20),
      supabase.from('rse_live_views').select('id,slug,title,visibility,updated_at').eq('owner_org_id', o.id).eq('visibility', 'organization').order('updated_at', { ascending: false }).limit(20),
    ]);

    setMembers(m.data || []);
    setPendingMembers(p.data || []);
    setReviews(r.data || []);
    setWorks(w.data || []);
    setLiveViews(l.data || []);
  }

  async function join() {
    if (!user) { setMsg('Sign in to join an organization.'); return; }
    const { data, error } = await supabase.rpc('rse_join_organization', { p_org_id: org.id });
    setMsg(error ? error.message : data.status === 'active' ? 'You joined the organization.' : 'Join request submitted.');
    await load();
  }

  async function resolveRequest(request, status) {
    if (!canEditOrg) return;
    const { error } = await supabase.from('rse_org_members').update({ status, joined_at: status === 'active' ? new Date().toISOString() : null }).eq('org_id', org.id).eq('user_id', request.user_id);
    setMsg(error ? error.message : status === 'active' ? 'Join request approved.' : 'Join request declined.');
    if (!error) await load();
  }

  async function saveOrganization(e) {
    e.preventDefault();
    if (!canEditOrg || busy) return;
    const name = form.name.trim();
    if (!name) { setMsg('Organization name is required.'); return; }
    setBusy(true); setMsg('');
    const payload = {
      name,
      description: form.description.trim() || null,
      website_url: normalizeWebsiteUrl(form.website_url) || null,
      logo_url: normalizeWebsiteUrl(form.logo_url) || null,
      organization_type: form.organization_type,
      join_policy: form.join_policy,
    };
    const { error } = await supabase.from('rse_organizations').update(payload).eq('id', org.id);
    if (error) setMsg(error.message); else { setMsg('Organization information updated.'); setEditing(false); await load(); }
    setBusy(false);
  }

  if (!org) return <div className="empty-state">Organization not found.</div>;

  const isActiveMember = membership?.status === 'active';
  const canEditOrg = Boolean(user && (org.created_by === user.id || (membership?.status === 'active' && ['owner', 'admin'].includes(membership.role))));

  return <section>
    <div className="page-title">
      <div>
        <div className="eyebrow">{org.organization_type?.replaceAll('_', ' ')} {org.is_verified ? '• verified organization' : ''}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>{org.logo_url && <img src={org.logo_url} alt={`${org.name} logo`} style={{ maxWidth: '140px', maxHeight: '64px', objectFit: 'contain' }} />}<h1>{org.name}</h1></div>
        <p>{org.description}</p>
        {org.website_url && <a href={org.website_url} target="_blank" rel="noreferrer">Organization website</a>}
      </div>
      <div className="row-actions">
        {canEditOrg && <button className="button secondary" onClick={() => setEditing(x => !x)}><Edit3 size={15} /> Edit organization</button>}
        {!membership && <button className="button primary" onClick={join}>Join organization</button>}
        {membership && <span className="tag">{membership.status} • {membership.role}</span>}
      </div>
    </div>

    {msg && <div className="notice">{msg}</div>}

    {canEditOrg && editing && <form className="card form-grid" onSubmit={saveOrganization}>
      <div className="span2"><h2>Edit organization</h2><p className="muted tiny">Owners and administrators can update organization details. The organization URL remains stable even if the display name changes.</p></div>
      <label className="span2">Organization name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>Organization type<select value={form.organization_type} onChange={e => setForm({ ...form, organization_type: e.target.value })}><option value="research_group">Research group</option><option value="university">University</option><option value="company">Company</option><option value="nonprofit">Nonprofit</option><option value="government">Government</option><option value="journal">Journal</option><option value="other">Other</option></select></label>
      <label>Join policy<select value={form.join_policy} onChange={e => setForm({ ...form, join_policy: e.target.value })}><option value="open">Open</option><option value="request">Request approval</option><option value="invite">Invite only</option></select></label>
      <label className="span2">Description<textarea rows="4" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
      <label className="span2">Website<input value={form.website_url} onChange={e => setForm({ ...form, website_url: e.target.value })} placeholder="https://example.org" /></label>
      <label className="span2">Logo URL<input value={form.logo_url} onChange={e => setForm({ ...form, logo_url: e.target.value })} placeholder="https://example.org/logo.png" /></label>
      <div className="span2 row-actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save organization'}</button><button type="button" className="button ghost" onClick={() => setEditing(false)}>Cancel</button></div>
    </form>}

    {canEditOrg && pendingMembers.length > 0 && <div className="card section-block"><h2>Pending join requests</h2>{pendingMembers.map(req => <div className="duplicate-row" key={req.user_id}><div><Link to={`/u/${req.profile?.username}`}>{req.profile?.display_name || req.profile?.username || 'Contributor'}</Link><div className="muted tiny">Requested membership</div></div><div className="row-actions"><button className="button mini" onClick={() => resolveRequest(req, 'active')}><Check size={13} /> Approve</button><button className="button mini ghost" onClick={() => resolveRequest(req, 'rejected')}><X size={13} /> Decline</button></div></div>)}</div>}

    <div className="two-column">
      <section>
        <div className="card"><h2>Members</h2>{members.map(m => <div className="duplicate-row" key={m.profile?.id}><Link to={`/u/${m.profile?.username}`}>{m.profile?.display_name || m.profile?.username}</Link><span className="muted tiny">{m.role}</span></div>)}{!members.length && <div className="muted">No active members.</div>}</div>
        {isActiveMember && <><div className="section-heading"><div><div className="eyebrow">Organization workspace</div><h2>Organization-only evidence sources</h2></div></div>{works.map(w => <WorkCard work={w} key={w.id} />)}{!works.length && <div className="empty-state">No organization-only work records yet. Public papers can still contain organization-only cohorts and appraisals on their individual paper pages.</div>}</>}
      </section>
      <aside>
        <div className="card"><h2>Organization Evidence Pages</h2>{liveViews.map(v => <div key={`live-${v.id}`}><Link to={`/live/${v.slug}`}>{v.title}</Link><div className="muted tiny">living • organization-only</div></div>)}{reviews.map(r => <div key={`review-${r.id}`}><Link to={`/review/${r.slug}`}>{r.title}</Link><div className="muted tiny">{r.status === 'published' ? 'snapshot' : 'review workspace'} • {r.visibility}</div></div>)}{!liveViews.length && !reviews.length && <div className="muted">No organization Evidence Pages yet.</div>}</div>
      </aside>
    </div>
  </section>;
}
