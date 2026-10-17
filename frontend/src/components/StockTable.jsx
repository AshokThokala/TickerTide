import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { direction, fmtCompact, fmtMoneyCompact, fmtNum, fmtPrice } from "../format.js";
import { useMarket } from "../market.jsx";
import { RangeBar, Sparkline } from "./charts.jsx";
import { Change, WatchStar } from "./common.jsx";

const COLUMNS = [
  { key: "symbol", label: "Symbol", align: "left", sort: (q) => q.symbol },
  { key: "price", label: "Price", sort: (q) => q.price },
  { key: "change_percent", label: "Change", sort: (q) => q.change_percent },
  { key: "trend", label: "3M trend", sortable: false },
  { key: "volume", label: "Volume", sort: (q) => q.volume },
  { key: "avg_volume_3m", label: "Avg vol (3M)", sort: (q) => q.avg_volume_3m },
  { key: "market_cap", label: "Mkt cap", sort: (q) => q.market_cap },
  { key: "pe_trailing", label: "P/E", sort: (q) => q.pe_trailing },
  { key: "dividend_yield", label: "Div yield", sort: (q) => q.dividend_yield },
  { key: "range", label: "52W range", sortable: false },
];

/** Price that briefly flashes green/red when a live trade moves it. */
export function LivePrice({ value, children }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (prev.current != null && value != null && value !== prev.current) {
      setFlash(value > prev.current ? "flash-up" : "flash-down");
      const t = setTimeout(() => setFlash(null), 900);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
    return undefined;
  }, [value]);
  return <span className={`live-price ${flash ?? ""}`}>{children}</span>;
}

const Row = memo(function Row({ q, live }) {
  const navigate = useNavigate();
  const isMarket = q.kind === "market";
  const open = () => navigate(`/stock/${encodeURIComponent(q.symbol)}`);
  const trend = q.spark?.length > 1 ? q.spark.at(-1) - q.spark[0] : 0;
  return (
    <tr onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} tabIndex={0} className="row-link">
      <td className="col-star">
        <WatchStar symbol={q.symbol} />
      </td>
      <td className="left">
        <div className="sym">
          {q.symbol}
          {live && (
            <span className="live-dot" title="Streaming live trades">
              <span className="sr-only">live</span>
            </span>
          )}
        </div>
        <div className="sub" title={q.name}>
          {q.name}
        </div>
      </td>
      <td className="strong">
        <LivePrice value={q.price}>{fmtPrice(q.price, q.currency, isMarket)}</LivePrice>
      </td>
      <td>
        <Change change={q.change} pct={q.change_percent} />
      </td>
      <td>
        <Sparkline values={q.spark} dir={direction(trend)} />
      </td>
      <td>{fmtCompact(q.volume)}</td>
      <td>{fmtCompact(q.avg_volume_3m)}</td>
      <td>{q.market_cap ? fmtMoneyCompact(q.market_cap, q.currency) : "—"}</td>
      <td>{fmtNum(q.pe_trailing)}</td>
      <td>{q.dividend_yield != null ? `${fmtNum(q.dividend_yield)}%` : "—"}</td>
      <td className="col-range">
        <RangeBar
          low={q.fifty_two_week_low}
          high={q.fifty_two_week_high}
          value={q.price}
          lowLabel={fmtNum(q.fifty_two_week_low, 0)}
          highLabel={fmtNum(q.fifty_two_week_high, 0)}
        />
      </td>
    </tr>
  );
});

/**
 * Stocks as rows in a scrollable panel with a sticky header.
 * Click a column header to sort; click a row to open the stock page.
 */
export function StockTable({ quotes, maxHeight = "65vh", initialSort = null, emptyText = "No stocks to show." }) {
  const { liveSet } = useMarket();
  const [sort, setSort] = useState(initialSort);

  const rows = useMemo(() => {
    if (!sort) return quotes;
    const col = COLUMNS.find((c) => c.key === sort.key);
    return [...quotes].sort((a, b) => {
      const va = col.sort(a);
      const vb = col.sort(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [quotes, sort]);

  const toggleSort = (key) =>
    setSort((cur) =>
      cur?.key === key ? (cur.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: key === "symbol" ? "asc" : "desc" }
    );

  return (
    <div className="table-scroll" style={{ maxHeight }} tabIndex={0} aria-label="Stock list">
      <table className="stock-table">
        <thead>
          <tr>
            <th className="col-star" aria-label="Watchlist" />
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={c.align === "left" ? "left" : ""}
                aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                {c.sortable === false ? (
                  c.label
                ) : (
                  <button className="th-sort" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    <span className="sort-ind">{sort?.key === c.key ? (sort.dir === "asc" ? "↑" : "↓") : ""}</span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="empty">
                {emptyText}
              </td>
            </tr>
          )}
          {rows.map((q) => (
            <Row key={q.symbol} q={q} live={liveSet.has(q.symbol)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
