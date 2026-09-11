// Ready...Set...Evidence synthesis utilities.
// Restores the original RSE synthesis behavior while keeping the Commons data model.
// RAW uses appraisal direction 1 = best, 5 = worst. Study appraisal supplied to RAW
// should already be the arithmetic mean of the selected appraisal framework domains.

export const WEIGHTING_OPTIONS = [
  ['unweighted', 'Unweighted'],
  ['fe_iv', 'Fixed-effect (inverse variance)'],
  ['re_dl', 'Random-effects (DerSimonian-Laird)'],
  ['raw', 'Random Appraisal-Weighted (RAW)'],
];

export const RATE_SCALE_OPTIONS = [
  ['per_day', 'Per day'],
  ['per_1000_days', 'Per 1,000 days'],
  ['per_year', 'Per year'],
];

export const OUTCOME_DIRECTION_OPTIONS = [
  ['higher_better', 'Higher values reflect better performance'],
  ['lower_better', 'Lower values reflect better performance'],
];

export function rateScaleFactor(scale) {
  if (scale === 'per_1000_days') return 1000;
  if (scale === 'per_year') return 365.25;
  return 1;
}

function seContinuous(mean, sd, n) {
  if (![mean, sd, n].every(Number.isFinite) || n <= 1) return null;
  return sd / Math.sqrt(n);
}

