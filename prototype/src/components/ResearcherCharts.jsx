import { useMemo, useState } from 'react';

// =============================================
// Researcher Charts — all SVG, all useMemo
// =============================================

// Chart dimensions
const W = 360, H = 180, PAD = { t: 25, r: 15, b: 30, l: 40 };
const CW = W - PAD.l - PAD.r;
const CH = H - PAD.t - PAD.b;

// Shared Y-axis helper
function yTicks(max, count = 5) {
  const step = Math.ceil(max / count) || 1;
  const ticks = [];
  for (let i = 0; i <= max; i += step) ticks.push(i);
  if (ticks[ticks.length - 1] < max) ticks.push(max);
  return ticks;
}

// =============================================
// 1. Pain Trend — mean ± SD by POD
// =============================================
function PainTrendChart({ reports }) {
  const data = useMemo(() => {
    if (!reports?.length) return [];
    // Group by POD
    const byPod = {};
    reports.forEach(r => {
      const pod = r.pod ?? r.post_op_day;
      if (pod == null || r.pain_nrs == null) return;
      if (!byPod[pod]) byPod[pod] = [];
      byPod[pod].push(r.pain_nrs);
    });
    // Compute mean ± SD
    return Object.entries(byPod)
      .map(([pod, vals]) => {
        const n = vals.length;
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        const sd = n > 1
          ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
          : 0;
        return { pod: Number(pod), mean, sd, n };
      })
      .sort((a, b) => a.pod - b.pod);
  }, [reports]);

  if (data.length < 2) return null;

  const maxPod = data[data.length - 1].pod;
  const xScale = (pod) => PAD.l + (pod / maxPod) * CW;
  const yScale = (v) => PAD.t + CH - (v / 10) * CH;

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.pod)} ${yScale(d.mean)}`).join(' ');
  const areaPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.pod)} ${yScale(Math.min(10, d.mean + d.sd))}`).join(' ')
    + data.slice().reverse().map(d => `L ${xScale(d.pod)} ${yScale(Math.max(0, d.mean - d.sd))}`).join(' ') + ' Z';

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div className="card-header">
        <div className="card-icon accent">📈</div>
        <div className="card-title">疼痛趨勢（全體 Mean ± SD）</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Y axis */}
        {[0, 2, 4, 6, 8, 10].map(v => (
          <g key={v}>
            <line x1={PAD.l} y1={yScale(v)} x2={W - PAD.r} y2={yScale(v)}
              stroke="var(--border)" strokeDasharray={v === 0 ? '' : '2,3'} />
            <text x={PAD.l - 6} y={yScale(v) + 3} textAnchor="end"
              fill="var(--text-muted)" fontSize="9">{v}</text>
          </g>
        ))}
        {/* X axis labels */}
        {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 8)) === 0 || i === data.length - 1).map(d => (
          <text key={d.pod} x={xScale(d.pod)} y={H - 5} textAnchor="middle"
            fill="var(--text-muted)" fontSize="9">{d.pod === 0 ? 'OP' : d.pod}</text>
        ))}
        <text x={W / 2} y={H} textAnchor="middle" fill="var(--text-muted)" fontSize="8">POD</text>
        {/* SD area */}
        <path d={areaPath} fill="var(--accent)" opacity="0.12" />
        {/* Mean line */}
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
        {/* Data points */}
        {data.map(d => (
          <circle key={d.pod} cx={xScale(d.pod)} cy={yScale(d.mean)} r="3"
            fill="var(--accent)" stroke="var(--bg-primary)" strokeWidth="1.5" />
        ))}
        {/* n labels */}
        {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map(d => (
          <text key={`n-${d.pod}`} x={xScale(d.pod)} y={yScale(d.mean) - 8}
            textAnchor="middle" fill="var(--text-muted)" fontSize="7">n={d.n}</text>
        ))}
      </svg>
    </div>
  );
}

