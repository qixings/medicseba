import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useApi } from '@/lib/query';
import { shortDate, useT, type Key } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Booking } from '@/lib/types';
import { Avatar, Card, H1, Page, Pill, Segmented, Status, T } from '@/components/ui';

export default function Bookings() {
  const t = useT();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const q = useApi<Booking[]>(`/bookings?scope=${scope}`);

  return (
    <Page tabs refresh={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} tintColor={C.deep} />}>
      <H1 style={{ marginTop: 30 }}>{t('bookings')}</H1>
      <View style={{ marginTop: 14 }}>
        <Segmented value={scope} onChange={setScope} options={[{ value: 'upcoming', label: t('upcoming') }, { value: 'past', label: t('past') }]} />
      </View>
      <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
        empty={q.data?.length === 0 ? t(scope === 'upcoming' ? 'noUpcoming' : 'noPast') : undefined}
        emptyAction={scope === 'upcoming' ? t('findDoctor') : undefined} onEmptyAction={() => router.push('/doctors')} />
      <View style={{ marginTop: 14, gap: 10 }}>
        {q.data?.map((b) => <BookingCard key={b.id} b={b} />)}
      </View>
    </Page>
  );
}

function BookingCard({ b }: { b: Booking }) {
  const t = useT();
  const absent = b.doctorStatus === 'NOT_COMING' && b.state === 'BOOKED' && !b.absentChoice;
  const tone = absent ? 'bad' : b.state === 'BOOKED' || b.state === 'ARRIVED' || b.state === 'SERVING' ? 'good' : b.state === 'DONE' ? 'teal' : 'plain';
  const open = () => router.push(absent ? `/absent/${b.id}` : `/live/${b.id}`);
  return (
    <Card onPress={open} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 62, height: 62, borderRadius: 18, backgroundColor: b.state === 'BOOKED' ? C.night : C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <T w="bold" size={10} color={b.state === 'BOOKED' ? 'rgba(255,255,255,0.7)' : C.sec}>{t('token')}</T>
        <T numeric w="black" size={26} color={b.state === 'BOOKED' ? C.white : C.ink} style={{ lineHeight: 28 }}>{b.number ?? '-'}</T>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T w="heavy" size={16} lines={1}>{b.doctor.name}</T>
        <T w="light" size={14} color={C.sec} lines={1}>{b.chamber.name}</T>
        <T numeric w="bold" size={13}>{shortDate(t.lang, b.date)}, {b.time}</T>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Pill text={absent ? t('doctorNotComing') : t(`state_${b.state}` as Key)} tone={tone} />
        <Avatar name={b.patientName} size={26} />
      </View>
    </Card>
  );
}
