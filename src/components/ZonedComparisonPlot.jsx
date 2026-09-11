import { RATE_SCALE_OPTIONS, buildComparisonZones, formatOutcomeValue, studyDisplayCI } from '../lib/synthesis';

function safeMin(values) {
  const filtered = values.filter(Number.isFinite);
  return filtered.length ? Math.min(...filtered) : null;
}

function safeMax(values) {
  const filtered = values.filter(Number.isFinite);
  return filtered.length ? Math.max(...filtered) : null;
}

function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 2.5) return 2.5 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function makeTicks(min, max, target = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const step = niceStep((max - min) / target);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out = [];
  for (let value = start; value <= end + step * 0.5; value += step) out.push(Number(value.toFixed(10)));
  return out;
}

function downloadSvg(id, fileName) {
  const svg = document.getElementById(id);
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 100);
}

export default function ZonedComparisonPlot({
  modelA,
  modelB,
  labelA = 'Evidence set A',
  labelB = 'Evidence set B',
  direction,
  rateScale = 'per_1000_days',
  proportionAsPercent = true,
  plotId = 'rse-zoned-comparison',
}) {
  if (!modelA?.studies?.length || !modelB?.studies?.length) {
    return <div className="empty-state">Both evidence sets need usable studies before the zoned comparison can be displayed.</div>;
  }
  if (!direction) {
    return <div className="empty-state">Select whether higher or lower values reflect better performance to enable the RSE comparison zones.</div>;
  }

  const zones = buildComparisonZones(modelA, modelB, direction);
  if (!zones.enabled) return <div className="empty-state">The comparator pooled estimate and confidence interval are required for zoning.</div>;

  const studies = modelA.studies;
  const outcomeType = studies[0]?.outcomeType || studies[0]?.rows?.[0]?.outcome_type || null;
  const studyCIs = studies.map(study => ({ study, ...studyDisplayCI(study) }));
  let min = safeMin(studyCIs.map(x => x.lo).concat([modelA.ciLower, modelB.ciLower, modelB.mean]));
  let max = safeMax(studyCIs.map(x => x.hi).concat([modelA.ciUpper, modelB.ciUpper, modelB.mean]));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.12;
  max += span * 0.12;
  if (outcomeType === 'rate') min = Math.max(0, min);
  if (outcomeType === 'proportion') {
    min = Math.max(0, min);
    max = Math.min(proportionAsPercent ? 100 : 1, max);
  }

  const width = 1100;
  const left = 255;
  const right = 245;
  const plotW = width - left - right - 30;
  const headerH = 58;
  const topPad = 24;
  const rowH = 56;
  const footerH = 132;
  const height = headerH + topPad + studies.length * rowH + footerH;
  const plotBottom = height - footerH + 10;
  const x = value => left + ((value - min) / (max - min)) * plotW;
  const ticks = makeTicks(min, max, 5);
  const rateLabel = RATE_SCALE_OPTIONS.find(([value]) => value === rateScale)?.[1] || '';
  const unitLabel = outcomeType === 'proportion' && proportionAsPercent ? '%' : outcomeType === 'rate' ? `(${rateLabel})` : '';
  const format = value => formatOutcomeValue(value, outcomeType, { proportionAsPercent });

  const semantics = direction === 'higher_better'
    ? ['inferiority', 'non_inferiority', 'equivalence', 'superiority']
    : ['superiority', 'equivalence', 'non_inferiority', 'inferiority'];
  const labels = {
    inferiority: 'Inferiority',
    non_inferiority: 'Non-Inferiority',
    equivalence: 'Equivalence',
    superiority: 'Superiority',
  };
  const fills = {
    inferiority: '#fff1f2',
    non_inferiority: '#fffbeb',
    equivalence: '#ecfdf5',
    superiority: '#eff6ff',
  };
  const boundaries = [min, zones.lo, zones.mid, zones.hi, max];
  const segments = [0, 1, 2, 3].map(i => ({
    x: x(boundaries[i]),
    width: Math.max(0, x(boundaries[i + 1]) - x(boundaries[i])),
    semantic: semantics[i],
  }));

  const callText = (() => {
    if (!zones.call) return '';
    const parts = [];
    if (zones.call.superiority) parts.push('Superiority');
    else if (zones.call.nonInferiority) parts.push('Non-Inferiority');
    else parts.push('Inferiority / unclear');
    if (zones.call.equivalence) parts.push('Equivalence threshold met');
    return parts.join(' • ');
  })();

  const pooledY = height - footerH + 48;
  const comparatorY = pooledY + 42;

  return <div>
    <div className="section-heading" style={{ marginBottom: 8 }}>
      <div>
        <div className="eyebrow">RSE zoned comparison</div>
        <h2 style={{ marginBottom: 4 }}>{labelA} vs {labelB}</h2>
        <div className="muted tiny">Zones are defined by the pooled 95% CI and mean of {labelB}. Study rows represent {labelA}.</div>
      </div>
      <button type="button" className="button mini ghost" onClick={() => downloadSvg(plotId, `${plotId}.svg`)}>Download SVG</button>
    </div>
    {callText && <div className="subtle-callout"><strong>RSE zoning result:</strong> {callText}</div>}
    <div className="forest-wrap" style={{ overflowX: 'auto' }}>
      <svg id={plotId} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${labelA} versus ${labelB} zoned forest plot`} style={{ maxWidth: '100%', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
        <rect x="1" y="1" width={width - 2} height={height - 2} rx="14" fill="#fff" stroke="#dce6eb" />
        <rect x="1" y="1" width={width - 2} height={headerH} rx="14" fill="#f5f9fc" />
        <line x1="1" x2={width - 1} y1={headerH} y2={headerH} stroke="#dce6eb" />
        <text x="14" y="31" fontSize="12" fill="#143A6F" fontWeight="700">Study</text>
        <text x={left} y="31" fontSize="12" fill="#143A6F" fontWeight="700">Estimate {unitLabel}</text>
        <text x={width - right + 12} y="31" fontSize="12" fill="#143A6F" fontWeight="700">Estimate (95% CI)</text>

        {segments.map((segment, index) => <g key={segment.semantic}>
          <rect x={segment.x} y={headerH} width={segment.width} height={height - headerH} fill={fills[segment.semantic]} opacity="0.72" />
          {segment.width >= 76 && <text x={segment.x + segment.width / 2} y={headerH + 15} textAnchor="middle" fontSize="9.5" fill="#334155" fontWeight="700">{labels[segment.semantic]}</text>}
        </g>)}
        {[zones.lo, zones.mid, zones.hi].map((value, index) => <line key={index} x1={x(value)} x2={x(value)} y1={headerH} y2={height} stroke="#94a3b8" strokeDasharray="4 4" />)}

        {ticks.map((tick, index) => <g key={index}>
          <line x1={x(tick)} x2={x(tick)} y1={headerH} y2={plotBottom} stroke="#edf2f7" />
          <text x={x(tick)} y={height - 10} textAnchor="middle" fontSize="10" fill="#64748b">{format(tick)}</text>
        </g>)}

        {studyCIs.map(({ study, lo, hi }, index) => {
          const rowTop = headerH + topPad + index * rowH;
          const cy = rowTop + 21;
          const radius = Number.isFinite(study.qualityScore) ? Math.max(3.7, Math.min(5.8, 7 - study.qualityScore * 0.65)) : 4.6;
          const meta = [
            study.cohortCount > 1 ? `${study.cohortCount} cohorts merged` : null,
            Number.isFinite(study.qualityScore) ? `appraisal ${study.qualityScore.toFixed(2)}` : null,
            study.denominatorLabel,
            study.continuityNotes?.length ? study.continuityNotes.join('; ') : null,
          ].filter(Boolean).join(' • ');
          return <g key={study.workId}>
            <line x1="14" x2={width - 14} y1={rowTop + rowH} y2={rowTop + rowH} stroke="#e5e7eb" opacity=".8" />
            <text x="14" y={cy - 4} fontSize="12" fill="#143A6F" fontWeight="700">{study.label}</text>
            {meta && <text x="14" y={cy + 11} fontSize="9.5" fill="#64748b">{meta.length > 62 ? `${meta.slice(0, 62)}…` : meta}</text>}
            <line x1={x(lo)} x2={x(hi)} y1={cy} y2={cy} stroke="#143A6F" strokeWidth="3" strokeLinecap="round" />
            <circle cx={x(study.y)} cy={cy} r={radius + 2} fill="#fff" />
            <circle cx={x(study.y)} cy={cy} r={radius} fill="#4ABCB3" stroke="#143A6F" strokeWidth="1" />
            <text x={width - right + 12} y={cy + 4} fontSize="11" fill="#0f172a" fontWeight="700">{format(study.y)} ({format(lo)} to {format(hi)})</text>
          </g>;
        })}

        <line x1="0" x2={width} y1={height - footerH + 10} y2={height - footerH + 10} stroke="#dce6eb" />
        <text x="14" y={pooledY - 8} fontSize="12" fill="#143A6F" fontWeight="800">Pooled {labelA}</text>
        <text x="14" y={pooledY + 8} fontSize="10" fill="#64748b">k={modelA.k}{Number.isFinite(modelA.tau2) ? ` • τ²=${modelA.tau2.toFixed(6)}` : ''}</text>
        <line x1={x(modelA.ciLower)} x2={x(modelA.ciUpper)} y1={pooledY} y2={pooledY} stroke="#143A6F" strokeWidth="3.2" />
        <polygon points={`${x(modelA.ciLower)},${pooledY} ${x(modelA.mean)},${pooledY - 8} ${x(modelA.ciUpper)},${pooledY} ${x(modelA.mean)},${pooledY + 8}`} fill="#143A6F" />
        <text x={width - right + 12} y={pooledY + 4} fontSize="11" fill="#0f172a" fontWeight="700">{format(modelA.mean)} ({format(modelA.ciLower)} to {format(modelA.ciUpper)})</text>

        <text x="14" y={comparatorY} fontSize="11" fill="#334155" fontWeight="700">Comparator {labelB}: {format(modelB.mean)} ({format(modelB.ciLower)} to {format(modelB.ciUpper)}) • k={modelB.k}</text>
      </svg>
    </div>
  </div>;
}
