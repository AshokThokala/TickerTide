import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getHistory, getProfile } from "../api.js";
import { OwnershipBar, PriceChart, RangeBar } from "../components/charts.jsx";
import { Change, WatchStar } from "../components/common.jsx";
import { LivePrice } from "../components/StockTable.jsx";
import { SECTOR_SLUGS } from "../components/Layout.jsx";
import {
  direction,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtFraction,
  fmtMoneyCompact,
  fmtNum,
  fmtPrice,
} from "../format.js";
import { useMarket } from "../market.jsx";

const RANGES = [
  ["5d", "5D"],
  ["1mo", "1M"],
  ["3mo", "3M"],
  ["6mo", "6M"],
  ["1y", "1Y"],
  ["5y", "5Y"],
  ["max", "Max"],
];

const TABS = [
  ["demographics", "Demographics"],
  ["people", "Leadership"],
  ["financials", "Financials & analysts"],
  ["stats", "Key statistics"],
];

function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function Stat({ label, value, hint }) {
  return (
    <div className="stat" title={hint}>
      <dt>{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

export default function StockPage() {
  const symbol = decodeURIComponent(useParams().symbol).toUpperCase();
  const { bySymbol, loading: marketLoading, snapshot, liveSet, liveStatus } = useMarket();
  const q = bySymbol.get(symbol);
  const isMarket = q?.kind === "market";

  const [range, setRange] = useState("6mo");
  const [tab, setTab] = useState("demographics");
  const history = useAsync(() => getHistory(symbol, range), [symbol, range]);
  const profile = useAsync(() => getProfile(symbol), [symbol, snapshot?.run_id]);

  useEffect(() => {
    setTab("demographics");
  }, [symbol]);

  const p = profile.data;
  const name = q?.name || p?.name || symbol;
  const lastClose = history.data?.at(-1)?.close;
  const price = q?.price ?? lastClose;
  const chartDir = direction(history.data?.length > 1 ? history.data.at(-1).close - history.data[0].close : 0);

  if (!q && !history.loading && !profile.loading && history.error && profile.error) {
    return (
      <section className="panel prose">
        <h1>{symbol}</h1>
        <p>We couldn't find data for this symbol. Check the spelling, or search for the company name.</p>
        <Link to="/stocks">Browse all stocks →</Link>
      </section>
    );
  }

  return (
    <>
      <p className="crumbs">
        <Link to="/stocks">Stocks</Link>
        {q?.sector && (
          <>
            {" / "}
            <Link to={`/sectors/${SECTOR_SLUGS[q.sector]}`}>{q.sector}</Link>
          </>
        )}
        {" / "}
        {symbol}
      </p>

      <section className="stock-hero">
        <div>
          <h1>
            {name} <span className="muted">{symbol}</span>
          </h1>
          <p className="muted small">
            {[q?.exchange, q?.currency, p?.company?.industry].filter(Boolean).join(" · ")}
            {q?.market_time && ` · As of ${fmtDateTime(q.market_time)}`}
          </p>
          <div className="hero-price">
            <LivePrice value={price}>{fmtPrice(price, q?.currency, isMarket)}</LivePrice>
            {q && <Change change={q.change} pct={q.change_percent} />}
          </div>
          <LiveNote q={q} isMarket={isMarket} live={liveSet.has(symbol)} status={liveStatus} />
          {!q && marketLoading && <p className="muted small">Loading live quote…</p>}
        </div>
        <div className="hero-actions">
          <WatchStar symbol={symbol} />
          <span className="muted small">Watchlist</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Price history</h2>
          <div className="segmented small" role="tablist" aria-label="Chart range">
            {RANGES.map(([r, label]) => (
              <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {history.error ? (
          <div className="chart-empty">Chart unavailable: {history.error.message}</div>
        ) : (
          <div className={history.loading ? "stale" : ""}>
            <PriceChart history={history.data} dir={chartDir} intraday={range === "5d"} />
          </div>
        )}
        {q && (
          <dl className="stats-row">
            <Stat label="Open" value={fmtNum(q.open)} />
            <Stat label="Prev close" value={fmtNum(q.previous_close)} />
            <Stat label="Day range" value={`${fmtNum(q.day_low)} – ${fmtNum(q.day_high)}`} />
            <Stat label="Volume" value={fmtCompact(q.volume)} />
            <Stat label="Mkt cap" value={q.market_cap ? fmtMoneyCompact(q.market_cap) : "—"} />
            <Stat label="P/E" value={fmtNum(q.pe_trailing)} />
          </dl>
        )}
      </section>

      <section className="panel">
        <div className="tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="tab-body">
          {tab === "stats" ? (
            q ? <KeyStats q={q} /> : <p className="muted">No quote loaded for this symbol yet.</p>
          ) : isMarket ? (
            <p className="muted">
              Company demographics aren't available for indices, commodities or crypto. See Key statistics instead.
            </p>
          ) : profile.loading ? (
            <p className="muted">Loading company profile…</p>
          ) : profile.error || !p ? (
            <p className="muted">Company profile unavailable ({profile.error?.message}).</p>
          ) : tab === "demographics" ? (
            <Demographics p={p} />
          ) : tab === "people" ? (
            <Leadership p={p} />
          ) : (
            <Financials p={p} q={q} />
          )}
          {p?.fetched_at && !isMarket && tab !== "stats" && (
            <p className="muted small source-note">Profile data as of {fmtDateTime(p.fetched_at)}</p>
          )}
        </div>
      </section>
    </>
  );
}

function LiveNote({ q, isMarket, live, status }) {
  if (isMarket) return <p className="live-note muted small">Live streaming covers US stocks only; this updates on refresh.</p>;
  if (live) {
    return (
      <p className="live-note small">
        <span className="live-dot" aria-hidden="true" /> Live via Alpaca ({(status.feed || "iex").toUpperCase()})
        <span className="muted">
          {q?.live_time ? ` · last trade ${new Date(q.live_time).toLocaleTimeString()}` : " · waiting for the next trade"}
        </span>
      </p>
    );
  }
  if (status.state === "disabled" || status.state === "error") {
    return (
      <p className="live-note muted small">
        Price from the last refresh. <Link to="/about#live">Turn on live prices</Link>
      </p>
    );
  }
  return null;
}

function Demographics({ p }) {
  const c = p.company;
  const o = p.ownership;
  const [more, setMore] = useState(false);
  const hasCompany = c.sector || c.industry || c.headquarters || c.employees;
  return (
    <div className="demo-grid">
      <div>
        <h3>Company profile</h3>
        {hasCompany ? (
          <dl className="facts">
            <Stat label="Sector" value={c.sector} />
            <Stat label="Industry" value={c.industry} />
            <Stat label="Headquarters" value={c.headquarters} />
            <Stat label="Employees" value={c.employees ? c.employees.toLocaleString() : null} />
            <Stat
              label="Website"
              value={
                c.website ? (
                  <a href={c.website} target="_blank" rel="noreferrer noopener">
                    {c.website.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : null
              }
            />
            <Stat label="Phone" value={c.phone} />
          </dl>
        ) : (
          <p className="muted">No company profile available.</p>
        )}
        {c.summary && (
          <div className="summary">
            <p className={more ? "" : "clamp"}>{c.summary}</p>
            <button className="link" onClick={() => setMore((m) => !m)}>
              {more ? "Show less" : "Read more"}
            </button>
          </div>
        )}
      </div>

      <div>
        <h3>Who owns the shares</h3>
        <OwnershipBar ownership={o} />
        <dl className="facts">
          <Stat label="Institutional holders" value={o.institutions_count?.toLocaleString()} />
          <Stat label="Institutions (% of float)" value={fmtFraction(o.institutions_float_pct, 1)} />
          <Stat label="Shares outstanding" value={fmtCompact(o.shares_outstanding)} />
          <Stat label="Float" value={fmtCompact(o.float_shares)} />
          <Stat label="Short interest (% of float)" value={fmtFraction(o.short_pct_float)} />
        </dl>
      </div>

      <HoldersTable title="Top institutional holders" rows={o.top_institutions} />
      <HoldersTable title="Top mutual fund holders" rows={o.top_funds} />

      {o.insiders.length > 0 && (
        <div className="span-2">
          <h3>Insider holders</h3>
          <div className="table-scroll" style={{ maxHeight: 320 }}>
            <table className="stock-table compact">
              <thead>
                <tr>
                  <th className="left">Name</th>
                  <th className="left">Role</th>
                  <th>Shares held</th>
                  <th className="left">Latest transaction</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {o.insiders.map((h) => (
                  <tr key={h.name}>
                    <td className="left">{h.name}</td>
                    <td className="left">{h.relation}</td>
                    <td>{fmtCompact(h.shares)}</td>
                    <td className="left">{h.last_transaction || "—"}</td>
                    <td>{fmtDate(h.last_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function HoldersTable({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div>
      <h3>{title}</h3>
      <div className="table-scroll" style={{ maxHeight: 360 }}>
        <table className="stock-table compact">
          <thead>
            <tr>
              <th className="left">Holder</th>
              <th>% held</th>
              <th>Shares</th>
              <th>Value</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.name}>
                <td className="left holder" title={h.name}>
                  {h.name}
                </td>
                <td>{fmtFraction(h.pct_held)}</td>
                <td>{fmtCompact(h.shares)}</td>
                <td>{fmtMoneyCompact(h.value)}</td>
                <td className={`change ${direction(h.pct_change)}`}>
                  {h.pct_change == null ? "—" : `${h.pct_change > 0 ? "+" : ""}${fmtFraction(h.pct_change)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">As of {fmtDate(rows[0].report_date)}</p>
    </div>
  );
}

function Leadership({ p }) {
  const { officers, governance } = p.company;
  const risks = [
    ["Overall", governance.overall],
    ["Audit", governance.audit],
    ["Board", governance.board],
    ["Compensation", governance.compensation],
    ["Shareholder rights", governance.shareholder_rights],
  ].filter(([, v]) => v != null);
  const ages = officers.map((o) => o.age).filter(Boolean);
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;

  return (
    <div className="demo-grid">
      <div className="span-2">
        <h3>Key executives</h3>
        {officers.length ? (
          <>
            <p className="muted small">
              {officers.length} listed executives{avgAge && ` · average age ${avgAge}`}
            </p>
            <div className="table-scroll" style={{ maxHeight: 420 }}>
              <table className="stock-table compact">
                <thead>
                  <tr>
                    <th className="left">Name</th>
                    <th className="left">Title</th>
                    <th>Age</th>
                    <th>Born</th>
                    <th>Total pay</th>
                  </tr>
                </thead>
                <tbody>
                  {officers.map((o) => (
                    <tr key={o.name + o.title}>
                      <td className="left">{o.name}</td>
                      <td className="left">{o.title}</td>
                      <td>{o.age ?? "—"}</td>
                      <td>{o.year_born ?? "—"}</td>
                      <td>{o.total_pay ? fmtMoneyCompact(o.total_pay) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted">No executive data available.</p>
        )}
      </div>
      {risks.length > 0 && (
        <div className="span-2">
          <h3>Governance risk</h3>
          <p className="muted small">ISS scores from 1 (lower risk) to 10 (higher risk).</p>
          <ul className="risk-list">
            {risks.map(([label, v]) => (
              <li key={label}>
                <span>{label}</span>
                <span className="risk-track" aria-hidden="true">
                  <span className={`risk-fill ${v >= 7 ? "high" : v >= 4 ? "mid" : "low"}`} style={{ width: `${v * 10}%` }} />
                </span>
                <strong>
                  {v}/10 · {v >= 7 ? "High" : v >= 4 ? "Medium" : "Low"}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Financials({ p, q }) {
  const v = p.valuation;
  const f = p.financials;
  const a = p.analyst;
  return (
    <div className="demo-grid">
      <div>
        <h3>Valuation</h3>
        <dl className="facts">
          <Stat label="Market cap" value={fmtMoneyCompact(v.market_cap)} />
          <Stat label="Enterprise value" value={fmtMoneyCompact(v.enterprise_value)} />
          <Stat label="Trailing P/E" value={fmtNum(v.trailing_pe)} />
          <Stat label="Forward P/E" value={fmtNum(v.forward_pe)} />
          <Stat label="PEG ratio" value={fmtNum(v.peg_ratio)} />
          <Stat label="Price / book" value={fmtNum(v.price_to_book)} />
          <Stat label="Price / sales" value={fmtNum(v.price_to_sales)} />
          <Stat label="Beta" value={fmtNum(v.beta)} />
          <Stat label="Dividend yield" value={fmtFraction(v.dividend_yield)} />
          <Stat label="Payout ratio" value={fmtFraction(v.payout_ratio)} />
        </dl>
      </div>
      <div>
        <h3>Financials (TTM)</h3>
        <dl className="facts">
          <Stat label="Revenue" value={fmtMoneyCompact(f.revenue)} />
          <Stat label="Revenue growth" value={fmtFraction(f.revenue_growth)} />
          <Stat label="Gross margin" value={fmtFraction(f.gross_margin)} />
          <Stat label="Operating margin" value={fmtFraction(f.operating_margin)} />
          <Stat label="Profit margin" value={fmtFraction(f.profit_margin)} />
          <Stat label="Return on equity" value={fmtFraction(f.return_on_equity)} />
          <Stat label="Total cash" value={fmtMoneyCompact(f.total_cash)} />
          <Stat label="Total debt" value={fmtMoneyCompact(f.total_debt)} />
          <Stat label="Free cash flow" value={fmtMoneyCompact(f.free_cash_flow)} />
        </dl>
      </div>
      <div className="span-2">
        <h3>Analyst view</h3>
        {a.target_mean ? (
          <>
            <p>
              <strong className="rec">{(a.recommendation || "—").replace(/_/g, " ")}</strong>{" "}
              <span className="muted">
                from {a.analysts ?? "?"} analysts · mean score {fmtNum(a.recommendation_mean)} (1 = strong buy, 5 =
                sell)
              </span>
            </p>
            <p className="muted small">
              Price target range, with the current price marked. Mean target {fmtNum(a.target_mean)}.
            </p>
            <RangeBar
              low={Math.min(a.target_low, q?.price ?? a.current_price)}
              high={Math.max(a.target_high, q?.price ?? a.current_price)}
              value={q?.price ?? a.current_price}
              lowLabel={`Low ${fmtNum(a.target_low)}`}
              highLabel={`High ${fmtNum(a.target_high)}`}
            />
          </>
        ) : (
          <p className="muted">No analyst coverage available.</p>
        )}
      </div>
    </div>
  );
}

function KeyStats({ q }) {
  return (
    <dl className="facts wide">
      <Stat label="Previous close" value={fmtNum(q.previous_close)} />
      <Stat label="Open" value={fmtNum(q.open)} />
      <Stat label="Day range" value={`${fmtNum(q.day_low)} – ${fmtNum(q.day_high)}`} />
      <Stat label="52-week range" value={`${fmtNum(q.fifty_two_week_low)} – ${fmtNum(q.fifty_two_week_high)}`} />
      <Stat
        label="52-week change"
        value={q.fifty_two_week_change_percent != null ? `${fmtNum(q.fifty_two_week_change_percent)}%` : null}
      />
      <Stat label="50-day average" value={fmtNum(q.fifty_day_avg)} />
      <Stat label="200-day average" value={fmtNum(q.two_hundred_day_avg)} />
      <Stat label="Volume" value={fmtCompact(q.volume)} />
      <Stat label="Avg volume (3M)" value={fmtCompact(q.avg_volume_3m)} />
      <Stat label="Market cap" value={q.market_cap ? fmtMoneyCompact(q.market_cap, q.currency) : null} />
      <Stat label="Shares outstanding" value={fmtCompact(q.shares_outstanding)} />
      <Stat label="EPS (TTM)" value={fmtNum(q.eps_trailing)} />
      <Stat label="EPS (forward)" value={fmtNum(q.eps_forward)} />
      <Stat label="P/E (TTM)" value={fmtNum(q.pe_trailing)} />
      <Stat label="P/E (forward)" value={fmtNum(q.pe_forward)} />
      <Stat label="Price / book" value={fmtNum(q.price_to_book)} />
      <Stat label="Dividend yield" value={q.dividend_yield != null ? `${fmtNum(q.dividend_yield)}%` : null} />
      <Stat label="Analyst rating" value={q.analyst_rating} />
      <Stat label="Next earnings" value={fmtDate(q.earnings_date)} />
      <Stat label="Market state" value={q.market_state} />
    </dl>
  );
}
