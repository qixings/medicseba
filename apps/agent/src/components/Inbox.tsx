import { useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { markInboxRead, useInbox } from '@/lib/inbox';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Icon } from './Icon';
import { T } from './ui';

/** Unread messages from the MedicSeba team, on top of today's sittings until the counter taps Got it. */
export function Inbox() {
  const t = useT();
  const list = useInbox((s) => s.list);
  const unread = useMemo(() => list.filter((m) => !m.readAt), [list]);
  if (!unread.length) return null;
  const m = unread[0];
  return (
    <View style={{ borderRadius: 20, backgroundColor: C.night, padding: 14, gap: 8, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="bell" size={18} color={C.brand} />
        <T w="heavy" size={15} color={C.white} style={{ flex: 1 }}>{t('fromTeam')}{unread.length > 1 ? ` (${unread.length})` : ''}</T>
        <T w="bold" size={14} color={C.brand} onPress={() => void markInboxRead()}>{t('markRead')}</T>
      </View>
      <T w="heavy" size={16} color={C.white}>{m.title}</T>
      <T size={14} color="rgba(255,255,255,0.8)" lines={3}>{m.body}</T>
      {unread.length > 1 ? <T w="bold" size={14} color={C.brand} onPress={() => router.push('/inbox')}>{t('tabMessages')}</T> : null}
    </View>
  );
}
