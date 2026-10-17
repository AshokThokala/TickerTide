import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getAccountWatchlist, putAccountWatchlist, refreshStocks } from "./api.js";
import { useAuth } from "./auth.jsx";

const WATCHLIST_KEY = "tickertide-watchlist";
const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"];

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY));
    return Array.isArray(saved) ? saved : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function saveWatchlist(symbols) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(symbols));
  } catch {
    /* storage unavailable: watchlist just won't persist */
  }
}

/** Alpaca streams US equities only: not indices (^GSPC), futures (GC=F) or crypto (BTC-USD). */
export const isStreamable = (s) => !/[\^=]/.test(s) && !s.endsWith("-USD");

/**
 * Subscribe to live trade prices for `symbols` (most important first) over Server-Sent Events.
 * Reconnects automatically (EventSource does this itself) and whenever the symbol list changes.
 */
function useLivePrices(symbols) {
  const [ticks, setTicks] = useState(() => new Map());
  const [status, setStatus] = useState({ state: "connecting", message: "", live: [], over_limit: [] });
  const key = symbols.join(",");

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setStatus({ state: "disabled", message: "This browser doesn't support live updates.", live: [], over_limit: [] });
      return undefined;
    }
    const es = new EventSource(`/api/live/stream?symbols=${encodeURIComponent(key)}`);
    es.addEventListener("status", (e) => setStatus(JSON.parse(e.data)));
    es.addEventListener("ticks", (e) => {
      const batch = JSON.parse(e.data);
      setTicks((prev) => {
        const next = new Map(prev);
        for (const t of batch) next.set(t.symbol, t);
        return next;
      });
    });
    es.onerror = () => setStatus((s) => (s.state === "disabled" ? s : { ...s, state: "reconnecting" }));
    return () => es.close();
  }, [key]);

  return { ticks, status };
}

const MarketContext = createContext(null);

export function MarketProvider({ children }) {
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);
  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const data = await refreshStocks(watchlistRef.current);
      if (id === requestId.current) setSnapshot(data);
    } catch (e) {
      if (id === requestId.current) setError(`Could not load market data. Is the backend running? (${e.message})`);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  // Pull a fresh set of data every time the site is opened.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live prices: the stock page being viewed first, then the watchlist.
  const { pathname } = useLocation();
  const viewing = pathname.startsWith("/stock/") ? decodeURIComponent(pathname.slice(7)).toUpperCase() : null;
  const liveSymbols = useMemo(
    () => [...new Set([viewing, ...watchlist].filter(Boolean))].filter(isStreamable),
    [viewing, watchlist]
  );
  const { ticks, status: liveStatus } = useLivePrices(liveSymbols);

  // Overlay live trades on the pipeline snapshot. Untouched quotes keep their identity,
  // so memoised table rows only re-render when their own price moves.
  const quotes = useMemo(() => {
    const base = snapshot?.quotes ?? [];
    if (!ticks.size) return base;
    return base.map((q) => {
      const t = ticks.get(q.symbol);
      if (!t || t.price === q.price) return q;
      const change = q.previous_close != null ? t.price - q.previous_close : q.change;
      return {
        ...q,
        price: t.price,
        change,
        change_percent: q.previous_close ? (change / q.previous_close) * 100 : q.change_percent,
        live_time: t.time,
      };
    });
  }, [snapshot, ticks]);

  const bySymbol = useMemo(() => new Map(quotes.map((q) => [q.symbol, q])), [quotes]);
  const liveSet = useMemo(() => new Set(liveStatus.live), [liveStatus]);

  // Signed in: the watchlist lives on the account. On sign-in, merge this browser's list
  // into the account's so nothing starred before signing in is lost.
  const { user } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    getAccountWatchlist()
      .then((saved) => {
        if (!live) return;
        const merged = [...new Set([...(saved ?? []), ...watchlistRef.current])];
        watchlistRef.current = merged;
        setWatchlist(merged);
        saveWatchlist(merged);
        if (!saved || merged.length !== saved.length) putAccountWatchlist(merged).catch(() => {});
        if (merged.some((s) => !bySymbolRef.current.has(s))) refresh();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [userId, refresh]);

  const bySymbolRef = useRef(bySymbol);
  bySymbolRef.current = bySymbol;

  const updateWatchlist = useCallback(
    (next) => {
      watchlistRef.current = next;
      setWatchlist(next);
      saveWatchlist(next);
      if (userId) putAccountWatchlist(next).catch(() => {});
      // Symbols outside the S&P 500 universe need a pipeline run to get data.
      if (next.some((s) => !bySymbolRef.current.has(s))) refresh();
    },
    [userId, refresh]
  );

  const toggleWatch = useCallback(
    (symbol) =>
      updateWatchlist(
        watchlistRef.current.includes(symbol)
          ? watchlistRef.current.filter((s) => s !== symbol)
          : [...watchlistRef.current, symbol]
      ),
    [updateWatchlist]
  );

  const value = {
    snapshot,
    quotes,
    bySymbol,
    loading,
    error,
    refresh,
    watchlist,
    toggleWatch,
    updateWatchlist,
    liveStatus,
    liveSet,
    ticks,
  };
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  return useContext(MarketContext);
}
