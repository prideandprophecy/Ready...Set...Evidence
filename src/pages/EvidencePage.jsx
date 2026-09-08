import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { WorkCard } from '../components/Common';

export default function EvidencePage(){
  const [q,setQ]=useState(''); const [year,setYear]=useState(''); const [works,setWorks]=useState([]); const [loading,setLoading]=useState(false);
  useEffect(()=>{search();},[]);
  async function search(){
    setLoading(true);
    let query=supabase.from('rse_works').select('id,title,journal,publication_year,work_type,doi,created_at').eq('is_public',true).order('publication_year',{ascending:false,nullsFirst:false}).limit(100);
    if(q.trim()) query=query.ilike('title',`%${q.trim()}%`);
    if(year) query=query.eq('publication_year',Number(year));
    const {data,error}=await query; if(error) console.error(error); setWorks(data||[]); setLoading(false);
  }
  return <section>
    <div className="page-title"><div><div className="eyebrow">Evidence Commons</div><h1>Scientific literature</h1><p>Each paper is a canonical record shared by reviews and contributors. DOI and PMID protection reduce duplicate records.</p></div></div>
    <form className="filter-bar" onSubmit={e=>{e.preventDefault();search();}}><Search size={18}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Title contains..."/><input value={year} onChange={e=>setYear(e.target.value)} placeholder="Year" inputMode="numeric"/><button className="button primary">Search</button></form>
    <div className="stack">{loading?<div className="card">Loading…</div>:works.map(w=><WorkCard key={w.id} work={w}/>)}{!loading&&!works.length&&<div className="empty-state">No matching papers.</div>}</div>
  </section>
}
