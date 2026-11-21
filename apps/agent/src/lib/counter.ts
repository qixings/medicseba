/**
 * Offline-first counter engine.
 *
 * Every action is applied to the local copy of the board at once, saved to the device, and put in an
 * outbox. The outbox is sent to the server in order whenever there is a connection. After each send the
 * board is reloaded from the server, which is always the final word. Each action is safe to send twice:
 * walk-ins carry a client reference, "next" carries the serving number it expects.
 */
import { api, ApiError, post } from './api';
import { storage } from './storage';
import { create } from './store';

export type DoctorStatus = 'ON_TIME' | 'LATE' | 'ARRIVED' | 'BREAK' | 'NOT_COMING' | 'ENDED';
export type TokenState = 'HELD' | 'BOOKED' | 'ARRIVED' | 'SERVING' | 'DONE' | 'MISSED' | 'NO_SHOW' | 'CANCELLED' | 'REFUNDED' | 'MOVED' | 'EXPIRED';

export type SessionRow = {
  id: string; date: string; time: string; startTime: string; startsAt: string;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'ENDED'; doctorStatus: DoctorStatus; lateMinutes: number;
  tokenLimit: number; onlineLimit: number; onlineTaken: number; counterTaken: number; servingNumber: number; nextNumber: number;
  doctor: { id: string; name: string; photoUrl: string | null; specialty: string | null };
};

export type TokenRow = {
  id: string; number: number | null; source: 'ONLINE' | 'WALKIN'; state: TokenState;
  patientName: string; patientAge: number | null; patientGender: 'MALE' | 'FEMALE' | 'OTHER' | null; phone: string | null;
  clientRef: string | null;
  queuePos: number | null;
  missCount: number;
  paidAmount: number | null;
  paidMethod: 'CASH' | 'UPI' | null;
  createdAt?: string;
  /** Local only: created offline, not on the server yet. */
  pending?: boolean;
};

export type Board = { session: SessionRow; tokens: TokenRow[]; at: string };

export type Action =
  | { kind: 'walkin'; body: { name: string; age?: number; gender?: 'MALE' | 'FEMALE' | 'OTHER'; phone?: string; clientRef: string; paidAmount?: number; paidMethod?: 'CASH' | 'UPI' } }
  | { kind: 'next'; body: { expect: number; current: 'DONE' | 'MISSED' } }
  | { kind: 'token'; tokenId: string; action: 'arrived' | 'missed' | 'done' | 'call' | 'restore' }
  | { kind: 'status'; body: { status: DoctorStatus; lateMinutes?: number } }
  | { kind: 'close' }
  | { kind: 'reopen' }
  | { kind: 'resume' };

export type Queued = { id: string; sessionId: string; at: string; action: Action; error?: string };

export type NewBooking = { id: string; sessionId: string; number: number | null; name: string; at: number };

type State = {
  /** Online bookings that arrived while the counter was watching, until tapped away. */
  newBookings: NewBooking[];
  online: boolean;
  syncing: boolean;
  boards: Record<string, Board>;
  outbox: Queued[];
  failed: Queued[];
};

export const useCounter = create<State>(() => ({ newBookings: [], online: true, syncing: false, boards: {}, outbox: [], failed: [] }));

const K = { boards: 'boards', outbox: 'outbox' };
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const WAITING: TokenState[] = ['BOOKED', 'ARRIVED'];

export async function loadCounter() {
  const [boards, outbox] = await Promise.all([storage.getJSON<Record<string, Board>>(K.boards), storage.getJSON<Queued[]>(K.outbox)]);
  useCounter.setState({ boards: boards ?? {}, outbox: outbox ?? [] });
}

function persist() {
  const { boards, outbox } = useCounter.getState();
  void storage.setJSON(K.boards, boards);
  void storage.setJSON(K.outbox, outbox);
}

function setBoard(id: string, b: Board) {
  useCounter.setState({ boards: { ...useCounter.getState().boards, [id]: b } });
  persist();
}

