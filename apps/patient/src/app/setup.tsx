import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { patch, type ApiError } from '@/lib/api';
import { loadMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Button, Field, H1, Page, Segmented, T } from '@/components/ui';

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export default function Setup() {
  const t = useT();
  const ins = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender>('MALE');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = name.trim().length >= 2 && Number(age) > 0 && Number(age) < 120;

  async function save() {
    setBusy(true); setErr('');
    try {
      await patch('/me', { name: name.trim(), age: Number(age), gender });
      await loadMe();
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <Page style={{ paddingTop: ins.top + 40, gap: 16 }}>
        <H1>{t('setupTitle')}</H1>
        <T w="light" size={17} color={C.sec} style={{ marginTop: -8 }}>{t('setupSub')}</T>
        <Field label={t('fullName')} value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" autoComplete="name" placeholder="Rahul Das" />
        <Field label={t('age')} value={age} onChangeText={(v) => setAge(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" placeholder="32" />
        <View style={{ gap: 6 }}>
          <T w="bold" size={12} color={C.sec}>{t('gender')}</T>
          <Segmented value={gender} onChange={setGender} options={[{ value: 'MALE', label: t('male') }, { value: 'FEMALE', label: t('female') }, { value: 'OTHER', label: t('other') }]} />
        </View>
        {err ? <T size={14} color={C.bad}>{err}</T> : null}
        <Button title={t('continue')} onPress={save} disabled={!ok} loading={busy} style={{ marginTop: 8 }} />
      </Page>
    </KeyboardAvoidingView>
  );
}
