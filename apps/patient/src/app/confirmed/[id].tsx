import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useApi } from '@/lib/query';
import { shortDate, useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { Booking, Live } from '@/lib/types';
import { Icon } from '@/components/Icon';
import { Button, Card, Page, Status, T, rupee } from '@/components/ui';

export default function Confirmed() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<Live>(`/bookings/${id}/live`);
  const list = useApi<Booking[]>('/bookings?scope=upcoming');
  const paid = list.data?.find((b) => b.id === id);
  const l = q.data;

  return (
    <Page style={{ paddingTop: 70 }}>
      <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
      {l ? (
        <>
          <Animated.View entering={ZoomIn.springify().damping(14)} style={{ alignSelf: 'center', width: 64, height: 64, borderRadius: 32, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', ...S.btn }}>
            <Icon name="check" size={32} color={C.white} width={3.2} />
          </Animated.View>
          <T w="black" size={30} style={{ textAlign: 'center', marginTop: 14, letterSpacing: -0.8 }}>{t('confirmed')}</T>
          <T w="light" size={16} color={C.sec} style={{ textAlign: 'center', marginTop: 4 }}>{t('confirmedSub')}</T>

          <Animated.View entering={FadeInDown.delay(150).duration(400)} style={{ marginTop: 20, borderRadius: 28, backgroundColor: C.night, padding: 20, ...S.up }}>
            <T w="bold" size={13} color="rgba(255,255,255,0.7)">{t('token')}</T>
            <T numeric w="black" size={96} color={C.white} style={{ lineHeight: 96, letterSpacing: -4 }}>{l.token.number}</T>
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 14 }} />
            <T w="heavy" size={18} color={C.white}>{l.doctor.name}</T>
            <T w="medium" size={14} color="rgba(255,255,255,0.75)">{l.chamber.name}, {l.chamber.area}</T>
            <T numeric w="heavy" size={16} color={C.brand} style={{ marginTop: 8 }}>{shortDate(t.lang, l.session.date)}, {l.session.time}</T>
            <T w="medium" size={14} color="rgba(255,255,255,0.75)" style={{ marginTop: 2 }}>{l.token.patientName}</T>
          </Animated.View>

          <Card style={{ marginTop: 12, padding: 14, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="receipt" size={18} color={C.link} />
              <T w="heavy" size={15}>{t('receipt')}</T>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T size={14} color={C.sec}>{t('total')}</T>
              <T numeric w="heavy" size={14}>{paid?.amount != null ? rupee(paid.amount) : '-'}</T>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T size={14} color={C.sec}>ID</T>
              <T numeric size={12} color={C.sec}>{l.token.id.slice(0, 13).toUpperCase()}</T>
            </View>
          </Card>

          <View style={{ marginTop: 18, gap: 10 }}>
            <Button title={t('trackLive')} onPress={() => router.replace(`/live/${l.token.id}`)} />
            <Button title={t('backHome')} kind="secondary" onPress={() => router.replace('/')} />
          </View>
        </>
      ) : null}
    </Page>
  );
}
