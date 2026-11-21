import { api, post, setAuthToken, setOnUnauthorized } from './api';
import { clearCounter, loadCounter, startSyncLoop } from './counter';
import { loadLang } from './i18n';
import { storage } from './storage';
import { create } from './store';

export type Chamber = { id: string; name: string; area: string };

export const useAuth = create<{ ready: boolean; token: string | null; chamber: Chamber | null }>(() => ({ ready: false, token: null, chamber: null }));

export async function restore() {
  await Promise.all([loadLang(), loadCounter()]);
  const token = await storage.get('agent_token');
  const chamber = await storage.getJSON<Chamber>('agent_chamber');
  if (token) {
    setAuthToken(token);
    useAuth.setState({ token, chamber });
    startSyncLoop();
    // Refresh the chamber name when online; offline the saved one is used.
    api<{ chamber: Chamber; token?: string }>('/agent/me').then(async (r) => {
      useAuth.setState({ chamber: r.chamber });
      void storage.setJSON('agent_chamber', r.chamber);
      // Fresh login from the server when ours is older than a week, so the counter stays signed in.
      if (r.token) { await storage.set('agent_token', r.token); setAuthToken(r.token); useAuth.setState({ token: r.token }); }
    }).catch(() => {});
  }
  useAuth.setState({ ready: true });
}

export async function signIn(username: string, password: string) {
  const r = await post<{ token: string; chamber: Chamber }>('/agent/login', { username, password });
  await storage.set('agent_token', r.token);
  await storage.setJSON('agent_chamber', r.chamber);
  setAuthToken(r.token);
  useAuth.setState({ token: r.token, chamber: r.chamber });
  startSyncLoop();
}

export async function signOut() {
  await Promise.all([storage.remove('agent_token'), storage.remove('agent_chamber'), clearCounter()]);
  setAuthToken(null);
  useAuth.setState({ token: null, chamber: null });
}

setOnUnauthorized(() => { void signOut(); });
