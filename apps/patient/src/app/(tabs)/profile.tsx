import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { loadMe, saveLang, signOut, useAuth } from '@/lib/auth';
import { patch } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar, Button, Card, Field, H1, Page, Row, Segmented, T, tap } from '@/components/ui';

const ic = (name: IconName) => (
  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={name} size={19} color={C.link} width={2.2} />
  </View>
);

export default function Profile() {
  const t = useT();
  const me = useAuth((s) => s.me);
  const phone = me?.phone.replace(/^\+91/, '') ?? '';

  return (
    <Page tabs>
      <H1 style={{ marginTop: 30 }}>{t('profile')}</H1>
      <NameCard name={me?.name ?? ''} phone={phone} />

      <Card style={{ marginTop: 12, overflow: 'hidden' }}>
        <Row left={ic('users')} title={t('family')} onPress={() => router.push('/family')} />
        <Row left={ic('bell')} title={t('notifications')} onPress={() => router.push('/notifications')} />
        <Row left={ic('cal')} title={t('bookings')} onPress={() => router.push('/bookings')} last />
      </Card>

      <Card style={{ marginTop: 12, padding: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {ic('globe')}
          <T w="heavy" size={16}>{t('language')}</T>
        </View>
        <Segmented value={t.lang} onChange={(l) => void saveLang(l)} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} />
      </Card>

      <Card style={{ marginTop: 12, overflow: 'hidden' }}>
        <Row left={ic('help')} title={t('help')} onPress={() => Linking.openURL('https://wa.me/910000000000')} />
        <Row left={ic('doc')} title={t('terms')} onPress={() => {}} />
        <Row left={ic('doc')} title={t('privacy')} onPress={() => {}} last />
      </Card>

      <Card style={{ marginTop: 12, overflow: 'hidden' }}>
        <Row left={<View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.badBg, alignItems: 'center', justifyContent: 'center' }}><Icon name="logout" size={19} color={C.bad} /></View>}
          title={t('logout')} onPress={() => void signOut()} right={<View />} last />
      </Card>
    </Page>
  );
}

/** Name and phone, with a pencil to rename. The phone number is the login, so it stays fixed. */
function NameCard({ name, phone }: { name: string; phone: string }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = value.trim().length >= 2 && value.trim() !== name;

  async function save() {
    setBusy(true); setErr('');
    try { await patch('/me', { name: value.trim() }); await loadMe(); setEditing(false); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <Card style={{ marginTop: 14, padding: 14, gap: 12 }}>
        <Field label={t('fullName')} value={value} onChangeText={setValue} autoCapitalize="words" autoFocus maxLength={60} onSubmitEditing={() => { if (ok) void save(); }} />
        <T size={13} color={C.sec}>{t('nameNote')}</T>
        {err ? <T size={14} color={C.bad}>{err}</T> : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title={t('keepName')} kind="secondary" style={{ flex: 1 }} onPress={() => { setValue(name); setEditing(false); setErr(''); }} />
          <Button title={t('save')} style={{ flex: 1 }} loading={busy} disabled={!ok} onPress={save} />
        </View>
      </Card>
    );
  }
  return (
    <Card style={{ marginTop: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Avatar name={name || '?'} size={60} radius={20} bg={C.brand} fg={C.white} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T w="heavy" size={20} lines={1} style={{ letterSpacing: -0.4 }}>{name}</T>
        <T numeric w="light" size={15} color={C.sec}>+91 {phone.slice(0, 5)} {phone.slice(5)}</T>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('editName')} onPress={() => { tap(); setValue(name); setEditing(true); }} hitSlop={8}
        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="edit" size={18} color={C.link} width={2.2} />
      </Pressable>
    </Card>
  );
}
