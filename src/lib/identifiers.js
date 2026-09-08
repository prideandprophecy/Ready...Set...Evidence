export function normalizeDoi(value = '') {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
}

export function normalizeOrcid(value = '') {
  return String(value)
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .replace(/[^0-9X-]/gi, '')
    .toUpperCase();
}

export function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function compactNumber(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatDate(value) {
  if (!value) return 'Not specified';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}
