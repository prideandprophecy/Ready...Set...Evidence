import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { RequireAuth } from '../components/Common';
import { cleanJatsText, normalizeDoi } from '../lib/identifiers';
import { supabase } from '../supabaseClient';

const EMPTY = {
  doi: '', pmid: '', title: '', abstract: '', journal: '', publication_year: '',
  work_type: 'journal_article', url: '', citation: '', metadata_source: 'manual',
  metadata_verified: false, authors: [], visibility: 'public', owner_org_id: '',
};

export default function ContributePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [doiLookup, setDoiLookup] = useState('');
  const [duplicates, setDuplicates] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) loadOrganizations(); }, [user?.id]);
  if (!user) return <RequireAuth />;

  async function loadOrganizations() {
    const { data, error } = await supabase
      .from('rse_org_members')
      .select('role,status,org:rse_organizations(id,name,slug)')
      .eq('user_id', user.id)
      .eq('status', 'active');
    if (!error) setOrgs((data || []).map(x => x.org).filter(Boolean));
  }

  async function lookup() {
    setMessage(''); setDuplicates([]);
    const doi = normalizeDoi(doiLookup);
    if (!doi) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('lookup-doi', { body: { doi } });
    if (error) setMessage(error.message);
    else if (data?.work) {
      setForm({
        ...EMPTY,
        ...data.work,
        doi,
        abstract: cleanJatsText(data.work.abstract || ''),
        metadata_source: 'crossref',
        metadata_verified: true,
        authors: data.authors || [],
        visibility: form.visibility,
        owner_org_id: form.owner_org_id,
      });
      setMessage('Crossref metadata loaded. Review it before adding the paper.');
    }
    setBusy(false);
  }

  async function checkDuplicates() {
    const { data, error } = await supabase.rpc('rse_find_possible_work_duplicates', {
      p_doi: form.doi || null,
      p_pmid: form.pmid || null,
      p_title: form.title || null,
      p_year: form.publication_year ? Number(form.publication_year) : null,
    });
    if (error) { setMessage(error.message); return []; }
    setDuplicates(data || []);
    return data || [];
  }

  async function save(e) {
    e.preventDefault();
    setMessage('');
    if (!form.title.trim()) return;
    if (form.visibility === 'organization' && !form.owner_org_id) {
      setMessage('Choose the organization that should have access to this record.');
      return;
    }
    setBusy(true);
    const dups = await checkDuplicates();
    if (dups.some(d => ['DOI', 'PMID'].includes(d.match_reason))) {
      setMessage('This paper already exists. Open the existing canonical record and add public, private, or organization-specific evidence there instead of duplicating the paper.');
      setBusy(false);
      return;
    }

    const payload = {
      doi: form.doi || null,
      pmid: form.pmid || null,
      title: form.title.trim(),
      abstract: cleanJatsText(form.abstract) || null,
      journal: form.journal || null,
      publication_year: form.publication_year ? Number(form.publication_year) : null,
      work_type: form.work_type || 'journal_article',
      url: form.url || null,
      citation: form.citation || null,
      metadata_source: form.metadata_source || 'manual',
      metadata_verified: Boolean(form.metadata_verified),
      visibility: form.visibility,
      owner_org_id: form.visibility === 'organization' ? form.owner_org_id : null,
      is_public: form.visibility === 'public',
      added_by: user.id,
    };

    const { data: work, error } = await supabase.from('rse_works').insert(payload).select().single();
    if (error) {
      setMessage(error.code === '23505' ? 'A paper with this DOI or PMID already exists. Open the existing canonical record instead.' : error.message);
      setBusy(false);
      return;
    }

    if (form.authors?.length) {
      const rows = form.authors.map((a, i) => ({
        work_id: work.id,
        author_order: i + 1,
        full_name: a.full_name || [a.given_name, a.family_name].filter(Boolean).join(' ') || `Author ${i + 1}`,
        given_name: a.given_name || null,
        family_name: a.family_name || null,
        orcid: a.orcid || null,
        affiliation: a.affiliation || null,
        metadata_source: form.metadata_source || 'manual',
        created_by: user.id,
      }));
      const { error: ae } = await supabase.from('rse_work_authors').insert(rows);
      if (ae) console.error(ae);
    }

    navigate(`/work/${work.id}`);
    setBusy(false);
  }

  return <section>
    <div className="page-title"><div><div className="eyebrow">Contribute</div><h1>Add a paper or evidence source</h1><p>Published literature remains canonical by DOI/PMID. Public papers can still contain organization-only evidence extractions, so an organization does not need to duplicate a paper simply to keep its extraction private.</p></div></div>

    <div className="card doi-box"><h2>Start with a DOI</h2><div className="inline-form"><input value={doiLookup} onChange={e => setDoiLookup(e.target.value)} placeholder="10.xxxx/xxxxx" /><button className="button secondary" onClick={lookup} disabled={busy}><Search size={16} /> Lookup metadata</button></div></div>

    <form className="card form-grid" onSubmit={save}>
      <label>Access
        <select value={form.visibility} onChange={e => setForm({ ...form, visibility: e.target.value, owner_org_id: e.target.value === 'organization' ? form.owner_org_id : '' })}>
          <option value="public">Public Commons</option>
          <option value="private">Private to me</option>
          <option value="organization">Organization only</option>
        </select>
      </label>
      {form.visibility === 'organization' && <label>Organization<select required value={form.owner_org_id} onChange={e => setForm({ ...form, owner_org_id: e.target.value })}><option value="">Select organization</option>{orgs.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
      <label>DOI<input value={form.doi} onChange={e => setForm({ ...form, doi: e.target.value, metadata_source: 'manual', metadata_verified: false })} /></label>
      <label>PMID<input value={form.pmid} onChange={e => setForm({ ...form, pmid: e.target.value })} /></label>
      <label className="span2">Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label>Journal<input value={form.journal} onChange={e => setForm({ ...form, journal: e.target.value })} /></label>
      <label>Publication year<input inputMode="numeric" value={form.publication_year} onChange={e => setForm({ ...form, publication_year: e.target.value })} /></label>
      <label>Type<select value={form.work_type} onChange={e => setForm({ ...form, work_type: e.target.value })}><option value="journal_article">Journal article</option><option value="conference_abstract">Conference abstract</option><option value="systematic_review">Systematic review</option><option value="registry">Registry/public dataset</option><option value="internal_evidence">Internal/organization evidence</option><option value="other">Other</option></select></label>
      <label>URL<input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></label>
      <label className="span2">Citation<input value={form.citation} onChange={e => setForm({ ...form, citation: e.target.value })} /></label>
      <label className="span2">Abstract<textarea rows="7" value={form.abstract} onChange={e => setForm({ ...form, abstract: e.target.value })} /></label>
      <div className="span2"><h3>Authors</h3>{form.authors?.length ? <div className="author-list">{form.authors.map((a, i) => <div key={i}>{a.full_name || [a.given_name, a.family_name].filter(Boolean).join(' ')} {a.orcid && <span className="muted tiny">ORCID {a.orcid}</span>}</div>)}</div> : <p className="muted">Author metadata will be blank for manual records unless added later.</p>}</div>
      <div className="span2 inline-actions"><button type="button" className="button ghost" onClick={checkDuplicates}>Check duplicates</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Add record'}</button></div>
    </form>

    {message && <div className="notice">{message}</div>}
    {duplicates.length > 0 && <div className="card"><h2>Possible existing records</h2>{duplicates.map(d => <div className="duplicate-row" key={d.id}><div><strong>{d.title}</strong><div className="muted tiny">{d.publication_year || ''} {d.doi ? `• ${d.doi}` : ''} • Match: {d.match_reason}</div></div><button className="button secondary" onClick={() => navigate(`/work/${d.id}`)}>Open</button></div>)}</div>}
  </section>;
}
