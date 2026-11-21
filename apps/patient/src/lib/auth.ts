import { api, setAuthToken, setOnUnauthorized } from './api';
import { useLang, type Lang } from './i18n';
import { storage } from './storage';
import { create } from './store';
import type { Me } from './types';
import { queryClient } from './query';
import { registerPush } from './push';

const KEY = 'auth_token';
const LANG_KEY = 'lang';

type Auth = {
  ready: boolean;
  token: string | null;
  me: Me | null;
};

export const useAuth = create<Auth>(() => ({ ready: false, token: null, me: null }));

export async function loadMe() {
  const me = await api<Me>('/me');
  useAuth.setState({ me });
  void registerPush();
  if (me.language) useLang.getState().setLang(me.language);
  return me;
}

export async function restoreSession() {
  const lang = (await storage.get(LANG_KEY)) as Lang | null;
  if (lang === 'en' || lang === 'bn') useLang.getState().setLang(lang);
  const token = await storage.get(KEY);
  if (token) {
    setAuthToken(token);
    useAuth.setState({ token });
    try { await loadMe(); } catch { /* offline: keep the token, load later */ }
  }
  useAuth.setState({ ready: true });
}

export async function signIn(token: string) {
  await storage.set(KEY, token);
  setAuthToken(token);
  useAuth.setState({ token });
  return loadMe();
}

export async function signOut() {
  await storage.remove(KEY);
  setAuthToken(null);
  queryClient.clear();
  useAuth.setState({ token: null, me: null });
}

export async function saveLang(lang: Lang) {
  useLang.getState().setLang(lang);
  await storage.set(LANG_KEY, lang);
  if (useAuth.getState().token) {
    try { await api('/me', { method: 'PATCH', body: { language: lang } }); } catch { /* saved locally */ }
  }
}

setOnUnauthorized(() => { void signOut(); });
