import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { arrow, direction, fmtDateTime, fmtNum, fmtSignedPct } from "../format.js";
import { useAuth } from "../auth.jsx";
import { useMarket } from "../market.jsx";
import { initials } from "../pages/AuthPages.jsx";

// The 11 GICS sectors, as named in the S&P 500 constituents list.
export const SECTOR_SLUGS = {
  "Communication Services": "communication-services",
  "Consumer Discretionary": "consumer-discretionary",
  "Consumer Staples": "consumer-staples",
  Energy: "energy",
  Financials: "financials",
  "Health Care": "health-care",
  Industrials: "industrials",
  "Information Technology": "information-technology",
  Materials: "materials",
  "Real Estate": "real-estate",
  Utilities: "utilities",
};

function Logo() {
  return (
    <Link to="/" className="logo" aria-label="TickerTide home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="logo-bg" />
        <path d="M5 21c3 0 4-5 7-5s4 4 7 4 4-9 8-9" className="logo-wave" />
      </svg>
      <span>
        Ticker<strong>Tide</strong>
      </span>
    </Link>
  );
}

function MenuDropdown({ label, to, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div
      className={`dropdown ${open ? "open" : ""}`}
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <NavLink to={to} className="nav-link" onFocus={() => setOpen(true)}>
        {label} <span className="caret">▾</span>
      </NavLink>
      <div className="dropdown-menu" role="menu">
        {items.map((it) => (
          <Link key={it.to} to={it.to} role="menuitem" onClick={() => setOpen(false)}>
            {it.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

const NAV = [
  {
    label: "Markets",
    to: "/",
    items: [
      { label: "Overview", to: "/" },
      { label: "All stocks", to: "/stocks" },
      { label: "Indices & commodities", to: "/stocks?view=markets" },
    ],
  },
  { label: "Watchlist", to: "/watchlist" },
  {
    label: "Movers",
    to: "/movers",
    items: [
      { label: "Top gainers", to: "/movers?tab=gainers" },
      { label: "Top losers", to: "/movers?tab=losers" },
      { label: "Most active", to: "/movers?tab=active" },
    ],
  },
  {
    label: "Sectors",
    to: "/sectors",
    items: [
      { label: "All sectors", to: "/sectors" },
      ...Object.entries(SECTOR_SLUGS).map(([name, slug]) => ({ label: name, to: `/sectors/${slug}` })),
    ],
  },
  { label: "About", to: "/about" },
];

function SearchBox({ onDone }) {
  const { quotes } = useMarket();
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    const upper = term.toUpperCase();
    const match =
      quotes.find((s) => s.symbol === upper) ||
      quotes.find((s) => s.name.toLowerCase().includes(term.toLowerCase()));
    navigate(`/stock/${encodeURIComponent(match ? match.symbol : upper)}`);
    setQ("");
    onDone?.();
  };
  return (
    <form className="search" onSubmit={submit} role="search">
      <input
        list="symbol-options"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search symbol or company"
        aria-label="Search symbol or company"
      />
      <datalist id="symbol-options">
        {quotes.map((s) => (
          <option key={s.symbol} value={s.symbol}>
            {s.name}
          </option>
        ))}
      </datalist>
    </form>
  );
}

function TickerTape() {
  const { quotes } = useMarket();
  const markets = quotes.filter((q) => q.kind === "market");
  if (!markets.length) return <div className="ticker-tape placeholder" />;
  return (
    <div className="ticker-tape" aria-label="Market indices">
      <div className="ticker-inner">
        {markets.map((q) => {
          const dir = direction(q.change);
          return (
            <Link key={q.symbol} to={`/stock/${encodeURIComponent(q.symbol)}`} className="tick">
              <span className="tick-name">{q.name}</span>
              <span>{fmtNum(q.price)}</span>
              <span className={`change ${dir}`}>
                {arrow(dir)} {fmtSignedPct(q.change_percent)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function marketOpen(quotes) {
  const spx = quotes.find((q) => q.symbol === "^GSPC") || quotes.find((q) => q.kind === "stock");
  return spx?.market_state ? spx.market_state === "REGULAR" : null;
}

/** Live-stream state: off (no keys), connecting, live, or error, with the reason on hover. */
function LivePill() {
  const { liveStatus, ticks, quotes } = useMarket();
  const { state, message, live = [], feed } = liveStatus;
  const open = marketOpen(quotes);
  let cls = "off";
  let label = "Live off";
  let title = message || "Live prices are off.";
  if (state === "connected") {
    cls = "on";
    label = `Live · ${live.length}`;
    title = `Streaming ${live.length} symbol${live.length === 1 ? "" : "s"} from Alpaca (${(feed || "iex").toUpperCase()} feed).`;
    if (!ticks.size && open === false) {
      label = "Live · market closed";
      title += " The market is closed, so no trades are coming in right now.";
    }
    if (message) title += ` ${message}`;
  } else if (state === "connecting" || state === "reconnecting") {
    cls = "wait";
    label = state === "connecting" ? "Connecting…" : "Reconnecting…";
  } else if (state === "error") {
    cls = "err";
    label = "Live error";
  }
  return (
    <Link to="/about#live" className={`live-pill ${cls}`} title={title} aria-label={`${label}. ${title}`}>
      <span className="pill-dot" aria-hidden="true" />
      <span className="pill-label">{label}</span>
    </Link>
  );
}

/** Signed out: Sign in / Sign up. Signed in: avatar with an account menu. */
function AccountMenu({ mobile = false }) {
  const { user, ready, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  if (!ready) return <span className="account-placeholder" aria-hidden="true" />;

  if (!user) {
    const onAuthPage = pathname === "/signin" || pathname === "/signup";
    const next = onAuthPage ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return (
      <div className={`auth-links ${mobile ? "mobile" : ""}`}>
        <Link to={`/signin${next}`} className="btn ghost">
          Sign in
        </Link>
        <Link to={`/signup${next}`} className="btn outline">
          Sign up
        </Link>
      </div>
    );
  }

  if (mobile) {
    return (
      <div className="mobile-account">
        <div className="mobile-account-who">
          <span className="avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span>
            <strong>{user.name}</strong>
            <span className="muted small">{user.email}</span>
          </span>
        </div>
        <Link to="/account" className="nav-link">
          Account
        </Link>
        <button
          className="nav-link as-button"
          onClick={async () => {
            await signOut();
            navigate("/");
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className={`account-menu ${open ? "open" : ""}`} ref={ref}>
      <button
        className="avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
      </button>
      {open && (
        <div className="dropdown-menu account-dropdown" role="menu">
          <div className="menu-who">
            <strong>{user.name}</strong>
            <span className="muted small">{user.email}</span>
          </div>
          <Link to="/account" role="menuitem">
            Your account
          </Link>
          <Link to="/watchlist" role="menuitem">
            Your watchlist
          </Link>
          <button
            role="menuitem"
            className="menu-button"
            onClick={async () => {
              setOpen(false);
              await signOut();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { refresh, loading, snapshot } = useMarket();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, search } = useLocation();
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, search]);

  return (
    <header className="site-header">
      <div className="topbar">
        <Logo />
        <nav className={`main-nav ${menuOpen ? "open" : ""}`} aria-label="Main">
          {NAV.map((n) =>
            n.items ? (
              <MenuDropdown key={n.label} {...n} />
            ) : (
              <NavLink key={n.label} to={n.to} className="nav-link" end>
                {n.label}
              </NavLink>
            )
          )}
          <div className="nav-search-mobile">
            <SearchBox onDone={() => setMenuOpen(false)} />
            <AccountMenu mobile />
          </div>
        </nav>
        <div className="topbar-right">
          <div className="nav-search-desktop">
            <SearchBox />
          </div>
          <LivePill />
          <button className="btn primary refresh" onClick={refresh} disabled={loading} title="Pull fresh market data now">
            <span className={`spin ${loading ? "on" : ""}`} aria-hidden="true">
              ↻
            </span>
            <span className="refresh-label">{loading ? "Refreshing…" : "Refresh"}</span>
          </button>
          <div className="account-desktop">
            <AccountMenu />
          </div>
          <button
            className="btn hamburger"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ☰
          </button>
        </div>
      </div>
      <TickerTape />
      <div className="updated-bar">
        {snapshot ? (
          <>
            Snapshot {fmtDateTime(snapshot.fetched_at)} · S&P 500 + {snapshot.quotes.filter((q) => q.kind === "market").length}{" "}
            markets ({snapshot.quotes.length} instruments) · {snapshot.source}
          </>
        ) : (
          "Loading latest market data…"
        )}
      </div>
    </header>
  );
}

export function Footer() {
  const { user } = useAuth();
  return (
    <footer className="site-footer">
      <div className="footer-cols">
        <div>
          <div className="footer-brand">
            Ticker<strong>Tide</strong>
          </div>
          <p className="muted">Market data, sector trends and company demographics in one place.</p>
        </div>
        <div>
          <h4>Markets</h4>
          <Link to="/">Overview</Link>
          <Link to="/stocks">All stocks</Link>
          <Link to="/movers">Movers</Link>
          <Link to="/sectors">Sectors</Link>
        </div>
        <div>
          <h4>Your tools</h4>
          <Link to="/watchlist">Watchlist</Link>
          {user ? (
            <Link to="/account">Your account</Link>
          ) : (
            <>
              <Link to="/signin">Sign in</Link>
              <Link to="/signup">Create an account</Link>
            </>
          )}
          <Link to="/stocks?view=markets">Indices & commodities</Link>
        </div>
        <div>
          <h4>TickerTide</h4>
          <Link to="/about">About & data sources</Link>
          <Link to="/about#disclaimer">Disclaimer</Link>
        </div>
      </div>
      <p className="muted small fineprint">
        © {new Date().getFullYear()} TickerTide. Data from public Yahoo Finance endpoints; quotes may be delayed. Not
        investment advice.
      </p>
    </footer>
  );
}
