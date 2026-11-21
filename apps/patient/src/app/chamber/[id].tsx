import { Linking, View } from 'react-native';
import { openMaps } from '@/lib/maps';
import { router, useLocalSearchParams } from 'expo-router';
import { useApi } from '@/lib/query';
import { dayName, useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { ChamberDetail } from '@/lib/types';
import { Icon } from '@/components/Icon';
import { seatPill } from '@/components/cards';
import { Avatar, Button, Card, H1, Page, Pill, Status, T, TopBar } from '@/components/ui';

export default function Chamber() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<ChamberDetail>(`/chambers/${id}`);
  const c = q.data;

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={c?.name} />
      <Page bar>
        <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
        {c ? (
          <>
            <View style={{ height: 150, borderRadius: 24, backgroundColor: C.tint, padding: 16, justifyContent: 'space-between', ...S.card }}>
              <Pill text={c.openNow ? t('openNow') : t('closed')} tone={c.openNow ? 'good' : 'warn'} />
              <Icon name="store" size={52} color={C.link} width={1.6} />
            </View>
            <H1 size={30} style={{ marginTop: 14 }}>{c.name}</H1>
            <T w="light" size={15} color={C.sec} style={{ marginTop: 4 }}>{c.address}{c.landmark ? `. ${c.landmark}` : ''}</T>
            <T w="bold" size={14} style={{ marginTop: 6 }}>{t('hours')} <T numeric w="light" size={14}>{c.openingHours.replace('-', ' to ')}</T></T>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Button title={t('directions')} icon="nav" kind="secondary" style={{ flex: 1 }} onPress={() => openMaps(c.lat, c.lng, c.name)} />
              {c.phone ? <Button title={t('call')} icon="phone" kind="secondary" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}
            </View>

            <T w="heavy" size={20} style={{ marginTop: 22, letterSpacing: -0.4 }}>{t('doctors')}</T>
            <Card style={{ marginTop: 10, overflow: 'hidden' }}>
              {c.doctors.map((d, i) => {
                const today = c.today.find((s) => s.doctorId === d.id);
                return (
                  <View key={d.id + d.time} style={[{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, i < c.doctors.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
                    <Avatar name={d.name} uri={d.photoUrl} size={52} radius={16} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T w="heavy" size={16} lines={1} onPress={() => router.push(`/doctor/${d.id}`)}>{d.name}</T>
                      <T w="light" size={13} color={C.sec} lines={1}>{d.specialty.name}, {d.weekdays.map((w) => dayName(t.lang, w)).join(' ')}</T>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <T numeric w="heavy" size={14}>{d.time}</T>
                      {today ? seatPill(t, today) : null}
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}
      </Page>
    </View>
  );
}
