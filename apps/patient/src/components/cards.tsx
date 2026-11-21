import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { mediaUrl } from '@/lib/api';
import { PhotoPlaceholder } from './Mark';
import { router } from 'expo-router';
import { C, S } from '@/lib/theme';
import { shortDate, useT } from '@/lib/i18n';
import type { Chamber, Doctor, DoctorStatus, Live, Session } from '@/lib/types';
import { Icon } from './Icon';
import { Avatar, Card, Pill, T, tap } from './ui';

export function useDoctorStatus() {
  const t = useT();
  return (s: DoctorStatus, late = 0) => ({
    ON_TIME: t('doctorOnTime'),
    LATE: `${t('doctorLate')} ${late} ${t('min')}`,
    ARRIVED: t('doctorArrived'),
    BREAK: t('doctorBreak'),
    NOT_COMING: t('doctorNotComing'),
    ENDED: t('ended'),
  })[s];
}

export function seatPill(t: ReturnType<typeof useT>, s: Pick<Session, 'tokensLeft' | 'bookable' | 'full' | 'doctorStatus'>) {
  if (s.doctorStatus === 'NOT_COMING') return <Pill text={t('doctorNotComing')} tone="bad" />;
  if (s.full) return <Pill text={t('full')} tone="bad" />;
  if (!s.bookable) return <Pill text={t('closed')} tone="plain" />;
  return <Pill text={`${s.tokensLeft} ${t('left')}`} tone={s.tokensLeft <= 5 ? 'warn' : 'good'} />;
}

/** The night card with the patient's token number. */
export function TokenCard({ live, onPress }: { live: Live; onPress?: () => void }) {
  const t = useT();
  const status = useDoctorStatus();
  const isToday = live.session.date === new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const turn = live.token.state === 'SERVING' || (live.token.number != null && live.session.servingNumber === live.token.number);
  return (
    <Pressable onPress={() => { tap(); onPress?.(); }} accessibilityRole="button"
      style={({ pressed }) => [{ borderRadius: 24, padding: 16, gap: 12, backgroundColor: C.night, ...S.up }, pressed && { transform: [{ scale: 0.985 }] }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T w="bold" size={13} color={C.white}>{t('yourToken')} {isToday ? t('today').toLowerCase() : shortDate(t.lang, live.session.date)}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.16)' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.brand }} />
          <T w="heavy" size={12} color={C.white}>{t('live')}</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
        <T numeric w="black" size={76} color={C.white} style={{ lineHeight: 70, letterSpacing: -3.5 }}>{live.token.number ?? '-'}</T>
        <View style={{ paddingBottom: 4, flex: 1 }}>
          <T w="heavy" size={24} color={C.brand} style={{ letterSpacing: -0.6 }}>{turn ? t('turnNow') : live.ahead === 0 ? t('nextUp') : `${live.ahead} ${t('ahead')}`}</T>
          <T w="medium" size={15} color={C.white}>{live.session.servingNumber > 0 ? <>{t('nowServing')} <T numeric w="black" size={15} color={C.white}>{live.session.servingNumber}</T></> : status(live.session.doctorStatus, live.session.lateMinutes)}</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Avatar name={live.doctor.name} uri={live.doctor.photoUrl} size={34} bg={C.brand} fg={C.white} />
        <View style={{ flex: 1 }}>
          <T w="heavy" size={15} color={C.white} lines={1}>{live.doctor.name}</T>
          <T w="medium" size={12} color="rgba(255,255,255,0.7)" lines={1}>{live.chamber.name}, {live.session.time}</T>
        </View>
        <Icon name="chev" size={18} color={C.white} width={2.6} />
      </View>
    </Pressable>
  );
}

export function DoctorRow({ d, session, last }: { d: Doctor; session?: Session; last?: boolean }) {
  const t = useT();
  return (
    <Pressable onPress={() => { tap(); router.push(`/doctor/${d.id}`); }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: pressed ? C.bg : 'transparent' }, !last && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
      <Avatar name={d.name} uri={d.photoUrl} size={52} radius={16} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T w="heavy" size={16} lines={1}>{d.name}</T>
        <T w="light" size={14} color={C.sec} lines={1}>{d.specialty.name}{session ? `, ${session.chamber.name}` : ''}</T>
      </View>
      {session ? (
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <T numeric w="heavy" size={15}>{session.time}</T>
          {seatPill(t, session)}
        </View>
      ) : <Icon name="chev" size={18} color={C.faint} width={2.4} />}
    </Pressable>
  );
}

export function ChamberCard({ c, wide }: { c: Chamber; wide?: boolean }) {
  const t = useT();
  return (
    <Card onPress={() => router.push(`/chamber/${c.id}`)} style={[{ overflow: 'hidden' }, wide ? null : { width: 228 }]}>
      <View style={{ height: 110, backgroundColor: C.tint, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 12, paddingHorizontal: 14 }}>
        {c.photos[0]
          ? <Image source={mediaUrl(c.photos[0])} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={c.name} />
          : <PhotoPlaceholder style={StyleSheet.absoluteFill} size={40} />}
        {/* No hours known (null): show nothing rather than guess. */}
        {c.openNow !== null ? (
          <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: C.white, justifyContent: 'center' }}>
            <T w="bold" size={12} color={c.openNow ? C.good : C.warn}>{c.openNow ? t('openNow') : `${t('open')} ${c.openingHours.split('-')[0]}`}</T>
          </View>
        ) : null}
      </View>
      <View style={{ padding: 12, paddingHorizontal: 14 }}>
        <T w="heavy" size={17} lines={1} style={{ letterSpacing: -0.3 }}>{c.name}</T>
        <T w="light" size={14} color={C.sec} lines={1}>{c.area}, {c.kind === 'PHARMACY' ? t('pharmacy') : t('own')}</T>
        <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row' }}>
            {(c.doctorInitials ?? []).map((i, k) => (
              <View key={k} style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.white, marginLeft: k ? -8 : 0, backgroundColor: C.deep, alignItems: 'center', justifyContent: 'center' }}>
                <T w="heavy" size={10} color={C.white}>{i}</T>
              </View>
            ))}
          </View>
          <T w="semibold" size={12} color={C.sec}><T numeric w="heavy" size={12}>{c.doctorsToday ?? 0}</T> {t('doctorsToday')}</T>
        </View>
      </View>
    </Card>
  );
}
