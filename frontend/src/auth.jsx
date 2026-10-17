import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "./api.js";

const AuthContext = createContext(null);

/** Who is signed in. The session lives in an HttpOnly cookie; we only ever see the user record. */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (email, password, remember) => {
    const u = await api.signIn(email, password, remember);
    setUser(u);
    return u;
  }, []);

  const signUp = useCallback(async (name, email, password, remember) => {
    const u = await api.signUp(name, email, password, remember);
    setUser(u);
    return u;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      setUser(null);
    }
  }, []);

  return <AuthContext.Provider value={{ user, ready, signIn, signUp, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Only allow redirects back into this site (never to another origin). */
export function safeNext(next) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
