import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { signOut, useAuth } from '@/lib/auth';
import { useCounter, type SessionRow } from '@/lib/counter';
import { setLang, useT, type Key } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { C } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { SyncBar } from '@/components/SyncBar';
import { Inbox } from '@/components/Inbox';
import { Logo } from '@/components/Logo';
import { Avatar, Card, H1, Page, Pill, Segmented, Status, T, tap } from '@/components/ui';

const istDay = (plus = 0) => new Date(Date.now() + 330 * 60_000 + plus * 86_400_000).toISOString().slice(0, 10);

export default function Sittings() {
  const t = useT();
  const chamber = useAuth((s) => s.chamber);
  const online = useCounter((s) => s.online);
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [list, setList] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const date = istDay(day === 'today' ? 0 : 1);

  const load = useCallback(async () => {
    setLoading(true);
    const key = `sessions:${date}`;
    try {
      const r = await api<{ sessions: SessionRow[] }>(`/agent/sessions?date=${date}`);
      setList(r.sessions);
      useCounter.setState({ online: true });
      void storage.setJSON(key, r.sessions);
    } catch {
      // Offline: show what was saved last time.
      setList((await storage.getJSON<SessionRow[]>(key)) ?? []);
    } finally { setLoading(false); }
  }, [date]);

  useEffect(() => { setList(null); void load(); }, [load]);
  useEffect(() => { if (online) void load(); }, [online, load]);

  return (
    <Page refresh={<RefreshControl refreshing={loading && !!list} onRefresh={() => { void load(); }} tintColor={C.deep} />} style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Logo height={22} />
          <View accessibilityLabel={online ? 'Online' : 'Offline'} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? C.good : C.warn }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => { tap(); setLang(t.lang === 'en' ? 'bn' : 'en'); }} style={{ height: 38, paddingHorizontal: 12, borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, justifyContent: 'center' }}>
            <T w="semibold" size={13}>{t('langToggle')}</T>
          </Pressable>
          <Pressable accessibilityLabel={t('logout')} onPress={() => { tap(); void signOut(); }} style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="logout" size={17} color={C.sec} />
          </Pressable>
        </View>
      </View>
      <H1 style={{ marginTop: 6 }}>{chamber?.name ?? t('brand')}</H1>
      <View style={{ marginTop: 14, marginBottom: 14 }}>
        <Segmented value={day} onChange={setDay} options={[{ value: 'today', label: t('today') }, { value: 'tomorrow', label: t('tomorrow') }]} />
      </View>
      <SyncBar />
      <Inbox />
      <Status loading={!list} empty={list?.length === 0 ? t('noSittings') : undefined} />
      <View style={{ gap: 10 }}>
        {list?.map((s) => <SittingCard key={s.id} s={s} />)}
      </View>
    </Page>
  );
}

function SittingCard({ s }: { s: SessionRow }) {
  const t = useT();
  const booked = s.onlineTaken + s.counterTaken;
  const left = Math.max(0, s.tokenLimit - booked);
  const tone = s.status === 'CANCELLED' ? 'bad' : s.status === 'ENDED' ? 'plain' : s.doctorStatus === 'ARRIVED' ? 'good' : s.doctorStatus === 'LATE' || s.doctorStatus === 'BREAK' ? 'warn' : 'teal';
  return (
    <Card onPress={() => router.push(`/session/${s.id}`)} style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={s.doctor.name} uri={s.doctor.photoUrl} size={52} radius={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T w="heavy" size={18} lines={1} style={{ letterSpacing: -0.3 }}>{s.doctor.name}</T>
          <T w="light" size={14} color={C.sec} lines={1}>{s.doctor.specialty}</T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <T numeric w="heavy" size={17}>{s.time}</T>
          <Pill text={t(`st_${s.doctorStatus}` as Key)} tone={tone} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stat label={t('serving')} value={s.servingNumber || '-'} dark />
        <Stat label={t('online')} value={`${s.onlineTaken}/${s.onlineLimit}`} />
        <Stat label={t('counter')} value={s.counterTaken} />
        <Stat label={t('left')} value={left} />
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
