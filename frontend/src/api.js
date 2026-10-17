async function request(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail;
      // FastAPI validation errors arrive as a list of {msg} objects
      if (Array.isArray(detail)) detail = detail.map((d) => d.msg.replace(/^Value error, /, "")).join(" ");
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

/** Run the backend pipeline now (default universe + extra symbols) and get the fresh snapshot. */
export function refreshStocks(extraSymbols) {
  return request("/api/refresh", {
    method: "POST",
    body: JSON.stringify({ symbols: extraSymbols }),
  });
}

export function getUniverse() {
  return request("/api/universe");
}

export function getProfile(symbol, force = false) {
  return request(`/api/stocks/${encodeURIComponent(symbol)}/profile${force ? "?refresh=true" : ""}`);
}

export function getHistory(symbol, range) {
  return request(`/api/stocks/${encodeURIComponent(symbol)}/history?range=${range}`).then((d) => d.history);
}

// ---------------------------------------------------------------- accounts

export const getMe = () => request("/api/auth/me").then((d) => d.user);

export const signUp = (name, email, password, remember) =>
  request("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password, remember }) }).then(
    (d) => d.user
  );

export const signIn = (email, password, remember) =>
  request("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password, remember }) }).then(
    (d) => d.user
  );

export const signOut = () => request("/api/auth/signout", { method: "POST" });

export const getAccountWatchlist = () => request("/api/me/watchlist").then((d) => d.symbols);

export const putAccountWatchlist = (symbols) =>
  request("/api/me/watchlist", { method: "PUT", body: JSON.stringify({ symbols }) }).then((d) => d.symbols);
