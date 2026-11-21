import { RefreshControl, View } from 'react-native';
import { loadInbox, markInboxRead, useInbox } from '@/lib/inbox';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Card, H1, Page, Status, T } from '@/components/ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Inbox() {
  const t = useT();
  const list = useInbox((s) => s.list);
  // Opening this tab does not mark anything read: staff tap Got it on each message they have seen.
  const unread = list.filter((m) => !m.readAt).length;
  return (
    <Page tabs refresh={<RefreshControl refreshing={false} onRefresh={() => { void loadInbox(); }} tintColor={C.deep} />} style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
      <View style={{ marginTop: 24, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <H1>{t('tabMessages')}</H1>
        {unread > 1 ? <T w="bold" size={14} color={C.link} onPress={() => void markInboxRead()} style={{ paddingBottom: 6 }}>{t('markAllRead')}</T> : null}
      </View>
      <Status empty={list.length === 0 ? t('noMessages') : undefined} />
      <View style={{ marginTop: 14, gap: 10 }}>
        {list.map((m) => (
          <Card key={m.id} style={{ padding: 14, gap: 4, borderLeftWidth: m.readAt ? 1 : 4, borderLeftColor: m.readAt ? C.line : C.brand }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <T w="heavy" size={16} style={{ flex: 1 }}>{m.title}</T>
              <T size={12} color={C.faint}>{when(m.createdAt)}</T>
            </View>
            <T size={15} color={C.sec}>{m.body}</T>
            {!m.readAt ? <T w="bold" size={14} color={C.link} onPress={() => void markInboxRead(m.id)} style={{ marginTop: 6 }}>{t('markRead')}</T> : null}
          </Card>
        ))}
      </View>
    </Page>
  );
}
