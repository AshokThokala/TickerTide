import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Change, PageHeader } from "../components/common.jsx";
import { SECTOR_SLUGS } from "../components/Layout.jsx";
import { StockTable } from "../components/StockTable.jsx";
import { arrow, direction, fmtMoneyCompact, fmtNum, fmtSignedPct } from "../format.js";
import { useAuth } from "../auth.jsx";
import { useMarket } from "../market.jsx";

const SLUG_TO_SECTOR = Object.fromEntries(Object.entries(SECTOR_SLUGS).map(([k, v]) => [v, k]));

function useQuotes() {
  const { quotes } = useMarket();
  return useMemo(
    () => ({ all: quotes, stocks: quotes.filter((q) => q.kind === "stock"), markets: quotes.filter((q) => q.kind === "market") }),
    [quotes]
  );
}

function Loading() {
  const { loading, error } = useMarket();
  if (error) return null;
  return <div className="panel loading-panel">{loading ? "Pulling the latest market data…" : "No data yet."}</div>;
}

function filterQuotes(quotes, text) {
  const t = text.trim().toLowerCase();
  if (!t) return quotes;
  return quotes.filter((q) => q.symbol.toLowerCase().includes(t) || q.name.toLowerCase().includes(t));
}

function sectorStats(stocks) {
  const groups = {};
  for (const q of stocks) {
    if (!q.sector) continue;
    (groups[q.sector] ??= []).push(q);
  }
  return Object.entries(groups)
    .map(([sector, qs]) => {
      const withPct = qs.filter((q) => q.change_percent != null);
      const cap = qs.reduce((s, q) => s + (q.market_cap || 0), 0);
      // market-cap weighted change, like a sector index
      const weighted = cap
        ? qs.reduce((s, q) => s + (q.change_percent || 0) * (q.market_cap || 0), 0) / cap
        : withPct.reduce((s, q) => s + q.change_percent, 0) / (withPct.length || 1);
      const sorted = [...withPct].sort((a, b) => b.change_percent - a.change_percent);
      return {
        sector,
        slug: SECTOR_SLUGS[sector],
        count: qs.length,
        cap,
        change: weighted,
        advancers: withPct.filter((q) => q.change_percent > 0).length,
        best: sorted[0],
        worst: sorted.at(-1),
      };
    })
    .sort((a, b) => b.change - a.change);
}

/* ------------------------------------------------------------------ Overview */

