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

/** Mark one message read, or all of them when no id is given. */
export async function markInboxRead(id?: string) {
  const now = new Date().toISOString();
  useInbox.setState({ list: useInbox.getState().list.map((m) => (!id || m.id === id ? { ...m, readAt: m.readAt ?? now } : m)) });
  await post('/agent/messages/read', id ? { id } : {}).catch(() => {});
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startInbox() {
  if (timer) return;
  void loadInbox();
  timer = setInterval(() => { void loadInbox(); }, 5 * 60_000);
  onServerChange(['messages'], () => { void loadInbox(); });
}
