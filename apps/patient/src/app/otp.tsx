import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { post, type ApiError } from '@/lib/api';
import { signIn } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Button, H1, T, TopBar, tap } from '@/components/ui';

export default function Otp() {
  const t = useT();
  const ins = useSafeAreaInsets();
  const { phone, dev } = useLocalSearchParams<{ phone: string; dev?: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(30);
  const [devCode, setDevCode] = useState(dev ?? '');
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function verify(c = code) {
    if (c.length !== 6) return;
    setBusy(true); setErr('');
    try {
      const r = await post<{ token: string }>('/auth/otp/verify', { phone, code: c });
      await signIn(r.token);
      // The layout moves on to setup or home by itself.
    } catch (e) {
      setErr((e as ApiError).message);
      setCode('');
    } finally { setBusy(false); }
  }

  async function resend() {
    tap();
    try {
      const r = await post<{ devCode?: string }>('/auth/otp/request', { phone });
      setDevCode(r.devCode ?? ''); setWait(30); setErr('');
    } catch (e) { setErr((e as ApiError).message); }
  }

  if (!phone) return <Redirect href="/login" />;
  const shown = `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar />
      <View style={{ flex: 1, paddingTop: ins.top + 90, paddingHorizontal: 24 }}>
        <H1>{t('enterCode')}</H1>
        <T w="light" size={17} color={C.sec} style={{ marginTop: 8, lineHeight: 24 }}>
          {t('sentTo')} <T numeric w="bold" size={17}>{shown}</T>{'  '}
          <T w="bold" size={17} color={C.link} onPress={() => router.back()}>{t('change')}</T>
        </T>
        <Pressable onPress={() => input.current?.focus()} style={{ marginTop: 32, flexDirection: 'row', gap: 8 }} accessibilityLabel="6-digit code">
          {Array.from({ length: 6 }, (_, i) => {
            const active = i === code.length;
            return (
              <View key={i} style={{ flex: 1, height: 60, borderRadius: 16, backgroundColor: C.white, borderWidth: active ? 2 : 1, borderColor: active ? C.brand : C.field, alignItems: 'center', justifyContent: 'center' }}>
                <T numeric w="heavy" size={28}>{code[i] ?? ''}</T>
              </View>
            );
          })}
        </Pressable>
        <TextInput
          ref={input}
          autoFocus
          value={code}
          onChangeText={(v) => { const c = v.replace(/\D/g, '').slice(0, 6); setCode(c); if (c.length === 6) void verify(c); }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
        />
        {err ? <T size={15} color={C.bad} style={{ marginTop: 14 }}>{err}</T> : null}
        {devCode ? <T size={13} color={C.faint} style={{ marginTop: 14 }}>Test code: {devCode}</T> : null}
        <View style={{ marginTop: 20 }}>
          {wait > 0
            ? <T size={15} color={C.sec}>{t('resendIn')} <T numeric w="bold" size={15}>0:{String(wait).padStart(2, '0')}</T></T>
            : <Pressable onPress={resend} hitSlop={8}><T w="bold" size={15} color={C.link}>{t('resend')}</T></Pressable>}
        </View>
      </View>
      <View style={{ paddingHorizontal: 24, paddingBottom: ins.bottom + 24 }}>
        <Button title={t('verify')} onPress={() => verify()} disabled={code.length !== 6} loading={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}
