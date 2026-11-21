import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useApi } from '@/lib/query';
import { useT } from '@/lib/i18n';
import { C, F, card } from '@/lib/theme';
import type { DoctorWithSessions, Specialty } from '@/lib/types';
import { Icon } from '@/components/Icon';
import { DoctorRow } from '@/components/cards';
import { Card, Chip, H1, Page, Status, TopBar } from '@/components/ui';

export default function Doctors() {
  const t = useT();
  const params = useLocalSearchParams<{ specialty?: string; q?: string; available?: string }>();
  const [spec, setSpec] = useState(params.specialty ?? '');
  const [q, setQ] = useState(params.q ?? '');
  const [today, setToday] = useState(params.available === '1');
  const specs = useApi<Specialty[]>('/specialties');
  const qs = new URLSearchParams({ ...(spec ? { specialty: spec } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(today ? { available: '1' } : {}) }).toString();
  const list = useApi<{ doctors: DoctorWithSessions[] }>(`/doctors${qs ? `?${qs}` : ''}`);
  const docs = list.data?.doctors ?? [];

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={t('doctors')} />
      <Page bar>
        <H1>{spec ? specs.data?.find((s) => s.slug === spec)?.name ?? t('doctors') : t('doctors')}</H1>
        <View style={[card, { marginTop: 14, height: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }]}>
          <Icon name="search" size={18} color={C.faint} width={2.2} />
          <TextInput accessibilityLabel={t('search')} placeholder={t('search')} placeholderTextColor={C.faint} value={q} onChangeText={setQ}
            style={[F.regular, { flex: 1, fontSize: 17, color: C.ink, height: 44 }]} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginTop: 12 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
          <Chip label={t('availableToday')} on={today} onPress={() => setToday(!today)} />
          <Chip label={t('all')} on={!spec} onPress={() => setSpec('')} />
          {specs.data?.map((s) => <Chip key={s.slug} label={s.name} on={spec === s.slug} onPress={() => setSpec(s.slug)} />)}
        </ScrollView>
        <Status loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={list.data && docs.length === 0 ? t('noDoctors') : undefined} />
        {docs.length ? (
          <Card style={{ marginTop: 14, overflow: 'hidden' }}>
            {docs.map((d, i) => <DoctorRow key={d.id} d={d} session={d.sessions.find((s) => s.bookable) ?? d.sessions[0]} last={i === docs.length - 1} />)}
          </Card>
        ) : null}
      </Page>
    </View>
  );
}