/** Apply an action to a board copy, the way the server will. */
export function applyLocal(b: Board, a: Action): Board {
  const s = { ...b.session };
  let tokens = b.tokens.map((t) => ({ ...t }));
  const endPos = () => Math.max(0, ...tokens.map((t) => t.queuePos ?? 0)) + 1;
  const serveFirst = () => {
    const n = tokens.filter((t) => t.number !== null && WAITING.includes(t.state)).sort((x, y) => (x.queuePos ?? 0) - (y.queuePos ?? 0))[0];
    if (n) {
      n.state = 'SERVING';
      s.servingNumber = n.number!;
      if (s.doctorStatus === 'ON_TIME' || s.doctorStatus === 'LATE') s.doctorStatus = 'ARRIVED';
    } else s.servingNumber = 0;
  };
  const notThere = (t: TokenRow) => {
    if (t.missCount === 0) { t.state = 'BOOKED'; t.missCount = 1; t.queuePos = endPos(); }
    else { t.state = 'MISSED'; t.missCount += 1; }
  };
  switch (a.kind) {
    case 'walkin':
      tokens.push({ id: `local-${a.body.clientRef}`, number: null, source: 'WALKIN', state: 'ARRIVED', patientName: a.body.name, patientAge: a.body.age ?? null, patientGender: a.body.gender ?? null, phone: a.body.phone ?? null, clientRef: a.body.clientRef, queuePos: endPos(), missCount: 0, paidAmount: a.body.paidAmount ?? null, paidMethod: a.body.paidMethod ?? null, pending: true });
      s.counterTaken += 1;
      break;
    case 'next': {
      if (s.servingNumber !== a.body.expect || s.status === 'ENDED' || s.status === 'CANCELLED') break;
      const cur = tokens.find((t) => t.state === 'SERVING');
      if (cur) { if (a.body.current === 'MISSED') notThere(cur); else cur.state = 'DONE'; }
      serveFirst();
      break;
    }
    case 'token': {
      const t = tokens.find((x) => x.id === a.tokenId);
      if (!t) break;
      if (a.action === 'arrived' && t.state === 'BOOKED') t.state = 'ARRIVED';
      if (a.action === 'missed' && ['BOOKED', 'ARRIVED', 'SERVING'].includes(t.state)) { if (t.state === 'SERVING') s.servingNumber = 0; notThere(t); }
      if (a.action === 'restore' && t.state === 'MISSED') { t.state = 'ARRIVED'; t.queuePos = endPos(); }
      if (a.action === 'done' && t.state === 'SERVING') { t.state = 'DONE'; s.servingNumber = 0; }
      if (a.action === 'call' && ['BOOKED', 'ARRIVED', 'MISSED'].includes(t.state)) {
        tokens.filter((x) => x.state === 'SERVING').forEach((x) => { x.state = 'DONE'; });
        t.state = 'SERVING';
        s.servingNumber = t.number ?? 0;
      }
      break;
    }
    case 'status':
      if (a.body.status === 'ENDED') {
        s.status = 'ENDED'; s.doctorStatus = 'ENDED'; s.servingNumber = 0;
        tokens.forEach((t) => {
          if (t.state === 'SERVING') t.state = 'DONE';
          else if (t.state === 'MISSED') t.state = 'NO_SHOW';
          else if (WAITING.includes(t.state) && t.source === 'WALKIN') t.state = 'NO_SHOW';
        });
        break;
      }
      s.doctorStatus = a.body.status;
      s.lateMinutes = a.body.status === 'LATE' ? a.body.lateMinutes ?? 0 : 0;
      if (a.body.status === 'NOT_COMING') s.status = 'CANCELLED';
      break;
    case 'resume':
      if (s.status === 'ENDED') {
        s.status = 'OPEN'; s.doctorStatus = 'ARRIVED';
        tokens.forEach((t) => { if (t.state === 'NO_SHOW') t.state = t.missCount > 0 ? 'MISSED' : 'ARRIVED'; });
      }
      break;
    case 'close':
      if (s.status === 'OPEN') s.status = 'CLOSED';
      break;
    case 'reopen':
      if (s.status === 'CLOSED') s.status = 'OPEN';
      break;
  }
  tokens = tokens.sort((x, y) => (x.queuePos ?? 1e9) - (y.queuePos ?? 1e9));
  return { ...b, session: s, tokens };
}

/** Do something at the counter. Works with or without internet. */
export function act(sessionId: string, action: Action) {
  const st = useCounter.getState();
  const b = st.boards[sessionId];
  if (b) setBoard(sessionId, applyLocal(b, action));
  useCounter.setState({ outbox: [...useCounter.getState().outbox, { id: uid(), sessionId, at: new Date().toISOString(), action }] });
  persist();
  void flush();
}

export const newClientRef = () => `w-${uid()}`;

