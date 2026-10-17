import { useEffect, useRef, useState } from "react";
import { fmtFraction, fmtNum } from "../format.js";

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Tiny trend line for table rows. */
export function Sparkline({ values, dir, width = 110, height = 30 }) {
  if (!values || values.length < 2) return <span className="muted">—</span>;
  const closes = values;
  const min = Math.min(...closes);
  const span = Math.max(...closes) - min || 1;
  const pts = closes
    .map((c, i) => `${(i / (closes.length - 1)) * width},${2 + (1 - (c - min) / span) * (height - 4)}`)
    .join(" ");
  return (
    <svg className={`spark ${dir}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts} fill="none" />
    </svg>
  );
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/** Full-width price chart with axes, crosshair and tooltip. */
export function PriceChart({ history, dir, height = 280, intraday = false }) {
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState(null);

  const ok = history && history.length >= 2 && width > 0;
  const m = { top: 12, right: 56, bottom: 26, left: 8 };
  const closes = ok ? history.map((h) => h.close) : [];
  const lo = ok ? Math.min(...closes) : 0;
  const hi = ok ? Math.max(...closes) : 1;
  const pad = (hi - lo) * 0.08 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const x = (i) => m.left + (i / Math.max(1, history.length - 1)) * iw;
  const y = (v) => m.top + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const fmtX = (d) =>
    intraday
      ? new Date(d).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
      : new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: history.length > 300 ? "2-digit" : undefined,
        });

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - m.left) / iw) * (history.length - 1));
    setHover(Math.max(0, Math.min(history.length - 1, i)));
  };

  return (
    <div className="price-chart" ref={wrapRef} style={{ height }}>
      {!ok ? (
        <div className="chart-empty">{history ? "Not enough data to chart" : "Loading chart…"}</div>
      ) : (
        <>
          <svg
            width={width}
            height={height}
            className={`chart ${dir}`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`Price from ${fmtNum(closes[0])} to ${fmtNum(closes[closes.length - 1])}`}
          >
            {niceTicks(yMin, yMax).map((t) => (
              <g key={t}>
                <line className="grid" x1={m.left} x2={m.left + iw} y1={y(t)} y2={y(t)} />
                <text className="axis" x={width - m.right + 6} y={y(t) + 4}>
                  {fmtNum(t, t >= 1000 ? 0 : 2)}
                </text>
              </g>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const i = Math.round(f * (history.length - 1));
              return (
                <text
                  key={f}
                  className="axis"
                  x={x(i)}
                  y={height - 6}
                  textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
                >
                  {fmtX(history[i].date)}
                </text>
              );
            })}
            <polygon
              className="area"
              points={`${x(0)},${m.top + ih} ${closes.map((c, i) => `${x(i)},${y(c)}`).join(" ")} ${x(closes.length - 1)},${m.top + ih}`}
            />
            <polyline className="line" points={closes.map((c, i) => `${x(i)},${y(c)}`).join(" ")} />
            {hover != null && (
              <>
                <line className="cursor" x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + ih} />
                <circle className="dot" cx={x(hover)} cy={y(closes[hover])} r={4.5} />
              </>
            )}
          </svg>
          {hover != null && (
            <div
              className="tooltip"
              style={{
                left: Math.min(Math.max(x(hover), 70), width - 70),
                top: Math.max(0, y(closes[hover]) - 52),
              }}
            >
              <strong>{fmtNum(closes[hover])}</strong>
              <span>{fmtX(history[hover].date)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const OWNERSHIP_SERIES = [
  { key: "institutions_pct", label: "Institutions", cls: "s1" },
  { key: "insiders_pct", label: "Insiders", cls: "s2" },
  { key: "public_pct", label: "Public & other", cls: "s3" },
];

/** 100% stacked bar of who owns the shares, with legend and direct labels. */
export function OwnershipBar({ ownership }) {
  const parts = OWNERSHIP_SERIES.map((s) => ({ ...s, value: ownership[s.key] ?? 0 })).filter((p) => p.value > 0);
  if (!parts.length) return <p className="muted">No ownership breakdown available.</p>;
  return (
    <div className="ownership">
      <div className="stack" role="img" aria-label={parts.map((p) => `${p.label} ${fmtFraction(p.value)}`).join(", ")}>
        {parts.map((p) => (
          <div
            key={p.key}
            className={`seg ${p.cls}`}
            style={{ flexGrow: p.value }}
            title={`${p.label}: ${fmtFraction(p.value)}`}
          />
        ))}
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={`swatch ${p.cls}`} />
            {p.label} <strong>{fmtFraction(p.value, 1)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where the current price sits between two bounds (52-week range, analyst targets). */
export function RangeBar({ low, high, value, lowLabel, highLabel }) {
  if (low == null || high == null || value == null || high <= low) return <span className="muted">—</span>;
  const pct = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
  return (
    <div className="range-bar" title={`${fmtNum(low)} – ${fmtNum(high)}`}>
      <div className="track">
        <div className="marker" style={{ left: `${pct}%` }} />
      </div>
      {(lowLabel || highLabel) && (
        <div className="range-labels">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </div>
  );
}
