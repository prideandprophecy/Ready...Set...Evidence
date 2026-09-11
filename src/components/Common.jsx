import { Link } from 'react-router-dom';
import { formatDate } from '../lib/identifiers';

export function MetricCard({ label, value, detail }) {
  return <div className="metric-card"><div className="metric-value">{value ?? 0}</div><div className="metric-label">{label}</div>{detail && <div className="muted tiny">{detail}</div>}</div>;
}

export function Empty({ children = 'Nothing here yet.' }) {
  return <div className="empty-state">{children}</div>;
}

export function ScopeTag({ visibility = 'public' }) {
  const text = visibility === 'organization' ? 'Organization' : visibility === 'private' ? 'Private' : 'Public';
  return <span className={`tag ${visibility === 'public' ? 'public-tag' : 'private-tag'}`}>{text}</span>;
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
      <div className="muted">{[authorYear, work.journal, work.doi ? `DOI ${work.doi}` : null, work.pmid ? `PMID ${work.pmid}` : null].filter(Boolean).join(' • ')}</div>
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
    challenge_added: 'challenged an extraction', challenge_accepted: 'had a challenge accepted', review_published: 'published a review',
  };
  return (
    <div className="activity-item">
      <div><strong>{event.actor?.display_name || event.actor?.username || 'Contributor'}</strong> {labels[event.event_type] || event.event_type.replaceAll('_', ' ')}</div>
      {event.metadata?.title && <div className="muted">{event.metadata.title}</div>}
      <div className="muted tiny">{formatDate(event.created_at)} {event.points ? `• +${event.points} points` : ''}</div>
    </div>
  );
}

export function RequireAuth({ children }) {
  return <div className="card"><h2>Sign in required</h2><p className="muted">Create a profile to contribute evidence, appraise studies, confirm competing extractions, create reviews, follow researchers, and join organizations.</p><Link to="/auth" className="button primary">Sign in or create profile</Link>{children}</div>;
}
