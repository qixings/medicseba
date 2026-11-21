import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiError } from '@/lib/api';
import { signIn } from '@/lib/auth';
import { setLang, useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Logo } from '@/components/Logo';
import { Button, Field, H1, T, tap } from '@/components/ui';

export default function Login() {
  const t = useT();
  const ins = useSafeAreaInsets();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go() {
    setBusy(true); setErr('');
    try { await signIn(user.trim(), pass); } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingTop: ins.top + 16, paddingHorizontal: 24, paddingBottom: ins.bottom + 24, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Logo height={26} />
            <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 6, backgroundColor: C.night, justifyContent: 'center', marginBottom: 1 }}>
              <T w="bold" size={12} color={C.white}>{t('counter')}</T>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={() => { tap(); setLang(t.lang === 'en' ? 'bn' : 'en'); }}
            style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, justifyContent: 'center' }}>
            <T w="semibold" size={14}>{t('langToggle')}</T>
          </Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: 10 }}>
          <H1 size={40}>{t('loginTitle')}</H1>
          <T w="light" size={17} color={C.sec}>{t('loginSub')}</T>
        </View>
        <View style={{ borderRadius: 28, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, padding: 20, gap: 14 }}>
          <Field label={t('username')} value={user} onChangeText={setUser} autoCapitalize="none" autoCorrect={false} autoComplete="username" placeholder="citymedicos" />
          <Field label={t('password')} value={pass} onChangeText={setPass} secureTextEntry autoComplete="password" onSubmitEditing={go} />
          {err ? <T size={14} color={C.bad}>{err}</T> : null}
          <Button title={t('signIn')} onPress={go} loading={busy} disabled={!user.trim() || !pass} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
