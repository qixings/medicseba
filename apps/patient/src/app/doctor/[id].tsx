import { View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useApi } from '@/lib/query';
import { mediaUrl } from '@/lib/api';
import { dayName, parts, useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { DoctorDetail } from '@/lib/types';
import { Icon } from '@/components/Icon';
import { seatPill } from '@/components/cards';
import { BottomBar, Button, Card, Page, Status, T, TopBar, initials, rupee } from '@/components/ui';

export default function Doctor() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<DoctorDetail>(`/doctors/${id}`);
  const d = q.data;
  const next = d?.week.find((s) => s.bookable);

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={d?.name} />
      <Page bar style={{ paddingBottom: 120 }}>
        <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
        {d ? (
          <>
            {/* Big cutout photo on a teal stage, details below. */}
            <View style={{ height: 260, borderRadius: 28, backgroundColor: C.deep, overflow: 'hidden', justifyContent: 'flex-end', ...S.up }}>
              <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 150, right: -60, top: -40, backgroundColor: C.brand }} />
              {d.photoUrl
                ? <Image source={mediaUrl(d.photoUrl)} style={{ position: 'absolute', right: -6, bottom: 0, width: 200, height: 250 }} contentFit="contain" contentPosition="bottom" accessibilityLabel={d.name} />
                : <T w="black" size={120} color="rgba(255,255,255,0.28)" style={{ position: 'absolute', right: 16, top: 6, lineHeight: 130 }}>{initials(d.name)}</T>}
              <View style={{ padding: 18, maxWidth: '62%' }}>
                <T w="bold" size={13} color="rgba(255,255,255,0.85)">{d.specialty.name}</T>
                <T w="black" size={30} color={C.white} style={{ letterSpacing: -0.9, lineHeight: 32 }}>{d.name}</T>
                <T w="medium" size={13} color="rgba(255,255,255,0.85)" style={{ marginTop: 4 }}>{d.degrees}</T>
              </View>
            </View>

            <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
              {[
                [`${d.experienceYears} ${t('yrs')}`, t('experience')],
                [d.rating ? String(d.rating) : t('newDoctor'), d.rating ? `${d.ratingCount} ${t('rating').toLowerCase()}` : t('rating')],
                [d.languages.join(', ') || '-', t('languages')],
              ].map(([a, b], i) => (
                <Card key={b} style={{ flex: i === 2 ? 1.3 : 1, padding: 12, paddingVertical: 10, justifyContent: 'space-between' }}>
                  {/* Languages are words, so they get a smaller size than the numbers. */}
                  <T numeric w="black" size={i === 2 ? 15 : 22} lines={2} style={{ letterSpacing: i === 2 ? -0.2 : -0.5 }}>{a}</T>
                  <T w="medium" size={12} color={C.sec} lines={1}>{b}</T>
                </Card>
              ))}
            </View>

            {d.bio ? <T w="light" size={15} color={C.sec} style={{ marginTop: 14, lineHeight: 22 }}>{d.bio}</T> : null}

            <T w="heavy" size={20} style={{ marginTop: 22, letterSpacing: -0.4 }}>{t('sittings')}</T>
            <Card style={{ marginTop: 10, overflow: 'hidden' }}>
              {d.chambers.map((c, i) => (
                <View key={c.id + c.time} style={[{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, i < d.chambers.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="store" size={20} color={C.link} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T w="heavy" size={15} onPress={() => router.push(`/chamber/${c.id}`)}>{c.name}</T>
                    <T w="light" size={13} color={C.sec}>{c.weekdays.map((w) => dayName(t.lang, w)).join(', ')}</T>
                  </View>
                  <T numeric w="heavy" size={14}>{c.time}</T>
                </View>
              ))}
            </Card>

            <View style={{ marginTop: 12, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {d.week.slice(0, 6).map((s) => {
                const p = parts(s.date);
                return (
                  <Card key={s.id} onPress={s.bookable ? () => router.push({ pathname: '/book/[doctorId]', params: { doctorId: d.id, sessionId: s.id } }) : undefined}
                    style={{ width: '31.6%', padding: 10, gap: 4, opacity: s.bookable ? 1 : 0.6 }}>
                    <T w="bold" size={12} color={C.sec}>{dayName(t.lang, p.wd)} {p.d}</T>
                    <T numeric w="heavy" size={15}>{s.time}</T>
                    {seatPill(t, s)}
                  </Card>
                );
              })}
            </View>
          </>
        ) : null}
      </Page>
      {d ? (
        <BottomBar>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View>
              <T numeric w="black" size={24}>{rupee(d.chambers[0]?.total ?? 65)}</T>
              <T w="medium" size={12} color={C.sec}>{t('bookingFee').split(' (')[0]}</T>
            </View>
            <Button title={t('bookToken')} style={{ flex: 1 }} disabled={!next}
              onPress={() => router.push({ pathname: '/book/[doctorId]', params: { doctorId: d.id, ...(next ? { sessionId: next.id } : {}) } })} />
          </View>
        </BottomBar>
      ) : null}
    </View>
  );
}