// =============================================
// 2. Adherence Bar Chart
// =============================================
function AdherenceChart({ adherence }) {
  const data = useMemo(() => {
    if (!adherence?.length) return [];
    return adherence
      .map(a => ({ id: a.study_id, pct: Number(a.adherence_pct) || 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [adherence]);

  if (data.length === 0) return null;

  const barH = 20, gap = 4;
  const svgH = PAD.t + data.length * (barH + gap) + 10;
  const xScale = (pct) => PAD.l + (pct / 100) * CW;

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div className="card-header">
        <div className="card-icon cyan">📊</div>
        <div className="card-title">病人依從率</div>
      </div>
      <svg viewBox={`0 0 ${W} ${svgH}`} style={{ width: '100%', height: 'auto' }}>
        {/* 70% threshold line */}
        <line x1={xScale(70)} y1={PAD.t - 5} x2={xScale(70)} y2={svgH - 5}
          stroke="var(--warning)" strokeDasharray="3,3" opacity="0.5" />
        <text x={xScale(70) + 3} y={PAD.t - 2} fill="var(--warning)" fontSize="7">70%</text>
        {/* Bars */}
        {data.map((d, i) => {
          const y = PAD.t + i * (barH + gap);
          const color = d.pct >= 70 ? 'var(--success)' : d.pct >= 40 ? 'var(--warning)' : 'var(--danger)';
          return (
            <g key={d.id}>
              <text x={PAD.l - 4} y={y + barH / 2 + 3} textAnchor="end"
                fill="var(--text-secondary)" fontSize="8">{d.id}</text>
              <rect x={PAD.l} y={y} width={Math.max(2, xScale(d.pct) - PAD.l)} height={barH}
                rx="3" fill={color} opacity="0.7" />
              <text x={Math.max(xScale(d.pct) + 4, PAD.l + 20)} y={y + barH / 2 + 3}
                fill="var(--text-primary)" fontSize="9" fontWeight="500">{d.pct}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// =============================================
// 3. Symptom Distribution — stacked by POD
// =============================================
function SymptomDistChart({ reports }) {
  const data = useMemo(() => {
    if (!reports?.length) return [];
    const byPod = {};
    reports.forEach(r => {
      const pod = r.pod ?? r.post_op_day;
      if (pod == null) return;
      if (!byPod[pod]) byPod[pod] = { pod, total: 0, bleeding: 0, noBowel: 0, fever: 0 };
      byPod[pod].total++;
      if (r.bleeding === '持續' || r.bleeding === '血塊') byPod[pod].bleeding++;
      if (r.bowel === '未排') byPod[pod].noBowel++;
      if (r.fever) byPod[pod].fever++;
    });
    return Object.values(byPod).sort((a, b) => a.pod - b.pod);
  }, [reports]);

  if (data.length < 2) return null;

  const maxPod = data[data.length - 1].pod;
  const maxCount = Math.max(...data.map(d => d.total), 1);
  const barW = Math.max(6, Math.min(18, CW / data.length - 2));
  const xScale = (pod) => PAD.l + (pod / Math.max(maxPod, 1)) * CW;
  const yScale = (count) => PAD.t + CH - (count / maxCount) * CH;
  const categories = [
    { key: 'bleeding', label: '出血（持續/血塊）', color: 'var(--danger)' },
    { key: 'noBowel', label: '未排便', color: 'var(--warning)' },
    { key: 'fever', label: '發燒', color: '#a855f7' },
  ];

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div className="card-header">
        <div className="card-icon danger">🩺</div>
        <div className="card-title">異常症狀分佈（by POD）</div>
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {categories.map(c => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, display: 'inline-block' }} />
            {c.label}
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Y gridlines */}
        {yTicks(maxCount, 4).map(v => (
          <g key={v}>
            <line x1={PAD.l} y1={yScale(v)} x2={W - PAD.r} y2={yScale(v)}
              stroke="var(--border)" strokeDasharray="2,3" />
            <text x={PAD.l - 6} y={yScale(v) + 3} textAnchor="end"
              fill="var(--text-muted)" fontSize="9">{v}</text>
          </g>
        ))}
        {/* Stacked bars */}
        {data.map(d => {
          let yOffset = 0;
          return (
            <g key={d.pod}>
              {categories.map(c => {
                const count = d[c.key];
                if (count === 0) return null;
                const h = (count / maxCount) * CH;
                const y = PAD.t + CH - yOffset - h;
                yOffset += h;
                return (
                  <rect key={c.key} x={xScale(d.pod) - barW / 2} y={y}
                    width={barW} height={Math.max(1, h)} rx="2"
                    fill={c.color} opacity="0.75" />
                );
              })}
              {/* X label */}
              {(d.pod % Math.max(1, Math.ceil(maxPod / 10)) === 0 || d.pod === maxPod) && (
                <text x={xScale(d.pod)} y={H - 5} textAnchor="middle"
                  fill="var(--text-muted)" fontSize="9">{d.pod === 0 ? 'OP' : d.pod}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// =============================================
// 4. Enrollment Timeline
// =============================================
function EnrollmentChart({ patients }) {
  const data = useMemo(() => {
    if (!patients?.length) return [];
    const sorted = [...patients]
      .filter(p => p.surgery_date || p.created_at)
      .sort((a, b) => (a.surgery_date || a.created_at).localeCompare(b.surgery_date || b.created_at));
    return sorted.map((p, i) => ({
      date: p.surgery_date || p.created_at?.split('T')[0],
      cumulative: i + 1,
      id: p.study_id,
    }));
  }, [patients]);

  if (data.length < 2) return null;

  const maxY = data.length;
  const dates = data.map(d => new Date(d.date).getTime());
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const dateRange = maxDate - minDate || 1;

  const xScale = (d) => PAD.l + ((new Date(d).getTime() - minDate) / dateRange) * CW;
  const yScale = (v) => PAD.t + CH - (v / maxY) * CH;

  const linePath = data.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${xScale(d.date)} ${yScale(d.cumulative)}`
  ).join(' ');
  const areaPath = linePath + ` L ${xScale(data[data.length - 1].date)} ${PAD.t + CH} L ${xScale(data[0].date)} ${PAD.t + CH} Z`;

  // Date labels: show first, last, and some in between
  const labelIndices = [0, data.length - 1];
  if (data.length > 4) labelIndices.splice(1, 0, Math.floor(data.length / 2));

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div className="card-header">
        <div className="card-icon success">👥</div>
        <div className="card-title">收案進度</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* Y gridlines */}
        {yTicks(maxY, 4).map(v => (
          <g key={v}>
            <line x1={PAD.l} y1={yScale(v)} x2={W - PAD.r} y2={yScale(v)}
              stroke="var(--border)" strokeDasharray="2,3" />
            <text x={PAD.l - 6} y={yScale(v) + 3} textAnchor="end"
              fill="var(--text-muted)" fontSize="9">{v}</text>
          </g>
        ))}
        {/* Area */}
        <path d={areaPath} fill="var(--cyan)" opacity="0.08" />
        {/* Line */}
        <path d={linePath} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" />
        {/* Step dots */}
        {data.map((d, i) => (
          <circle key={i} cx={xScale(d.date)} cy={yScale(d.cumulative)} r="3"
            fill="var(--cyan)" stroke="var(--bg-primary)" strokeWidth="1.5" />
        ))}
        {/* Date labels */}
        {labelIndices.map(i => (
          <text key={i} x={xScale(data[i].date)} y={H - 5} textAnchor="middle"
            fill="var(--text-muted)" fontSize="8">{data[i].date.slice(5)}</text>
        ))}
        {/* Target line (if applicable) */}
        {maxY < 50 && (
          <>
            <line x1={PAD.l} y1={yScale(50)} x2={W - PAD.r} y2={yScale(50)}
              stroke="var(--accent)" strokeDasharray="4,3" opacity="0.3" />
            <text x={W - PAD.r} y={yScale(50) - 4} textAnchor="end"
              fill="var(--accent)" fontSize="7" opacity="0.6">目標 50</text>
          </>
        )}
      </svg>
    </div>
  );
}

// =============================================
// Main export
// =============================================
export default function ResearcherCharts({ reports, patients, adherence }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginBottom: 'var(--space-md)' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          background: 'none', border: 'none', color: 'var(--text-secondary)',
          fontSize: 'var(--font-sm)', cursor: 'pointer', padding: '4px 0',
          marginBottom: expanded ? 'var(--space-sm)' : 0,
          display: 'flex', alignItems: 'center', gap: '6px',
        }}
      >
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▶</span>
        📊 數據圖表 {!expanded && `(${reports?.length || 0} 筆回報)`}
      </button>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <PainTrendChart reports={reports} patients={patients} />
          <AdherenceChart adherence={adherence} />
          <SymptomDistChart reports={reports} />
          <EnrollmentChart patients={patients} />
        </div>
      )}
    </div>
  );
}