export function OverviewPage() {
  const { all, stocks, markets } = useQuotes();
  const [filter, setFilter] = useState("");
  if (!all.length) return <Loading />;

  const withPct = stocks.filter((q) => q.change_percent != null);
  const up = withPct.filter((q) => q.change_percent > 0).length;
  const down = withPct.filter((q) => q.change_percent < 0).length;
  const sorted = [...withPct].sort((a, b) => b.change_percent - a.change_percent);
  const sectors = sectorStats(stocks);

  return (
    <>
      <PageHeader title="Market overview" subtitle="Indices, breadth, movers and every tracked stock at a glance." />

      <div className="overview-grid">
        <section className="panel">
          <h2>Indices & commodities</h2>
          <ul className="mini-list">
            {markets.map((q) => (
              <li key={q.symbol}>
                <Link to={`/stock/${encodeURIComponent(q.symbol)}`}>
                  <span className="mini-name">{q.name}</span>
                  <span className="mini-val">{fmtNum(q.price)}</span>
                  <Change change={q.change} pct={q.change_percent} showAbs={false} />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Market breadth</h2>
          <div className="breadth">
            <div className="breadth-bar" role="img" aria-label={`${up} advancing, ${down} declining`}>
              <div className="adv" style={{ flexGrow: up }} />
              <div className="dec" style={{ flexGrow: down }} />
            </div>
            <div className="breadth-labels">
              <span className="change up">▲ {up} advancing</span>
              <span className="change down">▼ {down} declining</span>
            </div>
          </div>
          <h3>Top gainers</h3>
          <MiniMovers quotes={sorted.slice(0, 4)} />
          <h3>Top losers</h3>
          <MiniMovers quotes={sorted.slice(-4).reverse()} />
          <Link to="/movers" className="more">
            All movers →
          </Link>
        </section>

        <section className="panel">
          <h2>Sector performance</h2>
          <SectorBars sectors={sectors} compact />
          <Link to="/sectors" className="more">
            All sectors →
          </Link>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>All stocks</h2>
          <input
            className="filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by symbol or name"
            aria-label="Filter stocks"
          />
        </div>
        <StockTable quotes={filterQuotes(stocks, filter)} />
      </section>
    </>
  );
}

function MiniMovers({ quotes }) {
  return (
    <ul className="mini-list">
      {quotes.map((q) => (
        <li key={q.symbol}>
          <Link to={`/stock/${encodeURIComponent(q.symbol)}`}>
            <span className="mini-name">
              <strong>{q.symbol}</strong> <span className="muted">{q.name}</span>
            </span>
            <Change change={q.change} pct={q.change_percent} showAbs={false} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Diverging horizontal bars around zero; label carries value so colour isn't the only cue. */
function SectorBars({ sectors, compact = false }) {
  const max = Math.max(0.5, ...sectors.map((s) => Math.abs(s.change)));
  return (
    <ul className={`sector-bars ${compact ? "compact" : ""}`}>
      {sectors.map((s) => {
        const dir = direction(s.change);
        const w = (Math.abs(s.change) / max) * 50;
        return (
          <li key={s.sector}>
            <Link to={`/sectors/${s.slug}`} title={`${s.sector}: ${fmtSignedPct(s.change)}`}>
              <span className="sb-name">{s.sector}</span>
              <span className="sb-track">
                <span className="sb-zero" />
                <span
                  className={`sb-bar ${dir}`}
                  style={dir === "down" ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }}
                />
              </span>
              <span className={`change ${dir} sb-val`}>
                {arrow(dir)} {fmtSignedPct(s.change)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ All stocks */

export function StocksPage() {
  const { stocks, markets } = useQuotes();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("");
  const view = params.get("view") || "stocks";
  const sector = params.get("sector") || "";
  if (!stocks.length) return <Loading />;

  let quotes = view === "markets" ? markets : stocks;
  if (view !== "markets" && sector) quotes = quotes.filter((q) => q.sector === sector);
  const set = (k, v) => {
    const next = new URLSearchParams(params);
    v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={view === "markets" ? "Indices & commodities" : "All stocks"}
        subtitle={`${quotes.length} instruments · click a column to sort, a row for full details and demographics`}
      />
      <section className="panel">
        <div className="panel-head">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={view === "stocks"} onClick={() => set("view", "")}>
              Stocks
            </button>
            <button role="tab" aria-selected={view === "markets"} onClick={() => set("view", "markets")}>
              Indices & commodities
            </button>
          </div>
          <div className="filters">
            {view !== "markets" && (
              <select value={sector} onChange={(e) => set("sector", e.target.value)} aria-label="Sector">
                <option value="">All sectors</option>
                {Object.keys(SECTOR_SLUGS).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            <input
              className="filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by symbol or name"
              aria-label="Filter"
            />
          </div>
        </div>
        <StockTable quotes={filterQuotes(quotes, filter)} maxHeight="70vh" />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ Watchlist */

export function WatchlistPage() {
  const { watchlist, bySymbol, updateWatchlist, snapshot, loading, liveStatus } = useMarket();
  const { user, ready } = useAuth();
  const [sym, setSym] = useState("");
  const errors = snapshot?.errors ?? {};
  const quotes = watchlist.map((s) => bySymbol.get(s)).filter(Boolean);
  const failed = watchlist.filter((s) => errors[s]);
  const pending = watchlist.filter((s) => !bySymbol.has(s) && !errors[s]);

  const add = (e) => {
    e.preventDefault();
    const s = sym.trim().toUpperCase();
    setSym("");
    if (s && !watchlist.includes(s)) updateWatchlist([...watchlist, s]);
  };

  return (
    <>
      <PageHeader
        title="Your watchlist"
        subtitle={
          user
            ? `Saved to your account (${user.email}). Any symbol Yahoo Finance knows can be added.`
            : "Saved in this browser. Any symbol Yahoo Finance knows can be added."
        }
      >
        <form onSubmit={add} className="inline-form">
          <input
            value={sym}
            onChange={(e) => setSym(e.target.value)}
            placeholder="Add symbol, e.g. SHOP"
            aria-label="Add symbol"
            maxLength={15}
          />
          <button className="btn" type="submit">
            Add
          </button>
        </form>
      </PageHeader>
      {ready && !user && (
        <div className="banner info">
          ⓘ <Link to="/signin?next=/watchlist">Sign in</Link> or <Link to="/signup?next=/watchlist">create an account</Link>{" "}
          to keep your watchlist on every device.
        </div>
      )}
      {failed.map((s) => (
        <div key={s} className="banner warn">
          ⚠ <strong>{s}</strong>: {errors[s]}{" "}
          <button className="link" onClick={() => updateWatchlist(watchlist.filter((x) => x !== s))}>
            Remove
          </button>
        </div>
      ))}
      {pending.length > 0 && loading && <div className="banner info">Fetching {pending.join(", ")}…</div>}
      {liveStatus.state === "connected" && liveStatus.over_limit?.length > 0 && (
        <div className="banner info">
          ⓘ Your Alpaca plan streams up to {liveStatus.limit} symbols at once. Not live right now:{" "}
          {liveStatus.over_limit.join(", ")}. They still update on Refresh.
        </div>
      )}
      <section className="panel">
        <StockTable
          quotes={quotes}
          maxHeight="70vh"
          emptyText="Your watchlist is empty. Tap ☆ on any stock to add it."
        />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ Movers */

const MOVER_TABS = {
  gainers: { label: "Top gainers", sort: { key: "change_percent", dir: "desc" }, pick: (s) => s.change_percent > 0 },
  losers: { label: "Top losers", sort: { key: "change_percent", dir: "asc" }, pick: (s) => s.change_percent < 0 },
  active: { label: "Most active", sort: { key: "volume", dir: "desc" }, pick: () => true },
};

export function MoversPage() {
  const { stocks } = useQuotes();
  const [params, setParams] = useSearchParams();
  const tab = MOVER_TABS[params.get("tab")] ? params.get("tab") : "gainers";
  if (!stocks.length) return <Loading />;
  const cfg = MOVER_TABS[tab];
  const key = cfg.sort.key;
  const quotes = stocks
    .filter((q) => q[key] != null && cfg.pick(q))
    .sort((a, b) => (cfg.sort.dir === "asc" ? a[key] - b[key] : b[key] - a[key]))
    .slice(0, 20);

  return (
    <>
      <PageHeader title="Market movers" subtitle="Biggest moves and heaviest trading across tracked stocks today." />
      <section className="panel">
        <div className="panel-head">
          <div className="segmented" role="tablist">
            {Object.entries(MOVER_TABS).map(([k, v]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <StockTable key={tab} quotes={quotes} initialSort={cfg.sort} emptyText="Nothing here today." />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ Sectors */

export function SectorsPage() {
  const { stocks } = useQuotes();
  if (!stocks.length) return <Loading />;
  const sectors = sectorStats(stocks);
  return (
    <>
      <PageHeader title="Sectors" subtitle="Market-cap weighted daily change for each sector." />
      <section className="panel">
        <SectorBars sectors={sectors} />
      </section>
      <section className="panel">
        <div className="table-scroll" style={{ maxHeight: "60vh" }}>
          <table className="stock-table">
            <thead>
              <tr>
                <th className="left">Sector</th>
                <th>Change</th>
                <th>Stocks</th>
                <th>Advancing</th>
                <th>Total mkt cap</th>
                <th className="left">Best</th>
                <th className="left">Worst</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((s) => (
                <SectorRow key={s.sector} s={s} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function SectorRow({ s }) {
  const navigate = useNavigate();
  const go = () => navigate(`/sectors/${s.slug}`);
  return (
    <tr className="row-link" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === "Enter" && go()}>
      <td className="left sym">{s.sector}</td>
      <td>
        <Change change={s.change} pct={s.change} showAbs={false} />
      </td>
      <td>{s.count}</td>
      <td>
        {s.advancers} / {s.count}
      </td>
      <td>{fmtMoneyCompact(s.cap)}</td>
      <td className="left">
        {s.best && (
          <>
            {s.best.symbol} <span className="change up">{fmtSignedPct(s.best.change_percent)}</span>
          </>
        )}
      </td>
      <td className="left">
        {s.worst && (
          <>
            {s.worst.symbol} <span className={`change ${direction(s.worst.change_percent)}`}>{fmtSignedPct(s.worst.change_percent)}</span>
          </>
        )}
      </td>
    </tr>
  );
}

export function SectorDetailPage() {
  const { slug } = useParams();
  const { stocks } = useQuotes();
  const sector = SLUG_TO_SECTOR[slug];
  if (!sector) return <NotFoundPage />;
  if (!stocks.length) return <Loading />;
  const quotes = stocks.filter((q) => q.sector === sector);
  const stat = sectorStats(quotes)[0];
  return (
    <>
      <p className="crumbs">
        <Link to="/sectors">Sectors</Link> / {sector}
      </p>
      <PageHeader
        title={sector}
        subtitle={
          stat && `${stat.count} stocks · ${fmtMoneyCompact(stat.cap)} combined market cap · ${stat.advancers} advancing`
        }
      >
        {stat && (
          <span className="big-change">
            <Change change={stat.change} pct={stat.change} showAbs={false} />
          </span>
        )}
      </PageHeader>
      <section className="panel">
        <StockTable quotes={quotes} initialSort={{ key: "market_cap", dir: "desc" }} />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ Static */

export function AboutPage() {
  return (
    <>
      <PageHeader title="About TickerTide" />
      <section className="panel prose">
        <h2>What it is</h2>
        <p>
          TickerTide tracks major US stocks across all 11 sectors, plus the main indices, gold, crude oil and Bitcoin.
          Open any stock for its price history, key statistics and company demographics: where it's based, how many
          people it employs, who runs it and who owns its shares.
        </p>
        <h2>How the data gets here</h2>
        <ol>
          <li>
            <strong>Extract.</strong> A Python pipeline calls Yahoo Finance's public endpoints: batch quotes, batch price
            history, and company profiles on demand.
          </li>
          <li>
            <strong>Transform.</strong> Raw responses are cleaned into one consistent record per instrument: price,
            change, volume, valuation ratios and a 3-month price series.
          </li>
          <li>
            <strong>Load.</strong> Each run is saved to a local SQLite database. Company profiles are cached for six
            hours.
          </li>
        </ol>
        <p>
          A fresh run of all ~500 S&P 500 stocks happens every time you open the site, and whenever you press{" "}
          <strong>Refresh</strong>. The list of S&P 500 members is checked once a day.
        </p>
        <h2 id="live">Live prices</h2>
        <p>
          With Alpaca API keys, prices for the stock you're viewing and your watchlist update live, trade by trade,
          between refreshes. The green <strong>Live</strong> badge in the header shows the connection state.
        </p>
        <ol>
          <li>
            Create a free account at{" "}
            <a href="https://alpaca.markets" target="_blank" rel="noreferrer noopener">
              alpaca.markets
            </a>{" "}
            and generate API keys (Paper Trading → API Keys).
          </li>
          <li>
            Copy <code>backend/.env.example</code> to <code>backend/.env</code> and fill in{" "}
            <code>APCA_API_KEY_ID</code> and <code>APCA_API_SECRET_KEY</code>.
          </li>
          <li>Restart the backend.</li>
        </ol>
        <p className="muted">
          The free plan streams the IEX exchange feed: real-time, but only IEX's trades, so prices can differ slightly
          from the consolidated price. It allows one connection and up to 30 live symbols at once. Indices,
          commodities and crypto aren't streamed. Your keys stay on the server and are never sent to the browser.
        </p>
        <h2 id="disclaimer">Disclaimer</h2>
        <p>
          Prices may be delayed and can contain errors. TickerTide is for information only and is not investment
          advice.
        </p>
      </section>
    </>
  );
}

export function NotFoundPage() {
  return (
    <section className="panel prose">
      <h1>Page not found</h1>
      <p>
        That page doesn't exist. <Link to="/">Back to the market overview</Link>.
      </p>
    </section>
  );
}
