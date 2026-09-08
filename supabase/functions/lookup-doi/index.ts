const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeDoi(v: string) {
  return String(v || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { doi: raw } = await req.json();
    const doi = normalizeDoi(raw);
    if (!doi) throw new Error('DOI is required.');
    const mailto = Deno.env.get('CROSSREF_MAILTO') || '';
    const url = `https://api.crossref.org/v1/works/${encodeURIComponent(doi)}${mailto ? `?mailto=${encodeURIComponent(mailto)}` : ''}`;
    const response = await fetch(url, { headers: { 'User-Agent': `ReadySetEvidence/0.1${mailto ? ` (mailto:${mailto})` : ''}` } });
    if (!response.ok) throw new Error(`Crossref lookup failed (${response.status}).`);
    const body = await response.json();
    const m = body?.message || {};
    const dateParts = m['published-print']?.['date-parts']?.[0] || m['published-online']?.['date-parts']?.[0] || m.issued?.['date-parts']?.[0] || [];
    const authors = (m.author || []).map((a: any) => ({
      given_name: a.given || '',
      family_name: a.family || '',
      full_name: [a.given, a.family].filter(Boolean).join(' '),
      orcid: a.ORCID || null,
      affiliation: (a.affiliation || []).map((x: any) => x.name).filter(Boolean).join('; ') || null,
    }));
    const work = {
      doi: m.DOI || doi,
      title: m.title?.[0] || '',
      abstract: m.abstract || '',
      journal: m['container-title']?.[0] || '',
      publication_year: dateParts?.[0] || '',
      work_type: m.type === 'journal-article' ? 'journal_article' : (m.type || 'other').replaceAll('-', '_'),
      url: m.URL || `https://doi.org/${doi}`,
      citation: '',
    };
    return new Response(JSON.stringify({ work, authors }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
