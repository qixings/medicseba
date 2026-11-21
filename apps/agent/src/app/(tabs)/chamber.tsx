import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { Image } from 'expo-image';
import { mediaUrl, patch, post, put } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { ask } from '@/lib/ask';
import { pickAndUploadPhoto, useChamber } from '@/lib/chamber';
import { setLang, useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Button, Card, Field, H1, Page, Segmented, Status, T, tap } from '@/components/ui';
import { Requests } from '@/components/Requests';

export default function Chamber() {
  const t = useT();
  const { data, error, reload } = useChamber();
  const [f, setF] = useState({ phone: '', address: '', area: '', landmark: '', openingHours: '' });
  const [fee, setFee] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Fill the form from the server, but never overwrite what the counter is typing when a live update arrives.
  const seeded = useRef<{ f: typeof f; fee: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    const c = data.chamber;
    const next = { phone: c.phone, address: c.address, area: c.area, landmark: c.landmark, openingHours: c.openingHours };
    const prev = seeded.current;
    setF((cur) => (!prev || JSON.stringify(cur) === JSON.stringify(prev.f) ? next : cur));
    setFee((cur) => (!prev || cur === prev.fee ? String(c.bookingFee) : cur));
    seeded.current = { f: next, fee: String(c.bookingFee) };
  }, [data]);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(ok); await reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  const c = data?.chamber;
  const changed = !!c && (f.phone !== c.phone || f.address !== c.address || f.area !== c.area || f.landmark !== c.landmark || f.openingHours !== c.openingHours);

  return (
    <Page tabs refresh={<RefreshControl refreshing={false} onRefresh={() => { void reload(); }} tintColor={C.deep} />} style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
      <H1 style={{ marginTop: 24 }}>{c?.name ?? t('tabChamber')}</H1>
      <Status loading={!data && !error} error={error ? { message: error } : null} onRetry={reload} />
      {c ? (
        <>
          {msg ? <T size={14} color={msg === t('saved') || msg === t('sentForApproval') ? C.good : C.bad} style={{ marginTop: 10 }}>{msg}</T> : null}

          <T w="heavy" size={18} style={{ marginTop: 20 }}>{t('photos')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {c.photos.map((p, i) => (
              <View key={p} style={{ width: '48%', aspectRatio: 4 / 3, overflow: 'hidden', backgroundColor: C.tint }}>
                <Image source={mediaUrl(p)} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                {i === 0 ? <View style={{ position: 'absolute', top: 6, left: 6, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: C.white, justifyContent: 'center' }}><T w="bold" size={11} color={C.link}>{t('cover')}</T></View> : null}
                <Pressable accessibilityLabel={t('deletePhoto')} onPress={async () => { tap(); if (await ask(`${t('deletePhoto')}?`, t('deletePhoto'), t('cancel'))) void run(() => put('/agent/chamber/photos', { photos: c.photos.filter((x) => x !== p) }), t('saved')); }}
                  style={{ position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,25,26,0.65)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="x" size={16} color={C.white} />
                </Pressable>
              </View>
            ))}
            {c.photos.length < 8 ? (
              <Pressable onPress={() => { tap(); void run(() => pickAndUploadPhoto(), t('saved')); }} accessibilityRole="button"
                style={{ width: '48%', aspectRatio: 4 / 3, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.field, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icon name="plus" size={22} color={C.link} width={2.6} />
                <T w="bold" size={14} color={C.link}>{t('addPhoto')}</T>
              </Pressable>
            ) : null}
          </View>

          <T w="heavy" size={18} style={{ marginTop: 22 }}>{t('details')}</T>
          <T size={13} color={C.sec} style={{ marginTop: 2 }}>{t('liveNote')}</T>
          <Card style={{ marginTop: 10, padding: 14, gap: 12 }}>
            <Field label={t('chamberPhone')} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
            <Field label={t('address')} value={f.address} onChangeText={set('address')} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label={t('area')} value={f.area} onChangeText={set('area')} /></View>
              <View style={{ flex: 1 }}><Field label={t('landmark')} value={f.landmark} onChangeText={set('landmark')} /></View>
            </View>
            <Field label={t('hours')} value={f.openingHours} onChangeText={set('openingHours')} />
            <Button title={t('saveChanges')} disabled={!changed} loading={busy} onPress={() => run(() => patch('/agent/chamber', f), t('saved'))} />
          </Card>

          <T w="heavy" size={18} style={{ marginTop: 22 }}>{t('bookingFeeLabel')}</T>
          <Card style={{ marginTop: 10, padding: 14, gap: 12 }}>
            <Field label={t('bookingFeeLabel')} value={fee} onChangeText={(v) => setFee(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
            <T size={13} color={C.sec}>{t('feeNote')}</T>
            <Button title={t('sendForApproval')} kind="secondary" disabled={!fee || Number(fee) === c.bookingFee} loading={busy} onPress={() => run(() => post('/agent/requests', { kind: 'fees', data: { bookingFee: Number(fee) } }), t('sentForApproval'))} />
          </Card>
          {data.requests.some((r) => r.kind === 'fees') ? <Requests list={data.requests.filter((r) => r.kind === 'fees')} /> : null}

          <T w="heavy" size={18} style={{ marginTop: 22 }}>{t('account')}</T>
          <Card style={{ marginTop: 10, padding: 14, gap: 12 }}>
            <T w="bold" size={12} color={C.sec}>{t('language')}</T>
            <Segmented value={t.lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} />
            <Button title={t('logout')} kind="danger" icon="logout" onPress={async () => { if (await ask(`${t('logout')}?`, t('logout'), t('cancel'))) void signOut(); }} />
          </Card>
        </>
      ) : null}
    </Page>
  );
}
