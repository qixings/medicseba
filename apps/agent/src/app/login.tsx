import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiError } from '@/lib/api';
import { signIn } from '@/lib/auth';
import { setLang, useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Icon } from '@/components/Icon';
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: C.night, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={18} color={C.brand} width={3} />
            </View>
            <T w="heavy" size={20} style={{ letterSpacing: -0.3 }}>{t('brand')}</T>
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
