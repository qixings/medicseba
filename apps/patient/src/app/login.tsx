import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { post, type ApiError } from '@/lib/api';
import { saveLang } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { C, F, num } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Button, T, tap } from '@/components/ui';

export default function Login() {
  const t = useT();
  const ins = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const digits = phone.replace(/\D/g, '');
  const valid = /^[6-9]\d{9}$/.test(digits);

  async function send() {
    setBusy(true); setErr('');
    try {
      const r = await post<{ ok: true; devCode?: string }>('/auth/otp/request', { phone: digits });
      router.push({ pathname: '/otp', params: { phone: digits, dev: r.devCode ?? '' } });
    } catch (e) {
      setErr((e as ApiError).message);
    } finally { setBusy(false); }
  }

  const pretty = digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingTop: ins.top + 16, paddingHorizontal: 24, paddingBottom: ins.bottom + 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={18} color={C.white} width={3} />
            </View>
            <T w="heavy" size={20} style={{ letterSpacing: -0.3 }}>{t('brand')}</T>
          </View>
          <Pressable accessibilityRole="button" onPress={() => { tap(); void saveLang(t.lang === 'en' ? 'bn' : 'en'); }}
            style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.white, justifyContent: 'center' }}>
            <T w="semibold" size={14}>{t('langToggle')}</T>
          </Pressable>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
          <T w="black" size={44} style={{ lineHeight: 47, letterSpacing: -1.5 }}>{t('loginTitle')}</T>
          <T w="light" size={18} color={C.sec} style={{ lineHeight: 26 }}>{t('loginSub')}</T>
        </View>

        <View style={{ borderRadius: 30, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, padding: 20, gap: 12 }}>
          <T w="bold" size={12} color={C.sec}>{t('mobile')}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ height: 56, paddingHorizontal: 16, borderRadius: 16, backgroundColor: C.bg, justifyContent: 'center' }}>
              <T w="light" size={19}>+91</T>
            </View>
            <TextInput
              accessibilityLabel={t('mobile')}
              value={pretty}
              onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(-10))}
              keyboardType="number-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              maxLength={11}
              placeholder="98765 43210"
              placeholderTextColor={C.faint}
              onSubmitEditing={() => valid && send()}
              style={[F.bold, num, { flex: 1, minWidth: 0, height: 56, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: C.field, fontSize: 19, color: C.ink }]}
            />
          </View>
          {err ? <T size={14} color={C.bad}>{err}</T> : null}
          <Button title={t('sendOtp')} onPress={send} disabled={!valid} loading={busy} />
          <T size={13} color={C.sec} style={{ textAlign: 'center', lineHeight: 18 }}>
            {t('otpNote')} <T w="bold" size={13} color={C.link}>{t('terms')}</T> {t('and')} <T w="bold" size={13} color={C.link}>{t('privacy')}</T>
          </T>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
