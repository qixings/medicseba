import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dismissNewBookings, refreshBoard, useCounter, type Board, type SessionRow } from '@/lib/counter';
import { useLiveBoard, useServerChange } from '@/lib/live';
import { useT, type Key } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { C } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Inbox } from '@/components/Inbox';
import { Logo } from '@/components/Logo';
import { SittingSwitch } from '@/components/SittingSwitch';
import { SyncBar } from '@/components/SyncBar';
import { WalkInSheet } from '@/components/WalkInSheet';
import { Avatar, Button, Card, H1, Page, Segmented, Status, T } from '@/components/ui';

const istDay = (plus = 0) => new Date(Date.now() + 330 * 60_000 + plus * 86_400_000).toISOString().slice(0, 10);

export default function Today() {
  const t = useT();
  const chamber = useAuth((s) => s.chamber);
  const online = useCounter((s) => s.online);
  const boards = useCounter((s) => s.boards);
  const newBookings = useCounter((s) => s.newBookings);
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [list, setList] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [walkIn, setWalkIn] = useState<SessionRow | null>(null);
  const date = istDay(day === 'today' ? 0 : 1);

  const load = useCallback(async () => {
    setLoading(true);
    const key = `sessions:${date}`;
    try {
      const r = await api<{ sessions: SessionRow[] }>(`/agent/sessions?date=${date}`);
      setList(r.sessions);
      useCounter.setState({ online: true });
      void storage.setJSON(key, r.sessions);
      // Load each queue too: walk-ins work from here, and new online bookings are noticed.
      await Promise.all(r.sessions.map((s) => refreshBoard(s.id)));
    } catch {
      setList((await storage.getJSON<SessionRow[]>(key)) ?? []);
    } finally { setLoading(false); }
  }, [date]);

  useEffect(() => { setList(null); void load(); }, [load]);
  useEffect(() => { if (online) void load(); }, [online, load]);
  // Doctor or sitting changes from MedicSeba show up without a refresh.
  useServerChange(['catalog'], () => { void load(); });

  return (
    <>
      <Page tabs refresh={<RefreshControl refreshing={loading && !!list} onRefresh={() => { void load(); }} tintColor={C.deep} />} style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Logo height={22} />
          <View accessibilityLabel={online ? 'Online' : 'Offline'} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? C.good : C.warn }} />
        </View>
        <H1 style={{ marginTop: 6 }}>{chamber?.name ?? t('brand')}</H1>
        <View style={{ marginTop: 14, marginBottom: 14 }}>
          <Segmented value={day} onChange={setDay} options={[{ value: 'today', label: t('today') }, { value: 'tomorrow', label: t('tomorrow') }]} />
        </View>
        <SyncBar />
        <Inbox />
        {newBookings.length ? (
          <Card onPress={() => { const first = newBookings[0]; dismissNewBookings(); router.push(`/session/${first.sessionId}`); }}
            style={{ marginBottom: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.tint, borderColor: C.brand }}>
            <Icon name="bell" size={20} color={C.link} />
            <View style={{ flex: 1 }}>
              <T w="heavy" size={15} color={C.link}>{newBookings.length === 1 ? t('newOnline') : `${newBookings.length} ${t('newOnlineMany')}`}</T>
              <T size={14} color={C.sec} lines={1}>{newBookings.map((n) => `${n.number ?? '…'} ${n.name}`).join(', ')}</T>
            </View>
            <T w="bold" size={14} color={C.link} onPress={() => dismissNewBookings()}>{t('markRead')}</T>
          </Card>
        ) : null}
        <Status loading={!list} empty={list?.length === 0 ? t('noSittings') : undefined} />
        <View style={{ gap: 12 }}>
          {list?.map((s) => <SittingCard key={s.id} s={boards[s.id]?.session ?? s} board={boards[s.id]} onWalkIn={() => setWalkIn(boards[s.id]?.session ?? s)} />)}
        </View>
      </Page>
      {walkIn ? <WalkInSheet sessionId={walkIn.id} doctor={`${walkIn.doctor.name}, ${walkIn.time}`} open onClose={() => setWalkIn(null)} /> : null}
    </>
  );
}

function SittingCard({ s, board, onWalkIn }: { s: SessionRow; board?: Board; onWalkIn: () => void }) {
  const t = useT();
  useLiveBoard(s.id);
  const over = s.status === 'ENDED' || s.status === 'CANCELLED';
  const tokens = board?.tokens ?? [];
  const seen = tokens.filter((x) => x.state === 'DONE').length + (tokens.some((x) => x.state === 'SERVING') ? 1 : 0);
  const total = tokens.filter((x) => ['BOOKED', 'ARRIVED', 'SERVING', 'DONE', 'MISSED', 'NO_SHOW'].includes(x.state)).length || s.onlineTaken + s.counterTaken;
  const left = Math.max(0, s.tokenLimit - s.onlineTaken - s.counterTaken);
  const docTone = s.doctorStatus === 'ARRIVED' ? C.good : s.doctorStatus === 'LATE' || s.doctorStatus === 'BREAK' ? C.warn : s.doctorStatus === 'NOT_COMING' ? C.bad : C.sec;
  return (
    <Card style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={s.doctor.name} uri={s.doctor.photoUrl} size={52} radius={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T w="heavy" size={18} lines={1} style={{ letterSpacing: -0.3 }}>{s.doctor.name}</T>
          <T size={14} color={C.sec} lines={1}><T numeric w="heavy" size={14}>{s.time}</T>, <T w="bold" size={14} color={docTone}>{t(`st_${s.doctorStatus}` as Key)}</T></T>
        </View>
        <SittingSwitch s={s} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stat label={t('serving')} value={`${seen}/${total}`} dark />
        <Stat label={t('online')} value={`${s.onlineTaken}/${s.onlineLimit}`} />
        <Stat label={t('counter')} value={s.counterTaken} />
        <Stat label={t('left')} value={left} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={t('walkIn')} icon="plus" style={{ flex: 1, height: 50 }} disabled={over || left === 0} onPress={onWalkIn} />
        <Button title={t('openQueue')} kind="secondary" style={{ flex: 1, height: 50 }} onPress={() => router.push(`/session/${s.id}`)} />
      </View>
    </Card>
  );
}

function Stat({ label, value, dark }: { label: string; value: string | number; dark?: boolean }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 14, backgroundColor: dark ? C.night : C.bg }}>
      <T numeric w="black" size={20} color={dark ? C.white : C.ink}>{value}</T>
      <T w="medium" size={11} color={dark ? 'rgba(255,255,255,0.7)' : C.sec} lines={1}>{label}</T>
    </View>
  );
}
