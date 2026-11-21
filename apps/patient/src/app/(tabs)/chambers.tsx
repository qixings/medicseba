import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApi, useDebounced } from '@/lib/query';
import { SearchBox } from '@/components/SearchBox';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Chamber } from '@/lib/types';
import { Icon } from '@/components/Icon';
import { ChamberCard } from '@/components/cards';
import { Chip, H1, Page, Status } from '@/components/ui';

type Filter = 'all' | 'open' | 'pharmacy' | 'own';

export default function Chambers() {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const query = useApi<Chamber[]>(`/chambers?filter=${filter}${dq.trim() ? `&q=${encodeURIComponent(dq.trim())}` : ''}`, { keep: true });
  const filters: { v: Filter; label: string }[] = [
    { v: 'all', label: t('all') }, { v: 'open', label: t('openNow') }, { v: 'pharmacy', label: t('pharmacy') }, { v: 'own', label: t('own') },
  ];

  return (
    <Page tabs refresh={<RefreshControl refreshing={query.isRefetching} onRefresh={() => { void query.refetch(); }} tintColor={C.deep} />}>
      <H1 style={{ marginTop: 30 }}>{t('chambers')}</H1>
      <SearchBox value={q} onChange={setQ} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginTop: 12 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
        {filters.map((f) => <Chip key={f.v} label={f.label} on={filter === f.v} onPress={() => setFilter(f.v)} />)}
      </ScrollView>
      <Status loading={query.isLoading} error={query.error} onRetry={() => query.refetch()} empty={query.data?.length === 0 ? t('noDoctors') : undefined} />
      <View style={{ marginTop: 14, gap: 12 }}>
        {query.data?.map((c) => <ChamberCard key={c.id} c={c} wide />)}
      </View>
    </Page>
  );
}
