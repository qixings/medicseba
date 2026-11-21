import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { post, type ApiError } from '@/lib/api';
import { invalidate, useApi } from '@/lib/query';
import { shortDate, useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Live } from '@/lib/types';
import { SessionPicker } from '@/components/SessionPicker';
import { BottomBar, Button, Card, H1, Page, Status, T, TopBar } from '@/components/ui';

export default function Reschedule() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<Live>(`/bookings/${id}/live`);
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const l = q.data;

  async function move() {
    if (!to) return;
    setBusy(true); setErr('');
    try {
      const r = await post<Live>(`/bookings/${id}/reschedule`, { sessionId: to });
      void invalidate('/bookings'); void invalidate('/home');
      router.replace(`/live/${r.token.id}`);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={t('reschedule')} />
      <Page bar style={{ paddingBottom: 140 }}>
        <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
        {l ? (
          <>
            <H1 size={28}>{t('reschedule')}</H1>
            <T size={14} color={C.sec} style={{ marginTop: 4 }}>{t('rescheduleNote')}</T>
            <Card style={{ marginTop: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: C.night, alignItems: 'center', justifyContent: 'center' }}>
                <T numeric w="black" size={22} color={C.white}>{l.token.number}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T w="heavy" size={16}>{l.doctor.name}</T>
                <T numeric w="light" size={14} color={C.sec} style={{ textDecorationLine: 'line-through' }}>{shortDate(t.lang, l.session.date)}, {l.session.time}</T>
              </View>
            </Card>
            <View style={{ marginTop: 14 }}>
              <SessionPicker doctorId={l.doctor.id} exclude={l.session.id} value={to} onChange={setTo} />
            </View>
          </>
        ) : null}
      </Page>
      <BottomBar>
        {err ? <T size={14} color={C.bad} style={{ marginBottom: 8 }}>{err}</T> : null}
        <Button title={t('moveHere')} onPress={move} disabled={!to || l?.token.rescheduleUsed} loading={busy} />
      </BottomBar>
    </View>
  );
}