function send(q: Queued) {
  const base = `/agent/sessions/${q.sessionId}`;
  const a = q.action;
  switch (a.kind) {
    case 'walkin': return post(`${base}/walkin`, a.body);
    case 'next': return post(`${base}/next`, a.body);
    case 'token': return post(`/agent/tokens/${a.tokenId}/${a.action}`);
    case 'status': return post(`${base}/status`, a.body);
    case 'close': return post(`${base}/close`);
    case 'reopen': return post(`${base}/reopen`);
    case 'resume': return post(`${base}/resume`);
  }
}

let flushing = false;
/** Send the outbox in order. Stops at the first connection problem and tries again later. */
export async function flush() {
  if (flushing) return;
  flushing = true;
  const touched = new Set<string>();
  try {
    while (useCounter.getState().outbox.length) {
      const [q] = useCounter.getState().outbox;
      useCounter.setState({ syncing: true });
      try {
        await send(q);
        useCounter.setState({ online: true });
      } catch (e) {
        const err = e as ApiError;
        if (err instanceof ApiError && err.retryable) { useCounter.setState({ online: false }); break; }
        // The server said no (for example the sitting is full). Keep it visible, do not retry.
        useCounter.setState({ failed: [...useCounter.getState().failed, { ...q, error: err.message }] });
      }
      touched.add(q.sessionId);
      useCounter.setState({ outbox: useCounter.getState().outbox.filter((x) => x.id !== q.id) });
      persist();
    }
  } finally {
    flushing = false;
    useCounter.setState({ syncing: false });
  }
  await Promise.all([...touched].map((id) => refreshBoard(id)));
}

/** Load a board from the server, then replay anything not sent yet on top of it. */
export async function refreshBoard(sessionId: string) {
  try {
    const fresh = await api<Board>(`/agent/sessions/${sessionId}/board`);
    useCounter.setState({ online: true });
    // Online bookings that were not on the board before: alert the counter.
    const before = useCounter.getState().boards[sessionId];
    if (before) {
      const known = new Set(before.tokens.map((t) => t.id));
      const fresh_ = fresh.tokens.filter((t) => t.source === 'ONLINE' && !known.has(t.id));
      if (fresh_.length) {
        useCounter.setState({ newBookings: [...useCounter.getState().newBookings, ...fresh_.map((t) => ({ id: t.id, sessionId, number: t.number, name: t.patientName, at: Date.now() }))] });
        ding();
      }
    }
    const waiting = useCounter.getState().outbox.filter((q) => q.sessionId === sessionId);
    setBoard(sessionId, waiting.reduce((b, q) => applyLocal(b, q.action), fresh));
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.retryable) useCounter.setState({ online: false });
    return false;
  }
}

export function dismissFailed(id: string) {
  useCounter.setState({ failed: useCounter.getState().failed.filter((f) => f.id !== id) });
}

export async function clearCounter() {
  useCounter.setState({ boards: {}, outbox: [], failed: [] });
  await Promise.all([storage.remove(K.boards), storage.remove(K.outbox)]);
}

/** Check the connection every few seconds while offline, and send waiting actions when it is back. */
let timer: ReturnType<typeof setInterval> | null = null;
export function startSyncLoop() {
  if (timer) return;
  timer = setInterval(async () => {
    const { online, outbox } = useCounter.getState();
    if (online && !outbox.length) return;
    try {
      await api('/agent/me', { timeoutMs: 5000 });
      useCounter.setState({ online: true });
      await flush();
    } catch (e) {
      if (e instanceof ApiError && e.retryable) useCounter.setState({ online: false });
    }
  }, 5000);
}

/** Wait (up to a few seconds) for the server number of a walk-in. Null means it is still waiting to send. */
export function waitForNumber(sessionId: string, clientRef: string, ms = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const t = useCounter.getState().boards[sessionId]?.tokens.find((x) => x.clientRef === clientRef);
      if (t?.number != null) return resolve(t.number);
      if (Date.now() - started > ms || !useCounter.getState().online) return resolve(null);
      setTimeout(check, 250);
    };
    check();
  });
}

export function dismissNewBookings(sessionId?: string) {
  useCounter.setState({ newBookings: sessionId ? useCounter.getState().newBookings.filter((n) => n.sessionId !== sessionId) : [] });
}

/** A short two-note chime (web) or a vibration (phone app) for a new online booking. */
function ding() {
  try {
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (AC) {
      const ctx = new AC();
      [880, 1320].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.3);
        o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * 0.16); o.stop(ctx.currentTime + i * 0.16 + 0.32);
      });
      return;
    }
  } catch { /* no sound available */ }
  void import('expo-haptics').then((h) => h.notificationAsync(h.NotificationFeedbackType.Success)).catch(() => {});
}
