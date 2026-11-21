import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { post } from '@/lib/api';
import { useChamber, type ChamberDoctor } from '@/lib/chamber';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Avatar, Button, Card, Chip, Field, H1, Page, Status, T, tap } from '@/components/ui';
import { Requests } from '@/components/Requests';

const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];
const prettyTime = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

export default function Doctors() {
  const t = useT();
  const { data, error, reload } = useChamber();
  const [form, setForm] = useState<ChamberDoctor | 'new' | null>(null);
  const days = t.lang === 'bn' ? DAYS_BN : DAYS_EN;
  const doctorRequests = data?.requests.filter((r) => r.kind !== 'fees') ?? [];

  return (
    <>
      <Page tabs refresh={<RefreshControl refreshing={false} onRefresh={() => { void reload(); }} tintColor={C.deep} />} style={{ width: '100%', maxWidth: 760, alignSelf: 'center' }}>
        <H1 style={{ marginTop: 24 }}>{t('tabDoctors')}</H1>
        <T size={14} color={C.sec} style={{ marginTop: 6 }}>{t('doctorNote')}</T>
        <Status loading={!data && !error} error={error ? { message: error } : null} onRetry={reload} />
        {data ? (
          <>
            {data.doctors.length === 0 ? <Status empty={t('noDoctors')} /> : (
              <Card style={{ marginTop: 14, overflow: 'hidden' }}>
                {data.doctors.map((d, i) => (
                  <View key={d.id} style={[{ padding: 12, gap: 10 }, i < data.doctors.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Avatar name={d.name} uri={d.photoUrl} size={52} radius={16} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T w="heavy" size={16} lines={1}>{d.name}</T>
                        <T size={13} color={C.sec} lines={1}>{d.specialty}, {d.degrees}</T>
                        <T size={13} color={C.sec} lines={1}>{d.sitting.weekdays.map((w) => days[w]).join(' ')}, <T numeric w="bold" size={13}>{prettyTime(d.sitting.startTime)}</T>, {d.sitting.tokenLimit}</T>
                      </View>
                    </View>
                    <Pressable onPress={() => { tap(); setForm(d); }} style={{ alignSelf: 'flex-start', height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: C.bg, justifyContent: 'center' }}>
                      <T w="bold" size={13}>{t('suggestChanges')}</T>
                    </Pressable>
                  </View>
                ))}
              </Card>
            )}
            <Button title={t('addDoctor')} icon="plus" style={{ marginTop: 14 }} onPress={() => setForm('new')} />
            {doctorRequests.length ? <Requests list={doctorRequests} /> : null}
          </>
        ) : null}
      </Page>
      {form && data ? <DoctorForm d={form === 'new' ? null : form} specialties={data.specialties} onClose={() => setForm(null)} onSent={() => { setForm(null); void reload(); }} /> : null}
    </>
  );
}

function DoctorForm({ d, specialties, onClose, onSent }: { d: ChamberDoctor | null; specialties: { id: string; name: string }[]; onClose: () => void; onSent: () => void }) {
  const t = useT();
  const ins = useSafeAreaInsets();
  const days = t.lang === 'bn' ? DAYS_BN : DAYS_EN;
  const [name, setName] = useState(d?.name ?? 'Dr. ');
  const [degrees, setDegrees] = useState(d?.degrees ?? '');
  const [spec, setSpec] = useState(d?.specialtyId ?? specialties[0]?.id ?? '');
  const [exp, setExp] = useState(String(d?.experienceYears ?? ''));
  const [fee, setFee] = useState(String(d?.consultFee ?? ''));
  const [langs, setLangs] = useState(d?.languages.join(', ') ?? 'Bengali');
  const [bio, setBio] = useState(d?.bio ?? '');
  const [wd, setWd] = useState<number[]>(d?.sitting.weekdays ?? [1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(d?.sitting.startTime ?? '17:00');
  const [limit, setLimit] = useState(String(d?.sitting.tokenLimit ?? 30));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const ok = name.trim().length >= 4 && degrees.trim().length >= 2 && !!spec && /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && wd.length > 0 && Number(limit) > 0;

  async function send() {
    setBusy(true); setErr('');
    const doctor = { name: name.trim(), degrees: degrees.trim(), specialtyId: spec, experienceYears: Number(exp) || 0, consultFee: Number(fee) || 0, languages: langs.split(',').map((x) => x.trim()).filter(Boolean), bio: bio.trim() };
    const sitting = { weekdays: [...wd].sort(), startTime: start, tokenLimit: Number(limit) };
    try {
      if (d) await post('/agent/requests', { kind: 'doctor_update', targetId: d.id, data: { doctor, sitting: { scheduleId: d.sitting.scheduleId, ...sitting } } });
      else await post('/agent/requests', { kind: 'new_doctor', data: { doctor, sitting } });
      onSent();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,25,26,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ backgroundColor: C.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%', width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: ins.bottom + 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T w="heavy" size={20}>{d ? t('suggestChanges') : t('addDoctor')}</T>
              <Pressable onPress={onClose} accessibilityLabel={t('close')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={18} color={C.sec} /></Pressable>
            </View>
            <Field label={t('docName')} value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label={t('degrees')} value={degrees} onChangeText={setDegrees} placeholder="MBBS, MD (Medicine)" />
            <View style={{ gap: 6 }}>
              <T w="bold" size={12} color={C.sec}>{t('specialty')}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{specialties.map((s) => <Chip key={s.id} label={s.name} on={spec === s.id} onPress={() => setSpec(s.id)} />)}</View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label={t('experience')} value={exp} onChangeText={(v) => setExp(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><Field label={t('consultFee')} value={fee} onChangeText={(v) => setFee(v.replace(/\D/g, '').slice(0, 5))} keyboardType="number-pad" /></View>
            </View>
            <Field label={t('languages')} value={langs} onChangeText={setLangs} />
            <Field label={t('about')} value={bio} onChangeText={setBio} multiline style={{ height: 90, paddingTop: 12, fontSize: 16 }} />
            <View style={{ gap: 6 }}>
              <T w="bold" size={12} color={C.sec}>{t('days')}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((x) => <Chip key={x} label={days[x]} on={wd.includes(x)} onPress={() => setWd(wd.includes(x) ? wd.filter((y) => y !== x) : [...wd, x])} />)}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label={t('startTime')} value={start} onChangeText={(v) => setStart(v.replace(/[^\d:]/g, '').slice(0, 5))} keyboardType="numbers-and-punctuation" /></View>
              <View style={{ flex: 1 }}><Field label={t('serialsPerSitting')} value={limit} onChangeText={(v) => setLimit(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" /></View>
            </View>
            <T size={13} color={C.sec}>{t('doctorNote')}</T>
            {err ? <T size={14} color={C.bad}>{err}</T> : null}
            <Button title={t('sendForApproval')} onPress={send} loading={busy} disabled={!ok} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
