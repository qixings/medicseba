import { io, type Socket } from 'socket.io-client';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/* ---------- API ---------- */

const KEY = 'medicseba_admin';
export type Role = 'OWNER' | 'MANAGER' | 'SUPPORT';
export type Admin = { id: string; username: string; name: string; role: Role };

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

let onLogout: () => void = () => {};

export async function api<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const token = localStorage.getItem(KEY);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/v1${path}`, { method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'), headers, body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  } catch { throw new ApiError(0, 'No connection to the server'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) onLogout();
  if (!res.ok) {
    const zod = data.issues?.[0];
    throw new ApiError(res.status, zod ? `${zod.path?.join('.') ?? ''}: ${zod.message}` : data.message ?? 'Something went wrong');
  }
  return data as T;
}

/* ---------- auth ---------- */

type Auth = { admin: Admin | null; login: (u: string, p: string) => Promise<void>; logout: () => void; can: (min: Role) => boolean };
const AuthCtx = createContext<Auth>(null as unknown as Auth);
const RANK: Record<Role, number> = { SUPPORT: 1, MANAGER: 2, OWNER: 3 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);
  const logout = useCallback(() => { localStorage.removeItem(KEY); setAdmin(null); }, []);
  onLogout = logout;
  useEffect(() => {
    if (!localStorage.getItem(KEY)) { setReady(true); return; }
    api<Admin>('/admin/me').then(setAdmin).catch(() => {}).finally(() => setReady(true));
  }, []);
  const login = async (username: string, password: string) => {
    const r = await api<{ token: string; admin: Admin }>('/admin/login', { body: { username, password } });
    localStorage.setItem(KEY, r.token);
    setAdmin(r.admin);
  };
  const can = (min: Role) => !!admin && RANK[admin.role] >= RANK[min];
  if (!ready) return null;
  return <AuthCtx.Provider value={{ admin, login, logout, can }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

/* ---------- data loading ---------- */

/* ---------- live updates ---------- */

type LiveFn = () => void;
const liveFns = new Set<LiveFn>();
let liveSocket: Socket | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
const fireLive = () => {
  if (liveTimer) return;
  liveTimer = setTimeout(() => { liveTimer = null; liveFns.forEach((f) => f()); }, 400);
};
/** One connection for the whole panel: any change anywhere reloads what is on screen. */
function startLive() {
  if (liveSocket) return;
  liveSocket = io({ path: '/socket.io', transports: ['websocket'] });
  let first = true;
  liveSocket.on('connect', () => { if (!first) fireLive(); first = false; });
  liveSocket.on('changed', fireLive);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fireLive(); });
}
export function useLive(fn: LiveFn, on = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on) return;
    startLive();
    const f = () => ref.current();
    liveFns.add(f);
    return () => { liveFns.delete(f); };
  }, [on]);
}

/** GET an admin path. Lists stay live; pass { live: false } where the data fills an edit form. */
export function useLoad<T>(path: string | null, opts: { live?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async (silent = false) => {
    if (!path) return;
    if (!silent) { setLoading(true); setError(null); }
    try { setData(await api<T>(path)); setError(null); } catch (e) { if (!silent) setError((e as Error).message); } finally { if (!silent) setLoading(false); }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  useLive(() => { void reload(true); }, opts.live !== false && !!path);
  return { data, error, loading, reload, setData };
}

/* ---------- toast ---------- */

const ToastCtx = createContext<(msg: string, bad?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; bad?: boolean } | null>(null);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3200); return () => clearTimeout(id); }, [t]);
  return (
    <ToastCtx.Provider value={(msg, bad) => setT({ msg, bad })}>
      {children}
      {t ? <div className={`toast ${t.bad ? 'bad' : ''}`} role="status">{t.msg}</div> : null}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Run an action with a toast for the result. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast((e as Error).message, true); return undefined; } finally { setBusy(false); }
  };
  return { run, busy };
}

/* ---------- formatting ---------- */

export const istToday = (plus = 0) => new Date(Date.now() + 330 * 60_000 + plus * 86_400_000).toISOString().slice(0, 10);
export const rupee = (n: number | null | undefined) => (n == null ? '-' : `₹${n.toLocaleString('en-IN')}`);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayName = (wd: number) => DAYS[wd];
export function prettyDate(d: string) { const x = new Date(`${d}T00:00:00Z`); return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; }
export function prettyTime(hhmm: string) { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; }
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/* ---------- small UI ---------- */

export function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'teal' | 'plain'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

const STATE_TONE: Record<string, 'good' | 'warn' | 'bad' | 'teal' | 'plain'> = {
  BOOKED: 'good', ARRIVED: 'good', SERVING: 'teal', DONE: 'teal', MISSED: 'warn', NO_SHOW: 'warn', CANCELLED: 'plain', REFUNDED: 'bad', MOVED: 'plain', EXPIRED: 'plain', HELD: 'plain',
  OPEN: 'good', CLOSED: 'warn', ENDED: 'plain', PAID: 'good', PENDING: 'warn', CREATED: 'plain', FAILED: 'bad',
};
const STATE_TEXT: Record<string, string> = {
  BOOKED: 'Booked', ARRIVED: 'Arrived', SERVING: 'With doctor', DONE: 'Seen', MISSED: 'Missed', NO_SHOW: 'Did not come', CANCELLED: 'Cancelled', REFUNDED: 'Refunded',
  MOVED: 'Moved', EXPIRED: 'Not paid', HELD: 'Paying', OPEN: 'Open', CLOSED: 'Booking stopped', ENDED: 'Ended', PAID: 'Paid', PENDING: 'To pay', CREATED: 'Started', FAILED: 'Failed',
};
export const StatePill = ({ s }: { s: string }) => <Pill tone={STATE_TONE[s] ?? 'plain'}>{STATE_TEXT[s] ?? s}</Pill>;

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-label={title}>
        <div className="top"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function Loading({ error, loading, empty }: { error?: string | null; loading?: boolean; empty?: string | false }) {
  if (error) return <div className="empty err">{error}</div>;
  if (loading) return <div className="empty">Loading</div>;
  if (empty) return <div className="empty">{empty}</div>;
  return null;
}

export function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return <label className={`f ${full ? 'full' : ''}`}>{label}{children}</label>;
}

/** Simple line icons, same set as the apps. */
const P: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  store: '<path d="M3 9 4.5 4h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M10 20v-5h4v5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.7 5.2"/>',
  steth: '<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.3 17.3 0 0 0 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: P[name] ?? '' }} />;
}

/** Password field with its label and a show/hide eye button (the button sits outside the label so screen readers name both correctly). */
export function PasswordInput({ label, value, onChange, autoComplete = 'new-password', autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoComplete?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      <span className="pw">
        <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} />
        <button type="button" className="eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          <Icon name={show ? 'eyeOff' : 'eye'} />
        </button>
      </span>
    </div>
  );
}

/* ---------- light / dark ---------- */

type Theme = 'light' | 'dark';
const THEME_KEY = 'medicseba_admin_theme';
/** Saved choice, or the computer's own setting the first time. */
function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(t: Theme) { document.documentElement.dataset.theme = t; }
applyTheme(initialTheme());
export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(initialTheme);
  return [t, (x) => { localStorage.setItem(THEME_KEY, x); applyTheme(x); setT(x); }];
}

export function Segmented<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}
