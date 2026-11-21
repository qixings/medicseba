import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { post, ApiError } from '@/lib/api';
import { invalidate, useApi } from '@/lib/query';
import { PayCancelled, payForHold } from '@/lib/pay';
import { shortDate, useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Doctor, DoctorDetail, Hold, Member, Session } from '@/lib/types';
import { Calendar, monthOf, type DayMark } from '@/components/Calendar';
import { Icon } from '@/components/Icon';
import { seatPill } from '@/components/cards';
import { Avatar, BottomBar, Button, Card, Page, Status, T, TopBar, rupee, tap } from '@/components/ui';

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export default function Book() {
  const t = useT();
  const { doctorId, sessionId } = useLocalSearchParams<{ doctorId: string; sessionId?: string }>();
  const doc = useApi<DoctorDetail>(`/doctors/${doctorId}`);
  const preset = doc.data?.week.find((s) => s.id === sessionId);
  const [month, setMonth] = useState(monthOf(istToday()));
  const [date, setDate] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(sessionId ?? null);
  const [member, setMember] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (preset && !date) { setDate(preset.date); setMonth(monthOf(preset.date)); } }, [preset, date]);

  const cal = useApi<{ today: string; sessions: Session[] }>(`/doctors/${doctorId}/calendar?month=${month}`);
  const members = useApi<Member[]>('/me/members');
  useEffect(() => { if (!member && members.data?.length) setMember(members.data[0].id); }, [members.data, member]);

  const marks = useMemo(() => {
    const m: Record<string, DayMark> = {};
    for (const s of cal.data?.sessions ?? []) {
      if (s.status === 'CANCELLED') continue;
      m[s.date] = s.bookable ? 'open' : m[s.date] === 'open' ? 'open' : 'full';
    }
    return m;
  }, [cal.data]);

  const daySessions = (cal.data?.sessions ?? []).filter((s) => s.date === date && s.status !== 'CANCELLED');
  const session = daySessions.find((s) => s.id === picked) ?? (picked ? preset : undefined);
  const chamber = doc.data?.chambers.find((c) => c.id === session?.chamber.id) ?? doc.data?.chambers[0];
  const d = doc.data;
  const maxDate = d ? new Date(Date.now() + 330 * 60_000 + (d.bookingWindowDays - 1) * 86_400_000).toISOString().slice(0, 10) : undefined;

  async function pay() {
    if (!session || !member) return;
    setBusy(true); setErr('');
    try {
      const hold = await post<Hold>('/bookings/hold', { sessionId: session.id, memberId: member });
      const live = await payForHold(hold);
      void invalidate('/bookings'); void invalidate('/home'); void invalidate(`/doctors/${doctorId}`);
      router.replace(`/confirmed/${live.token.id}`);
    } catch (e) {
      if (e instanceof PayCancelled) setErr(t('payFailed'));
      else setErr((e as ApiError).message);
      void cal.refetch();
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={t('bookToken')} />
      <Page bar style={{ paddingBottom: 150 }}>
        <Status loading={doc.isLoading} error={doc.error} onRetry={() => doc.refetch()} />
        {d ? <DoctorHead d={d} /> : null}

        <Card style={{ marginTop: 12, padding: 14 }}>
          <Calendar month={month} today={cal.data?.today ?? istToday()} marks={marks} selected={date} maxDate={maxDate}
            onMonth={setMonth} onSelect={(x) => { setDate(x); const first = (cal.data?.sessions ?? []).find((s) => s.date === x && s.bookable); setPicked(first?.id ?? null); }} />
        </Card>

        {date ? (
          <>
            <T w="heavy" size={18} style={{ marginTop: 18 }}>{t('chooseSession')}, <T w="light" size={18} color={C.sec}>{shortDate(t.lang, date)}</T></T>
            {daySessions.length === 0 ? <T size={15} color={C.sec} style={{ marginTop: 8 }}>{t('noSitting')}</T> : null}
            <View style={{ marginTop: 10, gap: 8 }}>
              {daySessions.map((s) => {
                const on = s.id === picked;
                return (
                  <Pressable key={s.id} disabled={!s.bookable} onPress={() => { tap(); setPicked(s.id); }} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !s.bookable }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: C.white, borderWidth: on ? 2 : 1, borderColor: on ? C.brand : C.line, opacity: s.bookable ? 1 : 0.55 }}>
                    <View style={{ flex: 1 }}>
                      <T numeric w="heavy" size={17}>{s.time}</T>
                      <T w="light" size={14} color={C.sec}>{s.chamber.name}, {s.chamber.area}</T>
                    </View>
                    {seatPill(t, s)}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <T w="heavy" size={18} style={{ marginTop: 18 }}>{t('forWho')}</T>
        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {members.data?.map((m) => {
            const on = m.id === member;
            return (
              <Pressable key={m.id} onPress={() => { tap(); setMember(m.id); }} accessibilityRole="radio" accessibilityState={{ checked: on }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 6, paddingRight: 14, borderRadius: 22, backgroundColor: on ? C.night : C.white, borderWidth: 1, borderColor: on ? C.night : C.line }}>
                <Avatar name={m.name} size={32} bg={on ? C.brand : C.tint} fg={on ? C.white : C.link} />
                <T w="bold" size={14} color={on ? C.white : C.ink}>{m.isSelf ? t('you') : m.name.split(' ')[0]}, {m.age}</T>
              </Pressable>
            );
          })}
          <Pressable onPress={() => router.push('/family')} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: C.field, borderStyle: 'dashed' }}>
            <Icon name="plus" size={16} color={C.link} width={2.6} />
            <T w="bold" size={14} color={C.link}>{t('addMember')}</T>
          </Pressable>
        </View>

        {chamber ? (
          <Card style={{ marginTop: 18, padding: 14, gap: 8 }}>
            <Line a={t('bookingFee')} b={rupee(chamber.bookingFee)} />
            <Line a={t('serviceFee')} b={rupee(chamber.platformFee)} />
            <View style={{ height: 1, backgroundColor: C.line }} />
            <Line a={t('total')} b={rupee(chamber.total)} strong />
          </Card>
        ) : null}
        <T size={13} color={C.sec} style={{ marginTop: 10 }}>{t('heldFor')} {t('rescheduleNote')}</T>
      </Page>
      <BottomBar>
        {err ? <T size={14} color={C.bad} style={{ marginBottom: 8 }}>{err}</T> : null}
        <Button title={`${t('pay')} ${rupee(chamber?.total ?? 65)}`} onPress={pay} disabled={!session?.bookable || !member} loading={busy} />
      </BottomBar>
    </View>
  );
}

function DoctorHead({ d }: { d: Doctor }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Avatar name={d.name} uri={d.photoUrl} size={56} radius={18} bg={C.brand} fg={C.white} />
      <View style={{ flex: 1 }}>
        <T w="heavy" size={19} style={{ letterSpacing: -0.4 }}>{d.name}</T>
        <T w="light" size={14} color={C.sec}>{d.specialty.name}</T>
      </View>
    </View>
  );
}

function Line({ a, b, strong }: { a: string; b: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <T w={strong ? 'heavy' : 'regular'} size={strong ? 17 : 15} color={strong ? C.ink : C.sec}>{a}</T>
      <T numeric w={strong ? 'black' : 'bold'} size={strong ? 17 : 15}>{b}</T>
    </View>
  );
}
