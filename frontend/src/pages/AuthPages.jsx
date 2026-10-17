import { useEffect, useId, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { safeNext, useAuth } from "../auth.jsx";
import { fmtDate } from "../format.js";
import { useMarket } from "../market.jsx";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** If there are errors, move focus to the first invalid field (after React re-renders). */
function focusFirstError(form, errs) {
  if (!Object.keys(errs).length) return false;
  requestAnimationFrame(() => form.querySelector('[aria-invalid="true"]')?.focus());
  return true;
}

function Field({ label, error, hint, children }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": describedBy })}
      {error ? (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-wrap">
      <input
        {...rest}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        maxLength={128}
      />
      <button
        type="button"
        className="show-pass"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function strength(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) return { level: 0, label: "Too short" };
  if (score <= 2) return { level: 1, label: "Weak" };
  if (score <= 3) return { level: 2, label: "Fair" };
  return { level: 3, label: "Strong" };
}

function StrengthMeter({ password }) {
  const s = strength(password);
  if (!s) return null;
  return (
    <div className={`strength s${s.level}`} aria-live="polite">
      <div className="strength-bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= s.level ? "on" : ""} />
        ))}
      </div>
      <span>{s.label}</span>
    </div>
  );
}

function AuthShell({ title, subtitle, children, aside }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {children}
      </div>
      {aside && <aside className="auth-aside">{aside}</aside>}
    </div>
  );
}

const PERKS = [
  ["★", "Your watchlist, on every device", "Star stocks once and see them wherever you sign in."],
  ["●", "Live prices for what you watch", "Your watchlist streams trade by trade when live data is on."],
  ["◆", "Company demographics", "Ownership, leadership and financials for every S&P 500 company."],
];

function Perks() {
  return (
    <>
      <h2>Why create an account?</h2>
      <ul className="perks">
        {PERKS.map(([icon, title, text]) => (
          <li key={title}>
            <span className="perk-icon" aria-hidden="true">
              {icon}
            </span>
            <div>
              <strong>{title}</strong>
              <p className="muted">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function useRedirectIfSignedIn() {
  const { user, ready } = useAuth();
  const [params] = useSearchParams();
  return ready && user ? safeNext(params.get("next")) : null;
}

/* ------------------------------------------------------------------ Sign in */

export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const redirect = useRedirectIfSignedIn();
  if (redirect && !busy) return <Navigate to={redirect} replace />;

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!EMAIL_RE.test(email.trim())) errs.email = "Enter the email address you signed up with.";
    if (!password) errs.password = "Enter your password.";
    setErrors(errs);
    setFormError("");
    if (focusFirstError(e.currentTarget, errs)) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password, remember);
      navigate(next, { replace: true });
    } catch (err) {
      setFormError(err.message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Welcome back to TickerTide.">
      <form onSubmit={submit} noValidate className="auth-form">
        {formError && (
          <div className="banner error" role="alert">
            {formError}
          </div>
        )}
        <Field label="Email" error={errors.email}>
          {(a) => (
            <input
              {...a}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              autoFocus
              maxLength={254}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password}>
          {(a) => <PasswordInput {...a} value={password} onChange={setPassword} autoComplete="current-password" />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in for 30 days
        </label>
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="auth-switch">
        New to TickerTide? <Link to={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
      </p>
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ Sign up */

export function SignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const redirect = useRedirectIfSignedIn();
  if (redirect && !busy) return <Navigate to={redirect} replace />;

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!name.trim()) errs.name = "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email address, like name@example.com.";
    if (password.length < 8) errs.password = "Use at least 8 characters.";
    else if (password.trim().toLowerCase() === email.trim().toLowerCase()) errs.password = "Don't use your email as your password.";
    if (confirm !== password) errs.confirm = "Passwords don't match.";
    setErrors(errs);
    setFormError("");
    if (focusFirstError(e.currentTarget, errs)) return;
    setBusy(true);
    try {
      await signUp(name.trim(), email.trim(), password, true);
      navigate(next === "/" ? "/account?welcome=1" : next, { replace: true });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Free. Takes less than a minute." aside={<Perks />}>
      <form onSubmit={submit} noValidate className="auth-form">
        {formError && (
          <div className="banner error" role="alert">
            {formError}
            {formError.includes("already exists") && (
              <>
                {" "}
                <Link to={`/signin?next=${encodeURIComponent(next)}`}>Sign in instead</Link>
              </>
            )}
          </div>
        )}
        <Field label="Name" error={errors.name}>
          {(a) => (
            <input
              {...a}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              autoFocus
              maxLength={60}
            />
          )}
        </Field>
        <Field label="Email" error={errors.email}>
          {(a) => (
            <input
              {...a}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters. A longer passphrase is stronger.">
          {(a) => <PasswordInput {...a} value={password} onChange={setPassword} autoComplete="new-password" />}
        </Field>
        <StrengthMeter password={password} />
        <Field label="Confirm password" error={errors.confirm}>
          {(a) => <PasswordInput {...a} value={confirm} onChange={setConfirm} autoComplete="new-password" />}
        </Field>
        <p className="muted small">
          By creating an account you agree that TickerTide is for information only and isn't investment advice.
        </p>
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to={`/signin${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
      </p>
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ Account */

export function AccountPage() {
  const { user, ready, signOut } = useAuth();
  const { watchlist } = useMarket();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";

  useEffect(() => {
    document.title = "Your account · TickerTide";
    return () => {
      document.title = "TickerTide — Markets & Company Demographics";
    };
  }, []);

  if (!ready) return <div className="panel loading-panel">Loading your account…</div>;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;

  return (
    <div className="account">
      {welcome && (
        <div className="banner success" role="status">
          ✓ Welcome to TickerTide, {user.name.split(" ")[0]}! Your account is ready and your watchlist is saved to it.
        </div>
      )}
      <div className="page-header">
        <div>
          <h1>Your account</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
      </div>
      <section className="panel account-card">
        <div className="avatar big" aria-hidden="true">
          {initials(user.name)}
        </div>
        <dl className="facts">
          <div className="stat">
            <dt>Name</dt>
            <dd>{user.name}</dd>
          </div>
          <div className="stat">
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="stat">
            <dt>Member since</dt>
            <dd>{fmtDate(user.created_at)}</dd>
          </div>
          <div className="stat">
            <dt>Watchlist</dt>
            <dd>
              <Link to="/watchlist">
                {watchlist.length} stock{watchlist.length === 1 ? "" : "s"}
              </Link>
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel">
        <h2>Sign out</h2>
        <p className="muted">Your watchlist stays saved to your account and is still here when you sign back in.</p>
        <button
          className="btn"
          onClick={async () => {
            await signOut();
            navigate("/", { replace: true });
          }}
        >
          Sign out
        </button>
      </section>
    </div>
  );
}

export function initials(name) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "?"
  );
}