function wilsonCI(events, n, z = 1.96) {
  if (![events, n].every(Number.isFinite) || n <= 0 || events < 0 || events > n) {
    return { lo: null, hi: null };
  }
  const p = events / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

// Acklam inverse normal approximation, retained from the original RSE synthesis module.
function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q;
  let r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function chiSquareInv(p, df) {
  if (!Number.isFinite(df) || df <= 0) return null;
  const z = normInv(p);
  const a = 2 / (9 * df);
  const value = df * Math.pow(1 - a + z * Math.sqrt(a), 3);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function poissonCountCI(k, alpha = 0.05) {
  if (!Number.isFinite(k) || k < 0) return { lo: null, hi: null };
  const lo = k === 0 ? 0 : 0.5 * chiSquareInv(alpha / 2, 2 * k);
  const hi = 0.5 * chiSquareInv(1 - alpha / 2, 2 * (k + 1));
  return { lo, hi };
}

export function computePointAndCI(row) {
  const type = row.outcome_type;
  const mean = Number(row.mean);
  const sd = Number(row.sd);
  const n = Number(row.n);
  const events = Number(row.events);
  const exposure = Number(row.total_exposure);

  if (type === 'continuous') {
    const se = seContinuous(mean, sd, n);
    if (!Number.isFinite(se)) return null;
    return {
      center: mean,
      lo: mean - 1.96 * se,
      hi: mean + 1.96 * se,
      se,
      continuityNote: null,
    };
  }

  if (type === 'proportion') {
    if (!Number.isFinite(events) || !Number.isFinite(n) || n <= 0 || events < 0 || events > n) return null;
    const center = events / n;
    const ci = wilsonCI(events, n);

    // Keep the observed point estimate, but use a continuity adjustment only for
    // variance/weighting when the observed proportion is exactly 0% or 100%.
    let adjustedEvents = events;
    let continuityNote = null;
    if (events === 0) {
      adjustedEvents = 0.5;
      continuityNote = '0% adjusted for weighting';
    } else if (events === n) {
      adjustedEvents = Math.max(0, n - 0.5);
      continuityNote = '100% adjusted for weighting';
    }
    const pAdjusted = adjustedEvents / n;
    const se = Math.sqrt((pAdjusted * (1 - pAdjusted)) / n);
    return { center, lo: ci.lo, hi: ci.hi, se, continuityNote };
  }

  if (type === 'rate') {
    if (!Number.isFinite(events) || !Number.isFinite(exposure) || exposure <= 0 || events < 0) return null;
    const center = events / exposure;
    const countCI = poissonCountCI(events);
    const adjustedEvents = events === 0 ? 0.5 : events;
    const se = Math.sqrt(adjustedEvents) / exposure;
    return {
      center,
      lo: countCI.lo == null ? null : countCI.lo / exposure,
      hi: countCI.hi == null ? null : countCI.hi / exposure,
      se,
      continuityNote: events === 0 ? '0-event rate adjusted for weighting' : null,
    };
  }

  return null;
}

function displayValue(row, value, rateScale, proportionAsPercent) {
  if (!Number.isFinite(value)) return null;
  if (row.outcome_type === 'rate') return value * rateScaleFactor(rateScale);
  if (row.outcome_type === 'proportion' && proportionAsPercent) return value * 100;
  return value;
}

function displaySE(row, se, rateScale, proportionAsPercent) {
  if (!Number.isFinite(se)) return null;
  if (row.outcome_type === 'rate') return se * rateScaleFactor(rateScale);
  if (row.outcome_type === 'proportion' && proportionAsPercent) return se * 100;
  return se;
}

function clampCI(type, lo, hi, proportionAsPercent) {
  let lower = lo;
  let upper = hi;
  if (type === 'rate') lower = Math.max(0, lower);
  if (type === 'proportion') {
    const max = proportionAsPercent ? 100 : 1;
    lower = Math.max(0, lower);
    upper = Math.min(max, upper);
  }
  return { lo: lower, hi: upper };
}

function computeTau2DL(y, v) {
  const k = y.length;
  if (k <= 1) return 0;
  const weights = v.map(vi => (vi > 0 ? 1 / vi : 0));
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return 0;
  const meanFE = y.reduce((acc, yi, i) => acc + weights[i] * yi, 0) / sumW;
  const q = y.reduce((acc, yi, i) => acc + weights[i] * (yi - meanFE) * (yi - meanFE), 0);
  const sumW2 = weights.reduce((acc, wi) => acc + wi * wi, 0);
  const c = sumW - sumW2 / sumW;
  if (c <= 0) return 0;
  return Math.max(0, (q - (k - 1)) / c);
}

function firstFinite(values) {
  return values.find(v => Number.isFinite(v));
}

function meanFinite(values) {
  const vals = values.map(Number).filter(Number.isFinite);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function studyLabelFromRow(row) {
  const author = String(row.first_author || '').trim();
  const year = row.publication_year ? String(row.publication_year) : '';
  if (author && year) return `${author} ${year}`;
  if (author) return author;
  if (year) return `Study ${year}`;
  return 'Study';
}

/**
 * Collapse all eligible endpoint records from the same publication into one
 * synthesized study unit before between-study pooling. This preserves the
 * original RSE behavior that prevents a study with several eligible cohorts
 * from automatically receiving several independent study weights.
 */
export function collapseToStudies(rows, { rateScale = 'per_1000_days', proportionAsPercent = true } = {}) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = row.work_id || `row-${row.extraction_id || Math.random()}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const output = [];
  for (const [workId, studyRows] of grouped.entries()) {
    const usable = [];

    for (const row of studyRows) {
      const base = computePointAndCI(row);
      if (!base || !Number.isFinite(base.se) || base.se <= 0) continue;
      const y = displayValue(row, base.center, rateScale, proportionAsPercent);
      const se = displaySE(row, base.se, rateScale, proportionAsPercent);
      if (!Number.isFinite(y) || !Number.isFinite(se) || se <= 0) continue;
      const baseLo = displayValue(row, base.lo, rateScale, proportionAsPercent);
      const baseHi = displayValue(row, base.hi, rateScale, proportionAsPercent);
      usable.push({ y, v: se * se, row, baseLo, baseHi, continuityNote: base.continuityNote });
    }

    if (!usable.length) continue;
    const withinWeights = usable.map(u => 1 / u.v);
    const sumWithinWeights = withinWeights.reduce((a, b) => a + b, 0);
    if (sumWithinWeights <= 0) continue;

    const y = usable.reduce((acc, u, i) => acc + withinWeights[i] * u.y, 0) / sumWithinWeights;
    const v = 1 / sumWithinWeights;
    const outcomeType = usable[0].row.outcome_type;

    let ciLower;
    let ciUpper;
    if (usable.length === 1 && Number.isFinite(usable[0].baseLo) && Number.isFinite(usable[0].baseHi)) {
      // Preserve Wilson/Poisson interval behavior for a single endpoint record.
      ciLower = usable[0].baseLo;
      ciUpper = usable[0].baseHi;
    } else {
      const se = Math.sqrt(v);
      const clamped = clampCI(outcomeType, y - 1.96 * se, y + 1.96 * se, proportionAsPercent);
      ciLower = clamped.lo;
      ciUpper = clamped.hi;
    }

    const cohortIds = new Set(usable.map(u => u.row.cohort_id).filter(Boolean));
    const cohortLabels = Array.from(new Set(usable.map(u => u.row.cohort_label).filter(Boolean)));
    const extractionIds = Array.from(new Set(usable.map(u => u.row.extraction_id).filter(Boolean)));
    const continuityNotes = Array.from(new Set(usable.map(u => u.continuityNote).filter(Boolean)));
    const qualityScore = meanFinite(studyRows.map(r => r.community_quality_score));
    const appraisalCount = Math.max(0, ...studyRows.map(r => Number(r.appraisal_count) || 0));

    let denominatorLabel = null;
    if (outcomeType === 'rate') {
      const totalExposure = usable.reduce((acc, u) => acc + (Number.isFinite(Number(u.row.total_exposure)) ? Number(u.row.total_exposure) : 0), 0);
      if (totalExposure > 0) denominatorLabel = `t=${Math.round(totalExposure).toLocaleString()}`;
    } else {
      const totalN = usable.reduce((acc, u) => acc + (Number.isFinite(Number(u.row.n)) ? Number(u.row.n) : 0), 0);
      if (totalN > 0) denominatorLabel = `n=${Math.round(totalN).toLocaleString()}`;
    }

    const first = studyRows[0] || {};
    output.push({
      workId,
      title: first.work_title || 'Untitled work',
      firstAuthor: first.first_author || '',
      label: studyLabelFromRow(first),
      year: first.publication_year || null,
      doi: first.doi || null,
      pmid: first.pmid || null,
      y,
      v,
      ciLower,
      ciUpper,
      qualityScore: Number.isFinite(qualityScore) ? qualityScore : null,
      appraisalCount,
      cohortCount: cohortIds.size,
      cohortLabels,
      endpointCount: extractionIds.length,
      extractionIds,
      denominatorLabel,
      continuityNotes,
      rows: studyRows,
      outcomeType,
      poolWeight: null,
      poolWeightPct: null,
    });
  }

  output.sort((a, b) => {
    const yearA = Number(a.year) || 0;
    const yearB = Number(b.year) || 0;
    if (yearA !== yearB) return yearB - yearA;
    return String(a.label).localeCompare(String(b.label));
  });
  return output;
}

export function runSynthesis(rows, {
  weighting = 'raw',
  rateScale = 'per_1000_days',
  proportionAsPercent = true,
} = {}) {
  const studies = collapseToStudies(rows, { rateScale, proportionAsPercent });
  const k = studies.length;
  if (!k) return { k: 0, mean: null, ciLower: null, ciUpper: null, tau2: null, studies: [] };

  const y = studies.map(s => s.y);
  const v = studies.map(s => s.v);
  const tau2 = ['re_dl', 'raw'].includes(weighting) ? computeTau2DL(y, v) : 0;

  let weights = new Array(k).fill(1);
  if (weighting === 'fe_iv') weights = v.map(vi => (vi > 0 ? 1 / vi : 0));
  if (weighting === 're_dl') weights = v.map(vi => (vi + tau2 > 0 ? 1 / (vi + tau2) : 0));
  if (weighting === 'raw') {
    weights = studies.map(study => {
      const appraisal = Number.isFinite(study.qualityScore) ? study.qualityScore : 3;
      const qualityMultiplier = 5 - appraisal;
      const denom = study.v + tau2;
      return qualityMultiplier > 0 && denom > 0 ? qualityMultiplier / denom : 0;
    });
  }

  const sumW = weights.reduce((a, b) => a + b, 0);
  const weightedStudies = studies.map((study, i) => ({
    ...study,
    poolWeight: weights[i],
    poolWeightPct: sumW > 0 ? (weights[i] / sumW) * 100 : null,
  }));

  if (sumW <= 0) return { k, mean: null, ciLower: null, ciUpper: null, tau2, studies: weightedStudies };
  const mean = y.reduce((acc, yi, i) => acc + weights[i] * yi, 0) / sumW;

  let se = null;
  if (weighting === 'unweighted') {
    se = Math.sqrt(v.reduce((a, b) => a + b, 0) / (k * k));
  } else if (weighting === 'raw') {
    // Preserve the original RSE RAW CI behavior: the RAW mean is appraisal-weighted,
    // while its uncertainty uses the random-effects precision structure.
    const reWeights = v.map(vi => (vi + tau2 > 0 ? 1 / (vi + tau2) : 0));
    const sumRE = reWeights.reduce((a, b) => a + b, 0);
    se = sumRE > 0 ? Math.sqrt(1 / sumRE) : null;
  } else {
    se = Math.sqrt(1 / sumW);
  }

  if (!Number.isFinite(se)) return { k, mean, ciLower: null, ciUpper: null, tau2, studies: weightedStudies };
  const outcomeType = rows?.[0]?.outcome_type || weightedStudies[0]?.outcomeType;
  const clamped = clampCI(outcomeType, mean - 1.96 * se, mean + 1.96 * se, proportionAsPercent);
  return {
    k,
    mean,
    ciLower: clamped.lo,
    ciUpper: clamped.hi,
    tau2,
    studies: weightedStudies,
  };
}

export function studyDisplayCI(study) {
  if (Number.isFinite(study?.ciLower) && Number.isFinite(study?.ciUpper)) {
    return { lo: study.ciLower, hi: study.ciUpper };
  }
  const se = Math.sqrt(study?.v);
  return { lo: study?.y - 1.96 * se, hi: study?.y + 1.96 * se };
}

export function formatOutcomeValue(value, outcomeType, { proportionAsPercent = true, decimals } = {}) {
  if (!Number.isFinite(value)) return '—';
  const defaultDecimals = outcomeType === 'proportion' && proportionAsPercent ? 1 : outcomeType === 'rate' ? 2 : 2;
  return Number(value).toFixed(decimals ?? defaultDecimals);
}

/**
 * Restores the original RSE comparator zoning logic.
 * Zone boundaries are the comparator pooled lower CI, mean, and upper CI.
 */
export function buildComparisonZones(modelA, modelB, direction) {
  const valid = modelA && modelB && Number.isFinite(modelA.mean) && Number.isFinite(modelA.ciLower) && Number.isFinite(modelA.ciUpper) &&
    Number.isFinite(modelB.mean) && Number.isFinite(modelB.ciLower) && Number.isFinite(modelB.ciUpper) &&
    ['higher_better', 'lower_better'].includes(direction);
  if (!valid) return { enabled: false, lo: null, mid: null, hi: null, call: null };

  const lo = modelB.ciLower;
  const mid = modelB.mean;
  const hi = modelB.ciUpper;
  let call;

  if (direction === 'higher_better') {
    call = {
      superiority: modelA.ciLower > hi,
      nonInferiority: modelA.ciUpper > lo,
      equivalence: modelA.mean > lo,
    };
  } else {
    call = {
      superiority: modelA.ciUpper < lo,
      nonInferiority: modelA.ciLower < hi,
      equivalence: modelA.mean < hi,
    };
  }

  return { enabled: true, lo, mid, hi, call };
}
