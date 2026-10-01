"use client";

/**
 * Standalone dev login (SimpleJWT). Stand-in for the host app's auth: when the
 * module is merged, the host's own login and token refresh replace this file.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AUTH = (process.env.NEXT_PUBLIC_AUTH_API ?? "").replace(/\/+$/, "");
const KEY = "sales-pipeline.dev-auth";

interface Tokens { access: string; refresh: string }
export interface Me {
  id: string; name: string; email: string; tenant_name: string | null; pipeline_role: string;
  can_write: boolean; can_admin: boolean; ai_enabled: boolean;
}

function load(): Tokens | null {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Tokens | null; } catch { return null; }
}
function save(t: Tokens | null) {
  try { if (t) window.localStorage.setItem(KEY, JSON.stringify(t)); else window.localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

export interface DevAuthValue {
  me: Me;
  getAccessToken: () => string | null;
  refresh: () => Promise<boolean>;
  logout: () => void;
}

export function DevAuth({ children }: { children: (auth: DevAuthValue) => ReactNode }) {
  const tokens = useRef<Tokens | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async (): Promise<boolean> => {
    const t = tokens.current;
    if (!t) return false;
    const r = await fetch(`${AUTH}/token/refresh/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: t.refresh }) });
    if (!r.ok) { tokens.current = null; save(null); setMe(null); return false; }
    const d = (await r.json()) as { access: string; refresh?: string };
    tokens.current = { access: d.access, refresh: d.refresh ?? t.refresh };
    save(tokens.current);
    return true;
  }, []);

  const loadMe = useCallback(async (): Promise<boolean> => {
    const get = () => fetch(`${AUTH}/me/`, { headers: { Authorization: `Bearer ${tokens.current?.access ?? ""}` } });
    let r = await get();
    if (r.status === 401 && (await refresh())) r = await get();
    if (!r.ok) return false;
    setMe((await r.json()) as Me);
    return true;
  }, [refresh]);

  useEffect(() => {
    tokens.current = load();
    (tokens.current ? loadMe() : Promise.resolve(false)).catch(() => false).finally(() => setChecking(false));
  }, [loadMe]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const r = await fetch(`${AUTH}/token/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const d = (await r.json()) as Partial<Tokens> & { detail?: string };
      if (!r.ok || !d.access || !d.refresh) { setError(d.detail ?? "Wrong email or password."); return; }
      tokens.current = { access: d.access, refresh: d.refresh };
      save(tokens.current);
      if (!(await loadMe())) setError("Signed in, but couldn't load your profile.");
    } catch {
      setError("Can't reach the server. Is the backend running on port 8010?");
    }
  };

  const getAccessToken = useCallback(() => tokens.current?.access ?? null, []);
  const logout = () => { tokens.current = null; save(null); setMe(null); };

  // Invite links: ?invite=<token> → set a password, then signed in
  const [invite, setInvite] = useState<string | null>(null);
  useEffect(() => { setInvite(new URLSearchParams(window.location.search).get("invite")); }, []);
  const onAccepted = async (t: Tokens) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState(null, "", url.toString());
    tokens.current = t;
    save(t);
    setInvite(null);
    await loadMe();
  };

  if (invite) return <AcceptInvite token={invite} onAccepted={onAccepted} onCancel={() => setInvite(null)} />;
  if (checking) return <div className="grid min-h-dvh place-items-center text-ink-2">Loading…</div>;
  if (me) return <>{children({ me, getAccessToken, refresh, logout })}</>;

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-4">
      <form onSubmit={login} className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-sh2">
        <Brand />
        <h1 className="m-0 mb-4 text-lg font-semibold">Sign in</h1>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Label htmlFor="password" className="mt-3">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="mb-0 mt-3 text-[13px] text-danger">{error}</p>}
        <Button type="submit" variant="primary" className="mt-5 w-full">Sign in</Button>
      </form>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-5 flex items-center gap-2.5">
      <span aria-hidden className="relative grid size-8 place-items-center rounded-[9px] bg-black text-[13px] font-bold text-white">
        IQ<i className="absolute right-[5px] top-1.5 size-[5px] rounded-full bg-brand" />
      </span>
      <div><b className="block text-base leading-tight">TourIQ</b><span className="text-xs text-ink-3">Sales pipeline</span></div>
    </div>
  );
}

/** "Set your password" page for invite links. */
function AcceptInvite({ token, onAccepted, onCancel }: { token: string; onAccepted: (t: Tokens) => Promise<void>; onCancel: () => void }) {
  const [who, setWho] = useState<{ email: string; name: string; tenant_name: string | null } | null>(null);
  const [bad, setBad] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${AUTH}/invite/check/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        const d = (await r.json()) as { email: string; name: string; tenant_name: string | null; detail?: string };
        if (r.ok) setWho(d); else setBad(d.detail ?? "This invite link isn't valid.");
      })
      .catch(() => setBad("Can't reach the server. Try again in a moment."));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setError("");
    setBusy(true);
    try {
      const r = await fetch(`${AUTH}/invite/accept/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const d = (await r.json()) as Partial<Tokens> & { detail?: string };
      if (!r.ok || !d.access || !d.refresh) { setError(d.detail ?? "Couldn't set the password."); return; }
      await onAccepted({ access: d.access, refresh: d.refresh });
    } catch {
      setError("Can't reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-sh2">
        <Brand />
        {bad ? (
          <>
            <h1 className="m-0 mb-2 text-lg font-semibold">Invite link not valid</h1>
            <p className="m-0 mb-4 text-ink-2">{bad}</p>
            <Button type="button" className="w-full" onClick={onCancel}>Go to sign in</Button>
          </>
        ) : !who ? (
          <p className="m-0 text-ink-2">Checking your invite…</p>
        ) : (
          <>
            <h1 className="m-0 mb-1 text-lg font-semibold">Welcome{who.name ? `, ${who.name.split(" ")[0]}` : ""}</h1>
            <p className="m-0 mb-4 text-ink-2">Set a password for {who.email}{who.tenant_name ? ` to join the ${who.tenant_name} sales pipeline` : ""}.</p>
            <input type="email" autoComplete="username" value={who.email} readOnly hidden />
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <Label htmlFor="confirm-password" className="mt-3">Type it again</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <p className="mb-0 mt-2 text-xs text-ink-3">At least 8 characters, not only numbers, and not a common password.</p>
            {error && <p role="alert" className="mb-0 mt-3 text-[13px] text-danger">{error}</p>}
            <Button type="submit" variant="primary" className="mt-5 w-full" disabled={busy}>{busy ? "Saving…" : "Set password and sign in"}</Button>
          </>
        )}
      </form>
    </div>
  );
}
