import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { post, type ApiError } from '@/lib/api';
import { invalidate, useApi } from '@/lib/query';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Live } from '@/lib/types';
import { Icon, type IconName } from '@/components/Icon';
import { SessionPicker } from '@/components/SessionPicker';
import { BottomBar, Button, H1, Page, Status, T, TopBar, tap } from '@/components/ui';

export default function Absent() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<Live>(`/bookings/${id}/live`);
  const [choice, setChoice] = useState<'refund' | 'move' | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const l = q.data;

  async function submit() {
    setBusy(true); setErr('');
    try {
      const r = await post<Live>(`/bookings/${id}/absent-choice`, choice === 'move' ? { choice, sessionId: to } : { choice });
      void invalidate('/bookings'); void invalidate('/home');
      router.replace(choice === 'move' ? `/live/${r.token.id}` : '/bookings');
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  const option = (v: 'refund' | 'move', icon: IconName, title: string, note: string) => {
    const on = choice === v;
    return (
      <Pressable onPress={() => { tap(); setChoice(v); }} accessibilityRole="radio" accessibilityState={{ checked: on }}
        style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.white, borderWidth: on ? 2 : 1, borderColor: on ? C.brand : C.line }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: on ? C.brand : C.tint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={22} color={on ? C.white : C.link} />
        </View>
        <View style={{ flex: 1 }}>
          <T w="heavy" size={17}>{title}</T>
          <T w="light" size={14} color={C.sec}>{note}</T>
        </View>
      </Pressable>
    );
  };

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
            <View style={{ marginTop: 16, gap: 10 }}>
              {option('refund', 'refund', t('refundFull'), t('refundNote'))}
              {option('move', 'move', t('moveNext'), t('moveNote'))}
            </View>
            {choice === 'move' ? <View style={{ marginTop: 14 }}><SessionPicker doctorId={l.doctor.id} exclude={l.session.id} value={to} onChange={setTo} /></View> : null}
          </>
        ) : null}
      </Page>
      <BottomBar>
        {err ? <T size={14} color={C.bad} style={{ marginBottom: 8 }}>{err}</T> : null}
        <Button title={choice === 'move' ? t('moveHere') : t('refundFull')} onPress={submit} disabled={!choice || (choice === 'move' && !to)} loading={busy} />
      </BottomBar>
    </View>
  );
}


