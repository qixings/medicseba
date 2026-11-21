import { onServerChange } from './live';
import { api, post } from './api';
import { storage } from './storage';
import { create } from './store';

export type Msg = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

/** Messages from the MedicSeba team to this chamber, cached for offline use. */
export const useInbox = create<{ list: Msg[] }>(() => ({ list: [] }));

export async function loadInbox() {
  try {
    const list = await api<Msg[]>('/agent/messages');
    useInbox.setState({ list });
    void storage.setJSON('inbox', list);
  } catch {
    const cached = await storage.getJSON<Msg[]>('inbox');
    if (cached) useInbox.setState({ list: cached });
  }
}

export async function markInboxRead() {
  useInbox.setState({ list: useInbox.getState().list.map((m) => ({ ...m, readAt: m.readAt ?? new Date().toISOString() })) });
  await post('/agent/messages/read').catch(() => {});
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startInbox() {
  void loadInbox();
  if (timer) return;
  timer = setInterval(() => { void loadInbox(); }, 5 * 60_000);
  onServerChange(['messages'], () => { void loadInbox(); });
}
