// Adapted from the original Ready...Set...Evidence synthesis panel.
// RAW uses the published RSE appraisal direction: 1 = best, 5 = worst.
// Each study appraisal supplied to RAW should already be the arithmetic mean of its domain scores.

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
  if (![events, n].every(Number.isFinite) || n <= 0 || events < 0 || events > n) return { lo: null, hi: null };
  const p = events / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239];
  const b = [-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572];
  const c = [-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783];
  const d = [0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1-p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  q = p - 0.5;
  r = q*q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

function chiSquareInv(p, df) {
  if (!Number.isFinite(df) || df <= 0) return null;
  const z = normInv(p);
  const a = 2 / (9 * df);
  const val = df * Math.pow(1 - a + z * Math.sqrt(a), 3);
  return Number.isFinite(val) ? Math.max(0, val) : null;
}

function poissonCountCI(k, alpha = 0.05) {
  if (!Number.isFinite(k) || k < 0) return { lo: null, hi: null };
  const lo = k === 0 ? 0 : 0.5 * chiSquareInv(alpha / 2, 2*k);
  const hi = 0.5 * chiSquareInv(1 - alpha / 2, 2*(k+1));
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
    return { center: mean, lo: mean - 1.96*se, hi: mean + 1.96*se, se };
  }
  if (type === 'proportion') {
    if (!Number.isFinite(events) || !Number.isFinite(n) || n <= 0) return null;
    const center = events / n;
    const ci = wilsonCI(events, n);
    const adjusted = events === 0 ? 0.5 : events;
    const pAdj = adjusted / n;
    const se = Math.sqrt((pAdj * (1 - pAdj)) / n);
    return { center, lo: ci.lo, hi: ci.hi, se, continuityNote: events === 0 ? '0-event proportion adjusted for weighting' : null };
  }
  if (type === 'rate') {
    if (!Number.isFinite(events) || !Number.isFinite(exposure) || exposure <= 0) return null;
    const center = events / exposure;
    const cnt = poissonCountCI(events);
    const adjusted = events === 0 ? 0.5 : events;
    const se = Math.sqrt(adjusted) / exposure;
    return { center, lo: cnt.lo / exposure, hi: cnt.hi / exposure, se, continuityNote: events === 0 ? '0-event rate adjusted for weighting' : null };
  }
  return null;
}

function displayValue(row, value, rateScale, proportionAsPercent) {
  if (!Number.isFinite(value)) return null;
  if (row.outcome_type === 'rate') return value * rateScaleFactor(rateScale);
  if (row.outcome_type === 'proportion' && proportionAsPercent) return value * 100;
  return value;
}

function computeTau2DL(y, v) {
  const k = y.length;
  if (k <= 1) return 0;
  const w = v.map(vi => vi > 0 ? 1/vi : 0);
  const sumW = w.reduce((a,b)=>a+b,0);
  if (sumW <= 0) return 0;
  const muFE = y.reduce((acc, yi, i) => acc + w[i]*yi, 0) / sumW;
  const Q = y.reduce((acc, yi, i) => acc + w[i]*(yi-muFE)*(yi-muFE), 0);
  const sumW2 = w.reduce((acc, wi)=>acc+wi*wi,0);
  const C = sumW - sumW2/sumW;
  if (C <= 0) return 0;
  return Math.max(0, (Q - (k-1))/C);
}

export function collapseToStudies(rows, { rateScale='per_1000_days', proportionAsPercent=true } = {}) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.work_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const out = [];
  for (const [workId, studyRows] of grouped.entries()) {
    const usable = [];
    for (const r of studyRows) {
      const base = computePointAndCI(r);
      if (!base || !Number.isFinite(base.se) || base.se <= 0) continue;
      let se = base.se;
      if (r.outcome_type === 'rate') se *= rateScaleFactor(rateScale);
      if (r.outcome_type === 'proportion' && proportionAsPercent) se *= 100;
      const y = displayValue(r, base.center, rateScale, proportionAsPercent);
      if (!Number.isFinite(y)) continue;
      usable.push({ y, v: se*se, row: r });
    }
    if (!usable.length) continue;
    const w = usable.map(u => 1/u.v);
    const sumW = w.reduce((a,b)=>a+b,0);
    if (sumW <= 0) continue;
    const mean = usable.reduce((acc,u,i)=>acc+w[i]*u.y,0)/sumW;
    const variance = 1/sumW;
    const qRaw = studyRows[0]?.community_quality_score;
    const q = qRaw === null || qRaw === undefined || qRaw === '' ? NaN : Number(qRaw);
    out.push({
      workId,
      title: studyRows[0]?.work_title || 'Untitled work',
      year: studyRows[0]?.publication_year,
      y: mean,
      v: variance,
      qualityScore: Number.isFinite(q) ? q : 3,
      rows: studyRows,
    });
  }
  return out;
}

export function runSynthesis(rows, {
  weighting='raw',
  rateScale='per_1000_days',
  proportionAsPercent=true,
} = {}) {
  const studies = collapseToStudies(rows, { rateScale, proportionAsPercent });
  const k = studies.length;
  if (!k) return { k:0, mean:null, ciLower:null, ciUpper:null, tau2:null, studies:[] };
  const y = studies.map(s=>s.y);
  const v = studies.map(s=>s.v);
  const tau2 = ['re_dl','raw'].includes(weighting) ? computeTau2DL(y,v) : 0;
  let w = new Array(k).fill(1);
  if (weighting === 'fe_iv') w = v.map(vi => vi>0 ? 1/vi : 0);
  if (weighting === 're_dl') w = v.map(vi => vi+tau2>0 ? 1/(vi+tau2) : 0);
  if (weighting === 'raw') {
    w = studies.map(s => {
      const qualityMultiplier = 5 - s.qualityScore;
      const denom = s.v + tau2;
      return qualityMultiplier > 0 && denom > 0 ? qualityMultiplier / denom : 0;
    });
  }
  const sumW = w.reduce((a,b)=>a+b,0);
  if (sumW <= 0) return { k, mean:null, ciLower:null, ciUpper:null, tau2, studies };
  const mean = y.reduce((acc,yi,i)=>acc+w[i]*yi,0)/sumW;
  let se;
  if (weighting === 'unweighted') se = Math.sqrt(v.reduce((a,b)=>a+b,0)/(k*k));
  else if (weighting === 'raw') {
    const reW = v.map(vi => vi+tau2>0 ? 1/(vi+tau2) : 0);
    const sw = reW.reduce((a,b)=>a+b,0);
    se = sw>0 ? Math.sqrt(1/sw) : null;
  } else se = Math.sqrt(1/sumW);
  if (!Number.isFinite(se)) return { k, mean, ciLower:null, ciUpper:null, tau2, studies };
  let lo = mean - 1.96*se;
  let hi = mean + 1.96*se;
  const type = rows[0]?.outcome_type;
  if (type === 'rate') lo = Math.max(0,lo);
  if (type === 'proportion') {
    const max = proportionAsPercent ? 100 : 1;
    lo = Math.max(0,lo); hi = Math.min(max,hi);
  }
  return { k, mean, ciLower:lo, ciUpper:hi, tau2, studies };
}

export function studyDisplayCI(study) {
  const se = Math.sqrt(study.v);
  return { lo: study.y - 1.96*se, hi: study.y + 1.96*se };
}
