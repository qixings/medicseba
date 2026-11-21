import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { post } from '@/lib/api';
import { invalidate, useApi } from '@/lib/query';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Note } from '@/lib/types';
import { Icon, type IconName } from '@/components/Icon';
import { Card, Page, Status, T, TopBar } from '@/components/ui';

const ICON: Record<string, IconName> = { booked: 'check', arrived: 'steth', late: 'clock', not_coming: 'alert', refunded: 'refund', moved: 'move', ahead5: 'bell', ahead2: 'bell', broadcast: 'bell', ended: 'alert', requeued: 'clock', missed: 'alert', receipt: 'receipt' };

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

export default function Notifications() {
  const t = useT();
  const q = useApi<Note[]>('/me/notifications');
  useEffect(() => {
    if (q.data?.some((n) => !n.read)) void post('/me/notifications/read').then(() => invalidate('/me/notifications'));
  }, [q.data]);

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={t('notifications')} />
      <Page bar>
        <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} empty={q.data?.length === 0 ? t('noNotes') : undefined} />
        {q.data?.length ? (
          <Card style={{ overflow: 'hidden' }}>
            {q.data.map((n, i) => {
              const bad = ['not_coming', 'ended', 'missed'].includes(n.kind);
              const tokenId = typeof n.data.tokenId === 'string' ? n.data.tokenId : null;
              return (
                <View key={n.id} style={[{ padding: 12, flexDirection: 'row', gap: 12 }, i < q.data!.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }, !n.read && { backgroundColor: '#F2FCFC' }]}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: bad ? C.badBg : C.tint, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={ICON[n.kind] ?? 'bell'} size={19} color={bad ? C.bad : C.link} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                      <T w="heavy" size={15} style={{ flex: 1 }} onPress={tokenId ? () => router.push(n.kind === 'not_coming' || n.kind === 'ended' ? `/absent/${tokenId}` : `/live/${tokenId}`) : undefined}>{n.title}</T>
                      <T size={12} color={C.faint}>{ago(n.createdAt)}</T>
                    </View>
                    <T w="light" size={14} color={C.sec}>{n.body}</T>
                  </View>
                </View>
              );
            })}
          </Card>
        ) : null}
      </Page>
    </View>
  );
}
