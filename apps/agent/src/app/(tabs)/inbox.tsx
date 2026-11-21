import { useEffect } from 'react';
import { RefreshControl, View } from 'react-native';
import { loadInbox, markInboxRead, useInbox } from '@/lib/inbox';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Card, H1, Page, Status, T } from '@/components/ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Inbox() {
  const t = useT();
  const list = useInbox((s) => s.list);
  useEffect(() => { if (list.some((m) => !m.readAt)) void markInboxRead(); }, [list]);
  return (
    <Page tabs refresh={<RefreshControl refreshing={false} onRefresh={() => { void loadInbox(); }} tintColor={C.deep} />} style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
      <H1 style={{ marginTop: 24 }}>{t('tabMessages')}</H1>
      <Status empty={list.length === 0 ? t('noMessages') : undefined} />
      <View style={{ marginTop: 14, gap: 10 }}>
        {list.map((m) => (
          <Card key={m.id} style={{ padding: 14, gap: 4, borderLeftWidth: m.readAt ? 1 : 4, borderLeftColor: m.readAt ? C.line : C.brand }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <T w="heavy" size={16} style={{ flex: 1 }}>{m.title}</T>
              <T size={12} color={C.faint}>{when(m.createdAt)}</T>
            </View>
            <T size={15} color={C.sec}>{m.body}</T>
          </Card>
        ))}
      </View>
    </Page>
  );
}
