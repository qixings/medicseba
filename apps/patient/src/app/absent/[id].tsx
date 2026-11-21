import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { post, type ApiError } from '@/lib/api';
import { invalidate, useApi } from '@/lib/query';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Live } from '@/lib/types';
import { Icon } from '@/components/Icon';
import { SessionPicker } from '@/components/SessionPicker';
import { BottomBar, Button, H1, Page, Status, T, TopBar } from '@/components/ui';

export default function Absent() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<Live>(`/bookings/${id}/live`);
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const l = q.data;

  async function submit() {
    setBusy(true); setErr('');
    try {
      const r = await post<Live>(`/bookings/${id}/absent-choice`, { choice: 'move', sessionId: to });
      void invalidate('/bookings'); void invalidate('/home');
      router.replace(`/live/${r.token.id}`);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={l?.doctor.name} />
      <Page bar style={{ paddingBottom: 140 }}>
        <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
        {l ? (
          <>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: C.badBg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="alert" size={26} color={C.bad} />
            </View>
            <H1 size={28} style={{ marginTop: 12 }}>{t('absentTitle')}</H1>
            <T w="light" size={16} color={C.sec} style={{ marginTop: 6 }}>{t('absentSub')}</T>
            <View style={{ marginTop: 16, flexDirection: 'row', gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.tint }}>
              <Icon name="move" size={22} color={C.link} />
              <View style={{ flex: 1 }}>
                <T w="heavy" size={16}>{t('moveNext')}</T>
                <T w="light" size={14} color={C.sec}>{t('moveNote')}</T>
              </View>
            </View>
            <View style={{ marginTop: 14 }}><SessionPicker doctorId={l.doctor.id} exclude={l.session.id} value={to} onChange={setTo} /></View>
          </>
        ) : null}
      </Page>
      <BottomBar>
        {err ? <T size={14} color={C.bad} style={{ marginBottom: 8 }}>{err}</T> : null}
        <Button title={t('moveHere')} onPress={submit} disabled={!to} loading={busy} />
      </BottomBar>
    </View>
  );
}


