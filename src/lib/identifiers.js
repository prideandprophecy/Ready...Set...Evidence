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

export function normalizeUsername(value = '') {
  return slugify(value).slice(0, 40);
}

export function usernameIsValid(value = '') {
  const v = normalizeUsername(value);
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(v);
}

export function normalizeWebsiteUrl(value = '') {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function decodeEntities(value = '') {
  if (typeof document !== 'undefined') {
    const el = document.createElement('textarea');
    el.innerHTML = value;
    return el.value;
  }
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#([0-9]+);/g, (_, x) => String.fromCodePoint(parseInt(x, 10)));
}

export function cleanJatsText(value = '') {
  if (!value) return '';
  let text = String(value);
  text = text.replace(/<jats:title>\s*ABSTRACT\s*<\/jats:title>/gi, '');
  text = text.replace(/<jats:title>([\s\S]*?)<\/jats:title>/gi, (_, title) => `\n${title.trim()}: `);
  text = text
    .replace(/<\/jats:p>/gi, '\n\n')
    .replace(/<jats:p[^>]*>/gi, '')
    .replace(/<\/jats:sec>/gi, '\n\n')
    .replace(/<jats:sec[^>]*>/gi, '')
    .replace(/<jats:br\s*\/?>/gi, '\n')
    .replace(/<\/?jats:[^>]+>/gi, '')
    .replace(/<\/?[^>]+>/g, '');
  text = decodeEntities(text);
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function compactNumber(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatDate(value) {
  if (!value) return 'Not specified';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}
