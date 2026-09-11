import { RATE_SCALE_OPTIONS, formatOutcomeValue, studyDisplayCI } from '../lib/synthesis';

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
  for (let value = start; value <= end + step * 0.5; value += step) {
    out.push(Number(value.toFixed(10)));
  }
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

export default function ForestPlot({
  studies = [],
  pooled,
  title = 'Forest plot',
  plotId = 'rse-forest-plot',
  rateScale = 'per_1000_days',
  proportionAsPercent = true,
}) {
  if (!studies.length) return <div className="empty-state">No usable studies after the selected filters.</div>;

  const outcomeType = studies[0]?.outcomeType || studies[0]?.rows?.[0]?.outcome_type || null;
  const studyCIs = studies.map(study => ({ study, ...studyDisplayCI(study) }));
  const lows = studyCIs.map(x => x.lo).concat([pooled?.ciLower]);
  const highs = studyCIs.map(x => x.hi).concat([pooled?.ciUpper]);
  let min = safeMin(lows);
  let max = safeMax(highs);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.10;
  max += span * 0.10;
  if (outcomeType === 'rate') min = Math.max(0, min);
  if (outcomeType === 'proportion') {
    min = Math.max(0, min);
    max = Math.min(proportionAsPercent ? 100 : 1, max);
  }

  const width = 1060;
  const left = 255;
  const right = 235;
  const plotW = width - left - right - 30;
  const headerH = 48;
  const rowH = 54;
  const footerH = 92;
  const height = headerH + studies.length * rowH + footerH;
  const x = value => left + ((value - min) / (max - min)) * plotW;
  const ticks = makeTicks(min, max, 5);
  const rateLabel = RATE_SCALE_OPTIONS.find(([value]) => value === rateScale)?.[1] || '';
  const unitLabel = outcomeType === 'proportion' && proportionAsPercent ? '%' : outcomeType === 'rate' ? `(${rateLabel})` : '';
  const format = value => formatOutcomeValue(value, outcomeType, { proportionAsPercent });
  const pooledY = height - 48;

  return <div>
    <div className="section-heading" style={{ marginBottom: 8 }}>
      <div><h3 style={{ marginBottom: 2 }}>{title}</h3><div className="muted tiny">Each publication contributes one study-level estimate after eligible endpoint records within that publication are combined.</div></div>
      <button type="button" className="button mini ghost" onClick={() => downloadSvg(plotId, `${plotId}.svg`)}>Download SVG</button>
    </div>
    <div className="forest-wrap" style={{ overflowX: 'auto' }}>
      <svg id={plotId} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ maxWidth: '100%', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
        <rect x="1" y="1" width={width - 2} height={height - 2} rx="14" fill="#fff" stroke="#dce6eb" />
        <rect x="1" y="1" width={width - 2} height={headerH} rx="14" fill="#f5f9fc" />
        <line x1="1" x2={width - 1} y1={headerH} y2={headerH} stroke="#dce6eb" />
        <text x="14" y="29" fontSize="12" fill="#143A6F" fontWeight="700">Study</text>
        <text x={left} y="29" fontSize="12" fill="#143A6F" fontWeight="700">Estimate {unitLabel}</text>
        <text x={width - right + 12} y="29" fontSize="12" fill="#143A6F" fontWeight="700">Estimate (95% CI)</text>

        {ticks.map((tick, index) => <g key={index}>
          <line x1={x(tick)} x2={x(tick)} y1={headerH} y2={height - footerH + 12} stroke="#edf2f7" />
          <text x={x(tick)} y={height - 10} textAnchor="middle" fontSize="10" fill="#64748b">{format(tick)}</text>
        </g>)}

        {studyCIs.map(({ study, lo, hi }, index) => {
          const rowTop = headerH + index * rowH;
          const cy = rowTop + 24;
          const radius = Number.isFinite(study.qualityScore) ? Math.max(3.7, Math.min(5.8, 7 - study.qualityScore * 0.65)) : 4.6;
          const metadata = [
            study.cohortCount > 1 ? `${study.cohortCount} cohorts merged` : null,
            study.endpointCount > 1 ? `${study.endpointCount} endpoints` : null,
            Number.isFinite(study.qualityScore) ? `appraisal ${study.qualityScore.toFixed(2)}` : null,
            study.denominatorLabel,
            study.continuityNotes?.length ? study.continuityNotes.join('; ') : null,
          ].filter(Boolean).join(' • ');
          return <g key={study.workId}>
            <line x1="14" x2={width - 14} y1={rowTop + rowH} y2={rowTop + rowH} stroke="#edf2f7" />
            <text x="14" y={cy - 4} fontSize="12" fill="#143A6F" fontWeight="700">{study.label}</text>
            {metadata && <text x="14" y={cy + 11} fontSize="9.5" fill="#64748b">{metadata.length > 62 ? `${metadata.slice(0, 62)}…` : metadata}</text>}
            <line x1={x(lo)} x2={x(hi)} y1={cy} y2={cy} stroke="#143A6F" strokeWidth="3" strokeLinecap="round" />
            <circle cx={x(study.y)} cy={cy} r={radius + 2} fill="#fff" />
            <circle cx={x(study.y)} cy={cy} r={radius} fill="#4ABCB3" stroke="#143A6F" strokeWidth="1" />
            <text x={width - right + 12} y={cy + 4} fontSize="11" fill="#0f172a" fontWeight="700">{format(study.y)} ({format(lo)} to {format(hi)})</text>
          </g>;
        })}

        {Number.isFinite(pooled?.mean) && Number.isFinite(pooled?.ciLower) && Number.isFinite(pooled?.ciUpper) && <g>
          <line x1="0" x2={width} y1={height - footerH + 12} y2={height - footerH + 12} stroke="#dce6eb" />
          <text x="14" y={pooledY - 7} fontSize="12" fill="#143A6F" fontWeight="800">Pooled</text>
          <text x="14" y={pooledY + 9} fontSize="10" fill="#64748b">k={pooled.k}{Number.isFinite(pooled.tau2) ? ` • τ²=${pooled.tau2.toFixed(6)}` : ''}</text>
          <line x1={x(pooled.ciLower)} x2={x(pooled.ciUpper)} y1={pooledY} y2={pooledY} stroke="#143A6F" strokeWidth="3.2" />
          <polygon points={`${x(pooled.ciLower)},${pooledY} ${x(pooled.mean)},${pooledY - 8} ${x(pooled.ciUpper)},${pooledY} ${x(pooled.mean)},${pooledY + 8}`} fill="#143A6F" />
          <text x={width - right + 12} y={pooledY + 4} fontSize="11" fill="#0f172a" fontWeight="700">{format(pooled.mean)} ({format(pooled.ciLower)} to {format(pooled.ciUpper)})</text>
        </g>}
      </svg>
    </div>
  </div>;
}
