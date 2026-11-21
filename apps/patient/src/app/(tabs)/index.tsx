import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useApi, useDebounced } from '@/lib/query';
import { SearchBox } from '@/components/SearchBox';
import { useWatchSession } from '@/lib/live';
import { useT } from '@/lib/i18n';
import { C, card } from '@/lib/theme';
import type { Chamber, DoctorWithSessions, Home as HomeData, Note } from '@/lib/types';
import { Icon, isIcon } from '@/components/Icon';
import { ChamberCard, DoctorRow, TokenCard } from '@/components/cards';
import { Logo } from '@/components/Logo';
import { Avatar, Card, H1, Page, RoundButton, SectionHead, Status, T, tap } from '@/components/ui';

export default function Home() {
  const t = useT();
  const q = useApi<HomeData>('/home');
  const notes = useApi<Note[]>('/me/notifications');
  const [search, setSearch] = useState('');
  useWatchSession(q.data?.activeToken?.session.id);
  const unread = notes.data?.some((n) => !n.read);
  const d = q.data;
  const upcoming = d?.sessionsToday.filter((s) => s.status === 'OPEN' && s.doctorStatus !== 'ENDED') ?? [];
  const [first, ...rest] = upcoming;

  return (
    <Page tabs refresh={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); void notes.refetch(); }} tintColor={C.deep} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo height={24} />
        <RoundButton icon="bell" label={t('notifications')} dot={unread} onPress={() => router.push('/notifications')} />
      </View>
      <H1 style={{ marginTop: 4 }}>{t('bookDoctor')}</H1>
      {d ? <T w="light" size={17} color={C.sec} style={{ marginTop: 4 }}><T numeric w="heavy" size={17}>{d.sittingToday}</T> {t('sittingToday')}</T> : null}

      <SearchBox value={search} onChange={setSearch} onSubmit={() => search.trim() && router.push({ pathname: '/doctors', params: { q: search.trim() } })} />

      {search.trim() ? <SearchResults q={search} /> : (<>

      <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />

      {d?.activeToken ? (
        <View style={{ marginTop: 14 }}>
          <TokenCard live={d.activeToken} onPress={() => router.push(`/live/${d.activeToken!.token.id}`)} />
        </View>
      ) : null}

      {d ? (
        <>
          <SectionHead title={t('specialties')} action={t('seeAll')} onAction={() => router.push('/doctors')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginTop: 12 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
            {d.specialties.map((s) => (
              <Pressable key={s.slug} onPress={() => { tap(); router.push({ pathname: '/doctors', params: { specialty: s.slug } }); }} style={{ width: 76, alignItems: 'center', gap: 8 }}>
                <View style={[card, { width: 76, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }]}>
                  {isIcon(s.icon) ? <Icon name={s.icon} size={26} color={C.link} /> : null}
                </View>
                <T w="bold" size={12} lines={1}>{s.name.replace(' physician', '')}</T>
              </Pressable>
            ))}
          </ScrollView>

          <SectionHead title={t('chambers')} action={t('seeAll')} onAction={() => router.push('/chambers')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginTop: 12 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 6, gap: 12 }}>
            {d.chambers.map((c) => <ChamberCard key={c.id} c={c} />)}
          </ScrollView>

          <SectionHead title={t('sittingTodayH')} action={t('seeAll')} onAction={() => router.push({ pathname: '/doctors', params: { available: '1' } })} />
          {first ? (
            <Card onPress={() => router.push(`/doctor/${first.doctor.id}`)} style={{ marginTop: 12, padding: 12, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <Avatar name={first.doctor.name} uri={first.doctor.photoUrl} size={72} radius={22} bg={C.brand} fg={C.white} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T w="bold" size={12} color={C.link}>{first.time}</T>
                <T w="heavy" size={20} lines={1} style={{ letterSpacing: -0.4 }}>{first.doctor.name}</T>
                <T w="light" size={14} color={C.sec} lines={1}>{first.doctor.specialty.name}, {first.chamber.name}</T>
              </View>
            </Card>
          ) : <Status empty={t('noneToday')} />}
          {rest.length ? (
            <Card style={{ marginTop: 10, overflow: 'hidden' }}>
              {rest.slice(0, 6).map((s, i, a) => <DoctorRow key={s.id} d={s.doctor} session={s} last={i === a.length - 1} />)}
            </Card>
          ) : null}
        </>
      ) : null}
      </>)}
    </Page>
  );
}

/** Results under the home search box while typing: a few doctors and chambers, and a link to all doctors. */
function SearchResults({ q }: { q: string }) {
  const t = useT();
  const dq = useDebounced(q.trim());
  const docs = useApi<{ doctors: DoctorWithSessions[] }>(dq ? `/doctors?q=${encodeURIComponent(dq)}` : null, { keep: true });
  const rooms = useApi<Chamber[]>(dq ? `/chambers?q=${encodeURIComponent(dq)}` : null, { keep: true });
  const d = docs.data?.doctors ?? [];
  const c = rooms.data ?? [];
  const loading = (docs.isLoading || rooms.isLoading) && !docs.data && !rooms.data;
  if (loading) return <Status loading />;
  if (docs.data && rooms.data && !d.length && !c.length) return <T size={15} color={C.sec} style={{ marginTop: 18, lineHeight: 22 }}>{t('noResults')}</T>;
  return (
    <View style={{ opacity: docs.isPlaceholderData || rooms.isPlaceholderData ? 0.6 : 1 }}>
      {d.length ? (
        <>
          <SectionHead title={t('doctors')} action={d.length > 5 ? t('allDoctorsFor') : undefined} onAction={() => router.push({ pathname: '/doctors', params: { q: dq } })} />
          <Card style={{ marginTop: 10, overflow: 'hidden' }}>
            {d.slice(0, 5).map((x, i, arr) => <DoctorRow key={x.id} d={x} session={x.sessions.find((s) => s.bookable) ?? x.sessions[0]} last={i === arr.length - 1} />)}
          </Card>
        </>
      ) : null}
      {c.length ? (
        <>
          <SectionHead title={t('chambers')} />
          <View style={{ marginTop: 10, gap: 10 }}>{c.slice(0, 4).map((x) => <ChamberCard key={x.id} c={x} wide />)}</View>
        </>
      ) : null}
    </View>
  );
}
