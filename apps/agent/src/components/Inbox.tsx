import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, post } from '@/lib/api';
import { useCounter } from '@/lib/counter';
import { useT } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { C } from '@/lib/theme';
import { Icon } from './Icon';
import { T } from './ui';

type Msg = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

/** Unread messages from the MedicSeba team, shown on top of the sittings list until the counter marks them read. */
export function Inbox() {
  const t = useT();
  const online = useCounter((s) => s.online);
  const [list, setList] = useState<Msg[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await api<Msg[]>('/agent/messages');
      setList(r);
      void storage.setJSON('inbox', r);
    } catch {
      setList((await storage.getJSON<Msg[]>('inbox')) ?? []);
    }
  }, []);
  useEffect(() => { void load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);
  useEffect(() => { if (online) void load(); }, [online, load]);
  const unread = list.filter((m) => !m.readAt);
  if (!unread.length) return null;
  return (
    <View style={{ borderRadius: 20, backgroundColor: C.night, padding: 14, gap: 10, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="bell" size={18} color={C.brand} />
        <T w="heavy" size={15} color={C.white} style={{ flex: 1 }}>{t('fromTeam')}</T>
        <T w="bold" size={14} color={C.brand} onPress={async () => { setList(list.map((m) => ({ ...m, readAt: m.readAt ?? new Date().toISOString() }))); await post('/agent/messages/read').catch(() => {}); }}>{t('markRead')}</T>
      </View>
      {unread.map((m) => (
        <View key={m.id} style={{ gap: 2 }}>
          <T w="heavy" size={16} color={C.white}>{m.title}</T>
          <T size={14} color="rgba(255,255,255,0.8)">{m.body}</T>
        </View>
      ))}
    </View>
  );
}
