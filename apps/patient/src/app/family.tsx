import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { del, patch, post, type ApiError } from '@/lib/api';
import { loadMe } from '@/lib/auth';
import { invalidate, useApi } from '@/lib/query';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Member } from '@/lib/types';
import { Avatar, Button, Card, Field, H1, Page, Row, Segmented, Status, T, TopBar } from '@/components/ui';

type G = Member['gender'];
const empty = { name: '', age: '', gender: 'MALE' as G, relation: '' };

export default function Family() {
  const t = useT();
  const q = useApi<Member[]>('/me/members');
  const [form, setForm] = useState<typeof empty | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const gl = { MALE: t('male'), FEMALE: t('female'), OTHER: t('other') };

  async function save() {
    if (!form) return;
    setBusy(true); setErr('');
    const body = { name: form.name.trim(), age: Number(form.age), gender: form.gender, relation: form.relation.trim() || undefined };
    try {
      if (editing) await patch(`/me/members/${editing}`, body); else await post('/me/members', body);
      await invalidate('/me/members'); void loadMe();
      setForm(null); setEditing(null);
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  async function remove(m: Member) {
    const go = Platform.OS === 'web' ? globalThis.confirm?.(`${t('remove')} ${m.name}?`) : await new Promise<boolean>((res) =>
      Alert.alert('', `${t('remove')} ${m.name}?`, [{ text: t('keep'), style: 'cancel', onPress: () => res(false) }, { text: t('remove'), style: 'destructive', onPress: () => res(true) }]));
    if (!go) return;
    try { await del(`/me/members/${m.id}`); await invalidate('/me/members'); void loadMe(); } catch (e) { setErr((e as ApiError).message); }
  }

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={t('family')} />
      <Page bar>
        <H1 size={28}>{t('family')}</H1>
        <T w="light" size={15} color={C.sec} style={{ marginTop: 4 }}>{t('familySub')}</T>
        <Status loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
        {q.data ? (
          <Card style={{ marginTop: 14, overflow: 'hidden' }}>
            {q.data.map((m, i) => (
              <Row key={m.id} last={i === q.data!.length - 1}
                left={<Avatar name={m.name} size={44} bg={m.isSelf ? C.brand : C.tint} fg={m.isSelf ? C.white : C.link} />}
                title={m.isSelf ? `${m.name} (${t('you')})` : m.name}
                sub={`${m.age}, ${gl[m.gender]}${m.relation ? `, ${m.relation}` : ''}`}
                onPress={() => { setEditing(m.id); setForm({ name: m.name, age: String(m.age), gender: m.gender, relation: m.relation ?? '' }); }}
                right={m.isSelf ? undefined : <T w="bold" size={14} color={C.bad} onPress={() => remove(m)}>{t('remove')}</T>}
              />
            ))}
          </Card>
        ) : null}

        {form ? (
          <Card style={{ marginTop: 14, padding: 14, gap: 12 }}>
            <Field label={t('fullName')} value={form.name} onChangeText={(name) => setForm({ ...form, name })} autoCapitalize="words" />
            <Field label={t('age')} value={form.age} onChangeText={(v) => setForm({ ...form, age: v.replace(/\D/g, '').slice(0, 3) })} keyboardType="number-pad" />
            <Segmented value={form.gender} onChange={(gender) => setForm({ ...form, gender })} options={(['MALE', 'FEMALE', 'OTHER'] as G[]).map((v) => ({ value: v, label: gl[v] }))} />
            <Field label={t('relation')} value={form.relation} onChangeText={(relation) => setForm({ ...form, relation })} />
            {err ? <T size={14} color={C.bad}>{err}</T> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title={t('keep')} kind="secondary" style={{ flex: 1 }} onPress={() => { setForm(null); setEditing(null); setErr(''); }} />
              <Button title={t('save')} style={{ flex: 1 }} onPress={save} loading={busy} disabled={form.name.trim().length < 2 || !Number(form.age)} />
            </View>
          </Card>
        ) : (
          <Button title={t('addMember')} icon="plus" kind="secondary" style={{ marginTop: 14 }} disabled={(q.data?.length ?? 0) >= 10} onPress={() => { setEditing(null); setForm(empty); }} />
        )}
      </Page>
    </View>
  );
}
