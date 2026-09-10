export function frameworkDomains(framework) {
  const schema = framework?.response_schema;
  if (!schema) return [];
  if (Array.isArray(schema)) return schema;
  return Array.isArray(schema.domains) ? schema.domains : [];
}

export function calculateDomainMean(responses = {}) {
  const domainMap = responses?.domains || {};
  const scores = Object.values(domainMap)
    .map(v => Number(v?.score ?? v))
    .filter(Number.isFinite);
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export function temporalityScore(publicationYear, referenceDate = new Date()) {
  const year = Number(publicationYear);
  if (!Number.isFinite(year)) return null;
  const age = referenceDate.getFullYear() - year;
  if (age <= 3) return 1;
  if (age <= 5) return 2;
  if (age <= 10) return 3;
  if (age <= 20) return 4;
  return 5;
}

export function makeInitialResponses(framework, publicationYear, previous = null) {
  const domains = frameworkDomains(framework);
  const priorDomains = previous?.domains || {};
  const next = {};
  for (const domain of domains) {
    const prior = priorDomains[domain.key];
    if (prior?.score != null) {
      next[domain.key] = prior;
      continue;
    }
    if (domain.auto === 'temporality_from_publication_year') {
      const score = temporalityScore(publicationYear);
      if (score != null) {
        const option = (domain.options || []).find(o => Number(o.score) === score);
        next[domain.key] = { score, value: option?.value || String(score), label: option?.label || String(score), auto: true };
        continue;
      }
    }
    next[domain.key] = { score: null, value: '', label: '' };
  }
  return {
    domains: next,
    score_method: 'arithmetic_mean_of_domain_scores',
    temporality_reference_date: previous?.temporality_reference_date || new Date().toISOString().slice(0, 10),
  };
}

export function setDomainResponse(responses, domain, value) {
  const option = (domain.options || []).find(o => String(o.value) === String(value));
  return {
    ...(responses || {}),
    domains: {
      ...(responses?.domains || {}),
      [domain.key]: {
        value: option?.value ?? value,
        label: option?.label ?? String(value),
        score: option?.score != null ? Number(option.score) : Number(value),
        auto: false,
      },
    },
  };
}

export function appraisalComplete(framework, responses) {
  const domains = frameworkDomains(framework);
  if (!domains.length) return false;
  return domains.every(d => Number.isFinite(Number(responses?.domains?.[d.key]?.score)));
}

export function scoreLabel(score) {
  if (!Number.isFinite(Number(score))) return 'Not scored';
  const x = Number(score);
  if (x < 1.75) return 'Strong';
  if (x < 2.75) return 'Generally strong';
  if (x < 3.75) return 'Moderate';
  if (x < 4.5) return 'Weak';
  return 'Very weak';
}
