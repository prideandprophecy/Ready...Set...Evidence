import { studyDisplayCI } from '../lib/synthesis';

export default function ForestPlot({ studies, pooled }) {
  if (!studies?.length) return null;
  const cis = studies.map(s => ({...studyDisplayCI(s), y:s.y}));
  const values = cis.flatMap(c=>[c.lo,c.hi,c.y]).concat([pooled?.ciLower, pooled?.ciUpper, pooled?.mean]).filter(Number.isFinite);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const width = 920, left=280, right=40, plotW=width-left-right, rowH=42, height=60+studies.length*rowH+56;
  const x = v => left + ((v-min)/(max-min))*plotW;
  return (
    <div className="forest-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Forest plot">
        <line x1={left} x2={left} y1="20" y2={height-32} stroke="currentColor" opacity=".15" />
        {studies.map((s,i)=>{
          const ci=studyDisplayCI(s), cy=42+i*rowH;
          return <g key={s.workId}>
            <text x="8" y={cy+4} fontSize="12">{`${s.title.slice(0,38)}${s.title.length>38?'…':''}${s.year?` (${s.year})`:''}`}</text>
            <line x1={x(ci.lo)} x2={x(ci.hi)} y1={cy} y2={cy} stroke="currentColor" strokeWidth="2" />
            <circle cx={x(s.y)} cy={cy} r="5" fill="currentColor" />
            <text x={width-right} y={cy+4} textAnchor="end" fontSize="11">{s.y.toFixed(3)}</text>
          </g>;
        })}
        {Number.isFinite(pooled?.mean) && <g>
          <line x1={x(pooled.mean)} x2={x(pooled.mean)} y1="20" y2={height-36} stroke="currentColor" opacity=".25" strokeDasharray="4 4"/>
          <polygon points={`${x(pooled.ciLower)},${height-28} ${x(pooled.mean)},${height-40} ${x(pooled.ciUpper)},${height-28} ${x(pooled.mean)},${height-16}`} fill="currentColor" opacity=".85"/>
          <text x="8" y={height-23} fontSize="12" fontWeight="700">Pooled</text>
        </g>}
      </svg>
    </div>
  );
}
