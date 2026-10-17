import { arrow, direction, fmtSigned, fmtSignedPct } from "../format.js";
import { useMarket } from "../market.jsx";

export function Change({ change, pct, showAbs = true }) {
  const dir = direction(change ?? pct);
  return (
    <span className={`change ${dir}`}>
      {arrow(dir)} {showAbs && `${fmtSigned(change)} `}
      {showAbs ? `(${fmtSignedPct(pct)})` : fmtSignedPct(pct)}
    </span>
  );
}

export function WatchStar({ symbol }) {
  const { watchlist, toggleWatch } = useMarket();
  const on = watchlist.includes(symbol);
  return (
    <button
      className={`star ${on ? "on" : ""}`}
      aria-pressed={on}
      aria-label={on ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      onClick={(e) => {
        e.stopPropagation();
        toggleWatch(symbol);
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function StatusBanners() {
  const { error, snapshot } = useMarket();
  const warnings = snapshot?.warnings ?? [];
  return (
    <>
      {error && <div className="banner error">⚠ {error}</div>}
      {warnings.map((w) => (
        <div key={w} className="banner warn">
          ⓘ {w}
        </div>
      ))}
    </>
  );
}
