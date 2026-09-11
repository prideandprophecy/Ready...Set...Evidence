import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Award, Bookmark, CheckCircle2, Copy, ExternalLink, UserMinus, UserPlus } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { ActivityList, DoiLink, MetricCard } from '../components/Common';
import { compactNumber, normalizeUsername, normalizeWebsiteUrl, usernameIsValid } from '../lib/identifiers';

export default function ProfilePage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [p, setP] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [events, setEvents] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [papers, setPapers] = useState([]);
  const [favorites, setFavorites] = useState({ works: [], live: [], reviews: [] });
  const [following, setFollowing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const isSelf = Boolean(user && p && user.id === p.id);

  useEffect(() => { load(); }, [username, user?.id]);

  async function loadFavorites(profileId, self) {
    if (!self) { setFavorites({ works: [], live: [], reviews: [] }); return; }
    const { data: favs } = await supabase.from('rse_favorites').select('target_type,target_id,created_at').eq('user_id', profileId).order('created_at', { ascending: false });
    const grouped = { work: [], live_view: [], review: [] };
    for (const f of favs || []) grouped[f.target_type]?.push(f.target_id);
    const [w, l, r] = await Promise.all([
      grouped.work.length ? supabase.from('rse_works').select('id,title,publication_year,journal,doi').in('id', grouped.work) : Promise.resolve({ data: [] }),
      grouped.live_view.length ? supabase.from('rse_live_views').select('id,slug,title,description,visibility').in('id', grouped.live_view) : Promise.resolve({ data: [] }),
      grouped.review.length ? supabase.from('rse_reviews').select('id,slug,title,status,version_tag,visibility').in('id', grouped.review) : Promise.resolve({ data: [] }),
    ]);
    const order = (items, ids) => [...(items || [])].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    setFavorites({ works: order(w.data, grouped.work), live: order(l.data, grouped.live_view), reviews: order(r.data, grouped.review) });
  }

  async function load() {
    setLoading(true);
    setMsg('');
    let { data: prof } = await supabase.from('rse_profiles').select('*').eq('username', username).maybeSingle();

    if (!prof) {
      const { data: alias } = await supabase.from('rse_profile_aliases').select('profile_id').eq('old_username', username).maybeSingle();
      if (alias?.profile_id) {
        const { data: current } = await supabase.from('rse_profiles').select('*').eq('id', alias.profile_id).maybeSingle();
        if (current?.username) {
          navigate(`/u/${current.username}`, { replace: true });
          setLoading(false);
          return;
        }
      }
    }

    setP(prof || null);
    if (!prof) { setLoading(false); return; }
    const self = Boolean(user && user.id === prof.id);

    const [m, a, o, c, f] = await Promise.all([
      supabase.from('rse_profile_metrics').select('*').eq('id', prof.id).maybeSingle(),
      supabase.from('rse_activity_events').select('*').eq('actor_id', prof.id).eq('is_public', true).order('created_at', { ascending: false }).limit(15),
      supabase.from('rse_org_members').select('role,status,org:rse_organizations(id,slug,name,is_verified)').eq('user_id', prof.id).eq('status', 'active'),
      supabase.from('rse_authorship_claims').select('status,work:rse_works(id,title,publication_year,journal,doi)').eq('user_id', prof.id).eq('status', 'verified'),
      user && user.id !== prof.id ? supabase.from('rse_follows').select('*').eq('follower_id', user.id).eq('following_id', prof.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    setMetrics(m.data || {});
    setEvents((a.data || []).map(x => ({ ...x, actor: prof })));
    setOrgs(o.data || []);
    setPapers(c.data || []);
    setFollowing(Boolean(f.data));
    setForm({
      username: prof.username || '',
      display_name: prof.display_name || '',
      bio: prof.bio || '',
      affiliation: prof.affiliation || '',
      website_url: prof.website_url || '',
      location: prof.location || '',
      expertise: (prof.expertise || []).join(', '),
      is_public: prof.is_public,
    });
    await loadFavorites(prof.id, self);
    setLoading(false);
  }

  async function toggleFollow() {
    if (!user) return navigate('/auth');
    if (following) await supabase.from('rse_follows').delete().eq('follower_id', user.id).eq('following_id', p.id);
    else await supabase.from('rse_follows').insert({ follower_id: user.id, following_id: p.id });
    await load();
  }

  async function save(e) {
    e.preventDefault();
    setMsg('');
    const nextUsername = normalizeUsername(form.username);
    if (!usernameIsValid(nextUsername)) {
      setMsg('Profile handles must be 3–40 characters and use only letters, numbers, and hyphens.');
      return;
    }
    const { data, error } = await supabase.rpc('rse_update_profile_settings', {
      p_username: nextUsername,
      p_display_name: form.display_name || null,
      p_bio: form.bio || null,
      p_affiliation: form.affiliation || null,
      p_website_url: normalizeWebsiteUrl(form.website_url) || null,
      p_location: form.location || null,
      p_expertise: String(form.expertise || '').split(',').map(x => x.trim()).filter(Boolean),
      p_is_public: Boolean(form.is_public),
    });
    if (error) { setMsg(error.message); return; }
    setEditing(false);
    await refreshProfile();
    const updatedUsername = data?.username || nextUsername;
    if (updatedUsername !== username) navigate(`/u/${updatedUsername}`, { replace: true });
    else await load();
  }

  async function verifyOrcid() {
    setMsg('');
    const { data, error } = await supabase.functions.invoke('orcid-start');
    if (error) setMsg(error.message);
    else if (data?.url) window.location.assign(data.url);
  }

  if (loading) return <div className="empty-state">Loading profile…</div>;
  if (!p) return <div className="empty-state">Profile not found.</div>;

  return <section>
    <div className="profile-hero">
      <div className="avatar">{(p.display_name || p.username).slice(0, 2).toUpperCase()}</div>
      <div className="grow">
        <div className="eyebrow">RSE contributor</div>
        <h1>{p.display_name || p.username}</h1>
        <div className="muted">@{p.username}{p.affiliation ? ` • ${p.affiliation}` : ''}{p.location ? ` • ${p.location}` : ''}</div>
        <p>{p.bio || 'No biography yet.'}</p>
        {p.website_url && <a className="profile-website" href={normalizeWebsiteUrl(p.website_url)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {p.website_url}</a>}
        <div className="tag-row">{(p.expertise || []).map(x => <span className="tag" key={x}>{x}</span>)}</div>
      </div>
      <div className="profile-actions">
        {!isSelf && user && <button className="button secondary" onClick={toggleFollow}>{following ? <><UserMinus size={16} /> Following</> : <><UserPlus size={16} /> Follow</>}</button>}
        <button className="button ghost" onClick={() => navigator.clipboard?.writeText(window.location.href)}><Copy size={16} /> Copy profile link</button>
        {isSelf && <button className="button secondary" onClick={() => setEditing(!editing)}>Edit profile</button>}
      </div>
    </div>

    {isSelf && editing && <form className="card form-grid" onSubmit={save}>
      <label>Display name<input value={form.display_name || ''} onChange={e => setForm({ ...form, display_name: e.target.value })} /></label>
      <label>Public profile handle<input value={form.username || ''} onChange={e => setForm({ ...form, username: normalizeUsername(e.target.value) })} /><span className="tiny muted">Profile URL: /u/{form.username || 'your-handle'}. Old handles redirect to the new one.</span></label>
      <label>Affiliation<input value={form.affiliation || ''} onChange={e => setForm({ ...form, affiliation: e.target.value })} /></label>
      <label>Location<input value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })} /></label>
      <label className="span2">Website<input value={form.website_url || ''} onChange={e => setForm({ ...form, website_url: e.target.value })} placeholder="https://example.com" /></label>
      <label className="span2">Expertise, comma separated<input value={form.expertise || ''} onChange={e => setForm({ ...form, expertise: e.target.value })} /></label>
      <label className="span2">Bio<textarea rows="4" value={form.bio || ''} onChange={e => setForm({ ...form, bio: e.target.value })} /></label>
      <label className="checkbox"><input type="checkbox" checked={Boolean(form.is_public)} onChange={e => setForm({ ...form, is_public: e.target.checked })} /> Public profile</label>
      <div><button className="button primary">Save profile</button></div>
    </form>}

    {isSelf && <div className="card orcid-card"><div><h3>ORCID identity</h3><p className="muted">{p.orcid_verified_at ? <>Verified ORCID: <strong>{p.orcid}</strong></> : p.orcid ? `ORCID ${p.orcid} is stored but not OAuth verified.` : 'Connect ORCID to verify your researcher identity and enable automatic authorship matches when trusted article metadata includes your ORCID.'}</p></div>{!p.orcid_verified_at && <button className="button secondary" onClick={verifyOrcid}>Connect ORCID</button>}</div>}
    {msg && <div className="notice">{msg}</div>}

    <div className="metric-grid six">
      <MetricCard label="Contribution points" value={compactNumber(metrics?.points)} detail="Activity-based" />
      <MetricCard label="Endpoints extracted" value={metrics?.endpoints_extracted} />
      <MetricCard label="Appraisals" value={metrics?.appraisals_completed} />
      <MetricCard label="Changes implemented" value={metrics?.changes_implemented} />
      <MetricCard label="Followers" value={metrics?.followers} />
      <MetricCard label="Published snapshots" value={metrics?.reviews_published} />
    </div>

    {isSelf && <div className="card section-block">
      <div className="section-heading"><div><div className="eyebrow"><Bookmark size={15} /> Private workspace</div><h2>Saved evidence</h2></div></div>
      <p className="muted tiny">Saved items are private to you in this version. They are not displayed on other users' public profiles.</p>
      <div className="three-column">
        <div><h3>Papers</h3>{favorites.works.map(w => <div key={w.id} style={{ marginBottom: 10 }}><Link to={`/work/${w.id}`}>{w.title}</Link><div className="muted tiny">{w.publication_year || ''}{w.doi ? <> • <DoiLink doi={w.doi} /></> : null}</div></div>)}{!favorites.works.length && <div className="muted tiny">No saved papers.</div>}</div>
        <div><h3>Living pages</h3>{favorites.live.map(v => <div key={v.id} style={{ marginBottom: 10 }}><Link to={`/live/${v.slug}`}>{v.title}</Link><div className="muted tiny">{v.visibility}</div></div>)}{!favorites.live.length && <div className="muted tiny">No saved living pages.</div>}</div>
        <div><h3>Snapshots</h3>{favorites.reviews.map(r => <div key={r.id} style={{ marginBottom: 10 }}><Link to={`/review/${r.slug}`}>{r.title}</Link><div className="muted tiny">{r.status} • v{r.version_tag}</div></div>)}{!favorites.reviews.length && <div className="muted tiny">No saved snapshots.</div>}</div>
      </div>
    </div>}

    <div className="two-column"><section><div className="section-heading"><div><div className="eyebrow">Activity</div><h2>Recent additions</h2></div></div><ActivityList events={events} /></section><aside>
      <div className="card"><h2><Award size={19} /> Research identity</h2><div className="stack compact"><div><strong>{metrics?.verified_authorships || 0}</strong> verified paper claims</div><div><strong>{metrics?.challenges_accepted || 0}</strong> accepted evidence challenges</div><div><strong>{metrics?.papers_added || 0}</strong> papers added to the Commons</div></div></div>
      <div className="card"><h2>Organizations</h2>{orgs.map(x => <div key={x.org?.id}><Link to={`/org/${x.org?.slug}`}>{x.org?.name}</Link> <span className="muted tiny">{x.role}</span></div>)}{!orgs.length && <div className="muted">No public organizations.</div>}</div>
      <div className="card"><h2><CheckCircle2 size={18} /> Verified authorship</h2>{papers.map(x => <div key={x.work?.id}><Link to={`/work/${x.work?.id}`}>{x.work?.title}</Link></div>)}{!papers.length && <div className="muted">No verified papers yet.</div>}</div>
    </aside></div>
  </section>;
}
