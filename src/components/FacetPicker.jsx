import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { supabase } from '../supabaseClient';

export const FACET_TYPES = [
  ['population', 'Population'],
  ['condition', 'Condition / indication'],
  ['intervention', 'Intervention / therapy'],
  ['device', 'Device'],
  ['drug_biologic', 'Drug / biologic'],
  ['procedure', 'Procedure'],
  ['diagnostic', 'Diagnostic / test'],
  ['exposure', 'Exposure'],
  ['setting', 'Clinical setting'],
  ['geography', 'Geography'],
  ['characteristic', 'Characteristic / variant'],
  ['other', 'Other'],
];

export const facetTypeLabel = value => FACET_TYPES.find(x => x[0] === value)?.[1] || value || 'Other';

export function facetFilterObject(items = []) {
  const grouped = {};
  for (const item of items) {
    if (!item?.id || !item?.concept_type) continue;
    if (!grouped[item.concept_type]) grouped[item.concept_type] = [];
    if (!grouped[item.concept_type].includes(item.id)) grouped[item.concept_type].push(item.id);
  }
  return grouped;
}

export function facetSummary(items = []) {
  return items.map(x => `${facetTypeLabel(x.concept_type)}: ${x.canonical_label || x.label}`).join(' • ');
}

export default function FacetPicker({
  selected = [],
  onAdd,
  onRemove,
  allowCreate = false,
  conceptVisibility = 'public',
  ownerOrgId = null,
  searchOrgId = null,
  includePrivate = false,
  disabled = false,
  label = 'Structured facets',
  help = 'Use reusable concepts rather than free-text tags. Multiple values in the same category act as alternatives in synthesis.',
}) {
  const [type, setType] = useState('population');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const selectedIds = useMemo(() => new Set(selected.map(x => x.id)), [selected]);

  useEffect(() => {
    if (disabled || query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(() => { search(); }, 250);
    return () => clearTimeout(timer);
  }, [query, type, searchOrgId, includePrivate, disabled]);

  async function search() {
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('rse_search_concepts', {
      p_query: q,
      p_type: type || null,
      p_org_id: searchOrgId || null,
      p_include_private: Boolean(includePrivate),
      p_limit: 10,
    });
    if (error) setMessage(error.message);
    setResults((data || []).filter(x => !selectedIds.has(x.id)));
    setBusy(false);
  }

  async function createConcept() {
    const q = query.trim();
    if (!allowCreate || !q) return;
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('rse_get_or_create_concept', {
      p_label: q,
      p_type: type,
      p_visibility: conceptVisibility || 'public',
      p_org_id: conceptVisibility === 'organization' ? ownerOrgId || null : null,
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    const concept = Array.isArray(data) ? data[0] : data;
    if (concept) onAdd?.(concept);
    setQuery('');
    setResults([]);
    setBusy(false);
  }

  return <div className="form-stack compact">
    <div>
      <strong>{label}</strong>
      {help && <div className="muted tiny">{help}</div>}
    </div>

    {selected.length > 0 && <div className="tag-row">
      {selected.map(item => <span className="tag" key={item.id}>
        <span className="muted tiny">{facetTypeLabel(item.concept_type)}:</span>&nbsp;{item.canonical_label || item.label}
        {!disabled && onRemove && <button type="button" className="button text mini" onClick={() => onRemove(item)} aria-label={`Remove ${item.canonical_label || item.label}`}><X size={12} /></button>}
      </span>)}
    </div>}

    <div className="facet-picker-controls">
      <label className="facet-type-field">
        Facet category
        <select value={type} onChange={e => setType(e.target.value)} disabled={disabled}>
          {FACET_TYPES.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
        </select>
      </label>
      <label className="facet-query-field">
        Find or create concept
        <div className="facet-search-input">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={e => setQuery(e.target.value)} disabled={disabled} placeholder="Type at least 2 characters..." />
        </div>
      </label>
    </div>

    {query.trim().length >= 2 && <div className="stack compact">
      {busy && <div className="muted tiny">Searching…</div>}
      {!busy && results.map(item => <div className="duplicate-row" key={item.id}>
        <div><strong>{item.canonical_label}</strong><div className="muted tiny">{facetTypeLabel(item.concept_type)}{item.visibility !== 'public' ? ` • ${item.visibility}` : ''}{Number(item.match_score) >= 0.9 ? ' • close match' : ''}</div></div>
        <button type="button" className="button mini secondary" onClick={() => { onAdd?.(item); setQuery(''); setResults([]); }}>Add</button>
      </div>)}
      {!busy && allowCreate && <div className="duplicate-row">
        <div><strong>Not the same as an existing concept?</strong><div className="muted tiny">Create “{query.trim()}” as {facetTypeLabel(type)}. Exact spacing/punctuation duplicates are automatically mapped to the existing concept.</div></div>
        <button type="button" className="button mini ghost" onClick={createConcept}><Plus size={13} /> Create</button>
      </div>}
      {!busy && !results.length && !allowCreate && <div className="muted tiny">No matching concepts.</div>}
    </div>}
    {message && <div className="notice">{message}</div>}
  </div>;
}
