import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { WorkCard } from '../components/Common';

export default function EvidencePage() {
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  useEffect(() => { search(0); }, []);

  async function search(nextPage = 0) {
    setLoading(true);
    const { data, error } = await supabase.rpc('rse_search_public_works', {
      p_query: q.trim() || null,
      p_year: year ? Number(year) : null,
      p_limit: pageSize,
      p_offset: nextPage * pageSize,
    });
    if (error) {
      console.error(error);
      setWorks([]);
      setTotal(0);
    } else {
      setWorks(data || []);
      setTotal(Number(data?.[0]?.total_count) || 0);
      setPage(nextPage);
    }
    setLoading(false);
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return <section>
    <div className="page-title"><div><div className="eyebrow">Evidence Commons</div><h1>Scientific literature</h1><p>Search article metadata including title, authors, abstract, journal, DOI, PMID, citation text, and publication year.</p></div></div>
    <form className="filter-bar" onSubmit={e => { e.preventDefault(); search(0); }}>
      <Search size={18} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Title, author, DOI, PMID, journal, abstract..." />
      <input value={year} onChange={e => setYear(e.target.value)} placeholder="Year" inputMode="numeric" />
      <button className="button primary">Search</button>
    </form>
    {total > 0 && <div className="muted tiny" style={{ marginBottom: 12 }}>{total.toLocaleString()} matching paper{total === 1 ? '' : 's'}</div>}
    <div className="stack">{loading ? <div className="card">Loading…</div> : works.map(work => <WorkCard key={work.id} work={work} />)}{!loading && !works.length && <div className="empty-state">No matching papers.</div>}</div>
    {!loading && pages > 1 && <div className="row-actions" style={{ marginTop: 18 }}>
      <button className="button secondary" disabled={page === 0} onClick={() => search(page - 1)}>Previous</button>
      <span className="muted tiny">Page {page + 1} of {pages}</span>
      <button className="button secondary" disabled={page >= pages - 1} onClick={() => search(page + 1)}>Next</button>
    </div>}
  </section>;
}
