import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { post, type ApiError } from '@/lib/api';
import { invalidate, useApi } from '@/lib/query';
import { useWatchSession } from '@/lib/live';
import { openMaps } from '@/lib/maps';
import { useStatusBarColor } from '@/lib/statusbar';
import { shortDate, useT } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import type { Live as LiveData } from '@/lib/types';
import { useDoctorStatus } from '@/components/cards';
import { Icon } from '@/components/Icon';
import { Avatar, Button, Card, Page, RoundButton, Status, T } from '@/components/ui';

function confirmAsk(msg: string, yes: string, no: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(msg) ?? false);
  return new Promise((res) => Alert.alert('', msg, [{ text: no, style: 'cancel', onPress: () => res(false) }, { text: yes, style: 'destructive', onPress: () => res(true) }]));
}

export default function Live() {
  const t = useT();
  const ins = useSafeAreaInsets();
  const status = useDoctorStatus();
  useStatusBarColor(C.deep);
  const { id } = useLocalSearchParams<{ id: string }>();
  // The socket pushes changes; the 30 s poll is a backup for weak networks.
  const q = useApi<LiveData>(`/bookings/${id}/live`, { refetchInterval: 30_000 });
  useWatchSession(q.data?.session.id);
  const [busy, setBusy] = useState(false);
  const l = q.data;

  if (!l) return <View style={{ flex: 1, backgroundColor: C.deep }}><Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} /></View>;

  const active = ['BOOKED', 'ARRIVED', 'SERVING'].includes(l.token.state);
  const notComing = l.session.doctorStatus === 'NOT_COMING';
  const turn = active && (l.token.state === 'SERVING' || (l.token.number != null && l.session.servingNumber === l.token.number));
  const total = Math.max(l.session.totalTokens, l.token.number ?? 0, 1);
  const progress = Math.min(1, l.session.servingNumber / (l.token.number ?? total));

  async function cancel() {
    if (!(await confirmAsk(t('cancelAsk'), t('cancelYes'), t('keep')))) return;
    setBusy(true);
    try { await post(`/bookings/${id}/cancel`); void invalidate('/bookings'); void invalidate('/home'); router.replace('/bookings'); }
    catch (e) { Alert.alert('', (e as ApiError).message); } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Teal stage with the big number */}
      <View style={{ backgroundColor: C.deep, paddingTop: ins.top + 6, paddingHorizontal: 18, paddingBottom: 22, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, ...S.up }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <RoundButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)' }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.white }} />
            <T w="heavy" size={12} color={C.white}>{t('live')}</T>
          </View>
        </View>
        <T w="bold" size={14} color="rgba(255,255,255,0.85)" style={{ marginTop: 14 }}>{t('token')}, {l.token.patientName}</T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
          <T numeric w="black" size={110} color={C.white} style={{ lineHeight: 108, letterSpacing: -5 }}>{l.token.number ?? '-'}</T>
          <View style={{ paddingBottom: 12, flex: 1 }}>
            {active && !notComing ? (
              turn || l.ahead === 0 ? <T w="black" size={26} color={C.white} style={{ letterSpacing: -0.6 }}>{turn ? t('turnNow') : t('nextUp')}</T> : (
                <>
                  <T numeric w="black" size={40} color={C.night} style={{ lineHeight: 42, letterSpacing: -1.2 }}>{l.ahead}</T>
                  <T w="bold" size={15} color={C.white}>{t('patientsAhead')}</T>
                </>
              )
            ) : null}
          </View>
        </View>
        {active && !notComing ? (
          <>
            <View style={{ marginTop: 14, height: 8, borderRadius: 4, backgroundColor: 'rgba(0,25,26,0.25)', overflow: 'hidden' }}>
              <View style={{ width: `${progress * 100}%`, height: 8, borderRadius: 4, backgroundColor: C.white }} />
            </View>
            <View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
              <T w="bold" size={14} color={C.white}>{t('nowServing')} <T numeric w="black" size={14} color={C.white}>{l.session.servingNumber || '-'}</T></T>
              {!turn && l.ahead > 0 ? <T w="bold" size={14} color={C.white}>{t('waitAbout')} <T numeric w="black" size={14} color={C.white}>{l.waitMinutes}</T> {t('min')}</T> : null}
            </View>
          </>
        ) : null}
      </View>

      <Page style={{ paddingTop: 14 }}>
        {turn ? (
          <Card style={{ padding: 14, backgroundColor: C.night, borderColor: C.night }}>
            <T w="heavy" size={17} color={C.white}>{t('yourTurn')}</T>
          </Card>
        ) : null}

        <Card style={{ marginTop: turn ? 10 : 0, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: notComing ? C.badBg : C.white }}>
          <Icon name={notComing ? 'alert' : 'clock'} size={20} color={notComing ? C.bad : C.link} />
          <T w="heavy" size={15} color={notComing ? C.bad : C.ink} style={{ flex: 1 }}>{status(l.session.doctorStatus, l.session.lateMinutes)}</T>
        </Card>
        {notComing && active ? <Button title={t('absentTitle')} kind="danger" style={{ marginTop: 10 }} onPress={() => router.push(`/absent/${id}`)} /> : null}

        <Card style={{ marginTop: 10, overflow: 'hidden' }}>
          <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={l.doctor.name} uri={l.doctor.photoUrl} size={52} radius={16} bg={C.brand} fg={C.white} />
            <View style={{ flex: 1 }}>
              <T w="heavy" size={17}>{l.doctor.name}</T>
              <T numeric w="light" size={14} color={C.sec}>{shortDate(t.lang, l.session.date)}, {l.session.time}</T>
            </View>
          </View>
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T w="heavy" size={15}>{l.chamber.name}</T>
              <T w="light" size={13} color={C.sec}>{l.chamber.address}</T>
            </View>
            <Button title={t('directions')} icon="nav" kind="secondary" style={{ height: 42 }} onPress={() => openMaps(l.chamber.lat, l.chamber.lng, l.chamber.name)} />
          </View>
        </Card>

        {l.token.state === 'BOOKED' && !notComing ? (
          <View style={{ marginTop: 14, gap: 10 }}>
            <Button title={t('reschedule')} icon="move" kind="secondary" disabled={l.token.rescheduleUsed} onPress={() => router.push(`/reschedule/${id}`)} />
            <T size={13} color={C.sec} style={{ textAlign: 'center' }}>{l.token.rescheduleUsed ? t('rescheduleUsed') : t('rescheduleNote')}</T>
            <Button title={t('cancel')} kind="danger" loading={busy} onPress={cancel} />
          </View>
        ) : null}
        <T size={12} color={C.faint} style={{ textAlign: 'center', marginTop: 16 }}>{l.session.totalTokens} / {l.session.tokenLimit}</T>
      </Page>
    </View>
  );
}
