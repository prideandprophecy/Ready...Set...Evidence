import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { supabase } from '../supabaseClient';

export const OUTCOME_TYPES = [
  ['proportion', 'Proportion'],
  ['rate', 'Rate'],
  ['continuous', 'Continuous'],
];

export const outcomeTypeLabel = value => OUTCOME_TYPES.find(x => x[0] === value)?.[1] || value || 'Outcome';

export function suggestedOutcomeLabel(label, type) {
  const base = String(label || '').trim();
  if (!base) return '';
  if (type === 'proportion') return `${base} %`;
  if (type === 'rate') return `${base} Rate`;
  if (type === 'continuous') return `${base} Mean`;
  return base;
}

export default function OutcomeConceptPicker({
  conceptId = '',
  label = '',
  outcomeType = 'proportion',
  onChange,
  disabled = false,
  allowCreate = true,
  title = 'Outcome concept',
  help = 'Use an existing canonical outcome when possible. Outcome concepts are tied to one outcome type, so the same canonical name cannot be reused for a different type.',
}) {
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (disabled || conceptId || String(label || '').trim().length < 2) {
      setResults([]);
      setMessage('');
      return undefined;
    }
    const timer = setTimeout(() => search(), 250);
    return () => clearTimeout(timer);
  }, [label, outcomeType, conceptId, disabled]);

  async function search() {
    const q = String(label || '').trim();
    if (q.length < 2) return;
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('rse_search_outcome_concepts', {
      p_query: q,
      p_type: null,
      p_limit: 10,
    });
    if (error) setMessage(error.message);
    setResults(data || []);
    setBusy(false);
  }

  const exact = useMemo(() => (results || []).find(x => x.exact_match), [results]);
  const exactTypeConflict = Boolean(exact && exact.default_outcome_type !== outcomeType);
  const conflictSuggestion = exactTypeConflict ? suggestedOutcomeLabel(label, outcomeType) : '';

  function choose(item) {
    onChange?.({
      outcome_concept_id: item.id,
      outcome_label: item.label,
      outcome_type: item.default_outcome_type,
    });
    setResults([]);
    setMessage('');
  }

  function clearSelection() {
    onChange?.({
      outcome_concept_id: '',
      outcome_label: '',
      outcome_type: outcomeType || 'proportion',
    });
    setResults([]);
    setMessage('');
  }

  async function createConcept() {
    const q = String(label || '').trim();
    if (!allowCreate || !q || exactTypeConflict) return;
    setBusy(true);
    setMessage('');
    const { data, error } = await supabase.rpc('rse_get_or_create_outcome_concept', {
      p_label: q,
      p_type: outcomeType,
    });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    const concept = Array.isArray(data) ? data[0] : data;
    if (concept) choose(concept);
    setBusy(false);
  }

  if (conceptId) {
    return <div className="form-stack compact">
      <div>
        <strong>{title}</strong>
        {help && <div className="muted tiny">{help}</div>}
      </div>
      <div className="duplicate-row">
        <div>
          <strong>{label}</strong>
          <div className="muted tiny">{outcomeTypeLabel(outcomeType)} • canonical outcome concept</div>
        </div>
        {!disabled && <button type="button" className="button mini ghost" onClick={clearSelection}><X size={13} /> Change</button>}
      </div>
    </div>;
  }

  return <div className="form-stack compact">
    <div>
      <strong>{title}</strong>
      {help && <div className="muted tiny">{help}</div>}
    </div>

    <div className="facet-picker-controls">
      <label className="facet-type-field">
        Outcome type
        <select
          value={outcomeType}
          onChange={e => onChange?.({ outcome_concept_id: '', outcome_label: label, outcome_type: e.target.value })}
          disabled={disabled}
        >
          {OUTCOME_TYPES.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
        </select>
      </label>

      <label className="facet-query-field">
        Find or create outcome
        <div className="facet-search-input">
          <Search size={15} aria-hidden="true" />
          <input
            value={label}
            onChange={e => onChange?.({ outcome_concept_id: '', outcome_label: e.target.value, outcome_type: outcomeType })}
            disabled={disabled}
            placeholder="Type at least 2 characters..."
          />
        </div>
      </label>
    </div>

    {String(label || '').trim().length >= 2 && <div className="stack compact">
      {busy && <div className="muted tiny">Searching…</div>}

      {!busy && results.map(item => <div className="duplicate-row" key={item.id}>
        <div>
          <strong>{item.label}</strong>
          <div className="muted tiny">
            {outcomeTypeLabel(item.default_outcome_type)}
            {item.exact_match ? ' • exact match' : Number(item.match_score) >= 0.8 ? ' • close match' : ''}
            {item.match_source === 'alias' ? ' • matched alias' : ''}
          </div>
        </div>
        <button type="button" className="button mini secondary" onClick={() => choose(item)}>Use</button>
      </div>)}

      {!busy && exactTypeConflict && <div className="subtle-callout" style={{ margin: 0 }}>
        <strong>That outcome name is already assigned to {outcomeTypeLabel(exact.default_outcome_type)}.</strong>
        <div className="muted tiny" style={{ marginTop: 4 }}>
          Outcome names are unique across outcome types. For a {outcomeTypeLabel(outcomeType).toLowerCase()} version, use a distinct canonical label such as <strong>{conflictSuggestion}</strong>.
        </div>
      </div>}

      {!busy && allowCreate && !exactTypeConflict && !exact && <div className="duplicate-row">
        <div>
          <strong>Create a new canonical outcome?</strong>
          <div className="muted tiny">Create “{String(label || '').trim()}” as {outcomeTypeLabel(outcomeType)}. Spacing and punctuation variants resolve to the existing canonical outcome when possible.</div>
        </div>
        <button type="button" className="button mini ghost" onClick={createConcept}><Plus size={13} /> Create</button>
      </div>}

      {!busy && exact && !exactTypeConflict && <div className="muted tiny">An exact canonical outcome already exists. Use the existing outcome instead of creating another one.</div>}
    </div>}

    {message && <div className="notice">{message}</div>}
  </div>;
}
