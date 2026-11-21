import { useState } from 'react';
import { Linking, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhotoPlaceholder } from '@/components/Mark';
import { Image } from 'expo-image';
import { mediaUrl } from '@/lib/api';
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
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={c?.name} />
      <Page bar>
        <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
        {c ? (
          <>
            {/* Photos fill the full width as plain rectangles; without photos the MedicSeba mark shows. */}
            <View style={{ marginHorizontal: -18, marginTop: -70 - ins.top, height: 260 + ins.top, backgroundColor: C.tint }}>
              {c.photos.length ? (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))} scrollEventThrottle={32}>
                  {c.photos.map((p, i) => (
                    <Image key={p} source={mediaUrl(p)} style={{ width, height: 260 + ins.top }} contentFit="cover" accessibilityLabel={`${c.name} photo ${i + 1}`} />
                  ))}
                </ScrollView>
              ) : <PhotoPlaceholder style={{ flex: 1, paddingTop: ins.top }} size={64} />}
              <View style={{ position: 'absolute', left: 18, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {c.openNow !== null ? <Pill text={c.openNow ? t('openNow') : t('closed')} tone={c.openNow ? 'good' : 'warn'} /> : null}
              </View>
              {c.photos.length > 1 ? (
                <View style={{ position: 'absolute', right: 18, bottom: 18, flexDirection: 'row', gap: 5 }}>
                  {c.photos.map((p, i) => <View key={p} style={{ width: i === page ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? C.white : 'rgba(255,255,255,0.6)' }} />)}
                </View>
              ) : null}
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
