import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { formatDate } from '../lib/identifiers';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

export function MetricCard({ label, value, detail }) {
  return <div className="metric-card"><div className="metric-value">{value ?? 0}</div><div className="metric-label">{label}</div>{detail && <div className="muted tiny">{detail}</div>}</div>;
}

export function Empty({ children = 'Nothing here yet.' }) {
  return <div className="empty-state">{children}</div>;
}

export function ScopeTag({ visibility = 'public' }) {
  const text = visibility === 'organization' ? 'Organization' : visibility === 'private' ? 'Private' : visibility === 'unlisted' ? 'Unlisted' : 'Public';
  return <span className={`tag ${visibility === 'public' ? 'public-tag' : 'private-tag'}`}>{text}</span>;
}

export function DoiLink({ doi, prefix = true, className = '' }) {
  if (!doi) return null;
  const clean = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (!clean) return null;
  return <a className={className} href={`https://doi.org/${clean}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{prefix ? 'DOI ' : ''}{clean}</a>;
}

export function ProfileLink({ profile, fallback = 'Contributor', className = '' }) {
  const label = profile?.display_name || profile?.username || fallback;
  if (!profile?.username) return <span className={className}>{label}</span>;
  return <Link className={className} to={`/u/${profile.username}`} onClick={e => e.stopPropagation()}>{label}</Link>;
}

export function FavoriteButton({ targetType, targetId, label = 'Save', savedLabel = 'Saved', className = 'button ghost' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user?.id || !targetType || !targetId) { setSaved(false); return; }
      const { data } = await supabase.from('rse_favorites').select('target_id').eq('user_id', user.id).eq('target_type', targetType).eq('target_id', targetId).maybeSingle();
      if (!cancelled) setSaved(Boolean(data));
    }
    load();
    return () => { cancelled = true; };
  }, [user?.id, targetType, targetId]);

  async function toggle(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!user) return navigate('/auth');
    if (busy) return;
    setBusy(true);
    if (saved) {
      const { error } = await supabase.from('rse_favorites').delete().eq('user_id', user.id).eq('target_type', targetType).eq('target_id', targetId);
      if (!error) setSaved(false);
    } else {
      const { error } = await supabase.from('rse_favorites').insert({ user_id: user.id, target_type: targetType, target_id: targetId });
      if (!error) setSaved(true);
    }
    setBusy(false);
  }

  return <button type="button" className={className} onClick={toggle} disabled={busy} title={saved ? 'Remove from saved evidence' : 'Save to your profile'}>{saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} {saved ? savedLabel : label}</button>;
}

export function WorkCard({ work }) {
  const visibility = work.visibility || (work.is_public === false ? 'private' : 'public');
  const authorYear = work.first_author
    ? `${work.first_author}${work.publication_year ? ` ${work.publication_year}` : ''}`
    : null;
  return (
    <article className="card work-card">
      <div className="work-card-top"><div className="eyebrow">{work.work_type?.replaceAll('_', ' ') || 'work'} {work.publication_year ? `• ${work.publication_year}` : ''}</div><ScopeTag visibility={visibility} /></div>
      <h3><Link to={`/work/${work.id}`}>{work.title}</Link></h3>
      <div className="muted" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {authorYear && <span>{authorYear}</span>}
        {authorYear && work.journal && <span>•</span>}
        {work.journal && <span>{work.journal}</span>}
        {(authorYear || work.journal) && work.doi && <span>•</span>}
        <DoiLink doi={work.doi} />
        {work.doi && work.pmid && <span>•</span>}
        {work.pmid && <span>PMID {work.pmid}</span>}
      </div>
    </article>
  );
}

export function ActivityList({ events = [] }) {
  if (!events.length) return <Empty>No recent activity.</Empty>;
  return <div className="activity-list">{events.map(e => <ActivityItem key={e.id} event={e} />)}</div>;
}

function ActivityItem({ event }) {
  const labels = {
    paper_added: 'added a paper', endpoint_extracted: 'extracted an endpoint', appraisal_added: 'appraised a study',
    challenge_added: 'challenged an extraction', challenge_accepted: 'had a challenge accepted', review_published: 'published an evidence snapshot',
  };
  return (
    <div className="activity-item">
      <div><strong><ProfileLink profile={event.actor} /></strong> {labels[event.event_type] || event.event_type.replaceAll('_', ' ')}</div>
      {event.metadata?.title && <div className="muted">{event.metadata.title}</div>}
      <div className="muted tiny">{formatDate(event.created_at)} {event.points ? `• +${event.points} points` : ''}</div>
    </div>
  );
}

export function RequireAuth({ children }) {
  return <div className="card"><h2>Sign in required</h2><p className="muted">Create a profile to contribute evidence, appraise studies, confirm competing extractions, create evidence pages, follow researchers, and join organizations.</p><Link to="/auth" className="button primary">Sign in or create profile</Link>{children}</div>;
}
