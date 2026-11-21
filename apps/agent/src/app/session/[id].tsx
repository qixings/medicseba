import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { act, newClientRef, refreshBoard, useCounter, waitForNumber, type DoctorStatus, type TokenRow } from '@/lib/counter';
import { useLiveBoard } from '@/lib/live';
import { useT, type Key } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { SyncBar } from '@/components/SyncBar';
import { Avatar, Button, Card, Chip, Field, Segmented, Status, T, TopBar, tap } from '@/components/ui';

function ask(msg: string, yes: string, no: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(msg) ?? false);
  return new Promise((res) => Alert.alert('', msg, [{ text: no, style: 'cancel', onPress: () => res(false) }, { text: yes, style: 'destructive', onPress: () => res(true) }]));
}

type Tab = 'waiting' | 'missed' | 'done';

export default function Board() {
  const t = useT();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const { id } = useLocalSearchParams<{ id: string }>();
  const board = useCounter((s) => s.boards[id]);
  const [tab, setTab] = useState<Tab>('waiting');
  const [walkIn, setWalkIn] = useState(false);
  const [lateOpen, setLateOpen] = useState(false);
  const [loaded, setLoaded] = useState(!!board);
  useEffect(() => { void refreshBoard(id).then(() => setLoaded(true)); }, [id]);
  useLiveBoard(id);

  const groups = useMemo(() => {
    const ts = board?.tokens ?? [];
    return {
      serving: ts.find((x) => x.state === 'SERVING') ?? null,
      waiting: ts.filter((x) => x.state === 'BOOKED' || x.state === 'ARRIVED'),
      missed: ts.filter((x) => x.state === 'MISSED'),
      done: ts.filter((x) => x.state === 'DONE').reverse(),
    };
  }, [board]);

  if (!board) {
    return (
      <View style={{ flex: 1 }}>
        <TopBar title="" />
        <View style={{ paddingTop: ins.top + 80 }}><Status loading={!loaded} empty={loaded ? t('offline') : undefined} /></View>
      </View>
    );
  }

  const s = board.session;
  const over = s.status === 'ENDED' || s.status === 'CANCELLED';
  const nextUp = groups.waiting.find((x) => (x.number ?? 0) > s.servingNumber) ?? null;
  const next = (current: 'DONE' | 'MISSED') => act(id, { kind: 'next', body: { expect: s.servingNumber, current } });

  async function setStatus(status: DoctorStatus, lateMinutes?: number) {
    if (status === 'NOT_COMING' && !(await ask(t('notComingAsk'), t('yesSure'), t('cancel')))) return;
    if (status === 'ENDED' && !(await ask(t('endAsk'), t('yesSure'), t('cancel')))) return;
    act(id, { kind: 'status', body: { status, lateMinutes } });
  }

  const serving = (
    <View style={{ borderRadius: 28, backgroundColor: C.night, padding: 18, gap: 14, ...S.up }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T w="bold" size={14} color="rgba(255,255,255,0.75)">{t('nowServing')}</T>
        <T numeric w="bold" size={13} color="rgba(255,255,255,0.6)">{t('waiting')} {groups.waiting.length}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
        {groups.serving?.number ?? s.servingNumber ? <T numeric w="black" size={96} color={C.white} style={{ lineHeight: 92, letterSpacing: -4 }}>{groups.serving?.number ?? s.servingNumber}</T> : null}
        <View style={{ flex: 1, paddingBottom: 8 }}>
          {groups.serving ? (
            <>
              <T w="heavy" size={20} color={C.white} lines={1}>{groups.serving.patientName}</T>
              <T w="medium" size={14} color="rgba(255,255,255,0.7)">{t(`src_${groups.serving.source}` as Key)}{groups.serving.patientAge ? `, ${groups.serving.patientAge}` : ''}</T>
            </>
          ) : <T w="heavy" size={28} color="rgba(255,255,255,0.75)">{t('notStarted')}</T>}
        </View>
      </View>
      {nextUp ? <T w="medium" size={14} color={C.brand}>{t('next')}: <T numeric w="black" size={14} color={C.brand}>{nextUp.number ?? '…'}</T> {nextUp.patientName}</T> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={t('next')} icon="chev" style={{ flex: 1.4, height: 60 }} disabled={over || (!nextUp && !groups.serving)} onPress={() => next('DONE')} />
        <Button title={t('missedNext')} kind="night" style={{ flex: 1, height: 60, backgroundColor: 'rgba(255,255,255,0.1)' }} disabled={over || !groups.serving} onPress={() => next('MISSED')} />
      </View>
    </View>
  );

  const statusRow = (
    <Card style={{ padding: 14, gap: 10 }}>
      <T w="heavy" size={16}>{t('doctor')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['ON_TIME', 'ARRIVED', 'BREAK'] as DoctorStatus[]).map((st) => (
          <Chip key={st} label={t(`st_${st}` as Key)} on={s.doctorStatus === st} onPress={() => !over && setStatus(st)} />
        ))}
        <Chip label={s.doctorStatus === 'LATE' ? `${t('st_LATE')} ${s.lateMinutes} ${t('min')}` : t('st_LATE')} on={s.doctorStatus === 'LATE' || lateOpen} onPress={() => !over && setLateOpen(!lateOpen)} />
        <Chip label={t('st_ENDED')} on={s.doctorStatus === 'ENDED'} onPress={() => !over && setStatus('ENDED')} />
      </View>
      {lateOpen ? (
        <View style={{ gap: 8 }}>
          <T size={13} color={C.sec}>{t('lateBy')}</T>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {[15, 30, 45, 60, 90].map((m) => <Chip key={m} label={`${m} ${t('min')}`} on={s.doctorStatus === 'LATE' && s.lateMinutes === m} onPress={() => { setLateOpen(false); void setStatus('LATE', m); }} />)}
          </View>
        </View>
      ) : null}
      {!over ? (
        <Pressable onPress={() => { tap(); void setStatus('NOT_COMING'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 }}>
          <Icon name="alert" size={16} color={C.bad} />
          <T w="bold" size={14} color={C.bad}>{t('st_NOT_COMING')}</T>
        </Pressable>
      ) : <T w="bold" size={14} color={s.status === 'CANCELLED' ? C.bad : C.sec}>{s.status === 'CANCELLED' ? t('cancelled') : t('ended')}</T>}
    </Card>
  );

  const counts = (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {[[t('online'), `${s.onlineTaken}/${s.onlineLimit}`], [t('counter'), s.counterTaken], [t('left'), Math.max(0, s.tokenLimit - s.onlineTaken - s.counterTaken)]].map(([l, v]) => (
        <Card key={String(l)} style={{ flex: 1, padding: 10 }}>
          <T numeric w="black" size={20}>{v}</T>
          <T w="medium" size={12} color={C.sec}>{l}</T>
        </Card>
      ))}
    </View>
  );

  const booking = !over ? (
    <View style={{ gap: 8 }}>
      {s.status === 'CLOSED' ? <T size={13} color={C.warn} style={{ textAlign: 'center' }}>{t('bookingClosed')}</T> : null}
      <Button kind="secondary" title={s.status === 'CLOSED' ? t('reopenBooking') : t('closeBooking')} onPress={() => act(id, { kind: s.status === 'CLOSED' ? 'reopen' : 'close' })} />
    </View>
  ) : null;

  const list = { waiting: groups.waiting, missed: groups.missed, done: groups.done }[tab];
  const queue = (
    <View style={{ gap: 10 }}>
      <Segmented value={tab} onChange={setTab} options={[
        { value: 'waiting', label: `${t('waiting')} ${groups.waiting.length}` },
        { value: 'missed', label: `${t('missed')} ${groups.missed.length}` },
        { value: 'done', label: `${t('done')} ${groups.done.length}` },
      ]} />
      {list.length === 0 ? <T size={15} color={C.sec} style={{ textAlign: 'center', paddingVertical: 24 }}>{t(tab === 'waiting' ? 'noneWaiting' : tab === 'missed' ? 'noneMissed' : 'noneDone')}</T> : (
        <Card style={{ overflow: 'hidden' }}>
          {list.map((x, i) => <TokenLine key={x.id} x={x} last={i === list.length - 1} disabled={over} onAct={(a) => act(id, { kind: 'token', tokenId: x.id, action: a })} />)}
        </Card>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={`${s.doctor.name}, ${s.time}`} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: ins.top + 70, paddingHorizontal: 16, paddingBottom: ins.bottom + 110, width: '100%', maxWidth: 1180, alignSelf: 'center' }}>
        <SyncBar />
        {wide ? (
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 12 }}>{serving}{counts}{statusRow}{booking}</View>
            <View style={{ flex: 1.1 }}>{queue}</View>
          </View>
        ) : (
          <View style={{ gap: 12 }}>{serving}{counts}{queue}{statusRow}{booking}</View>
        )}
      </ScrollView>
      {!over ? (
        <View style={{ position: 'absolute', right: 16, bottom: ins.bottom + 18 }}>
          <Button title={t('addWalkIn')} icon="plus" kind="night" style={{ height: 58, borderRadius: 29, paddingHorizontal: 22, ...S.up }} onPress={() => setWalkIn(true)} />
        </View>
      ) : null}
      <WalkInSheet sessionId={id} open={walkIn} onClose={() => setWalkIn(false)} />
    </View>
  );
}

function TokenLine({ x, last, disabled, onAct }: { x: TokenRow; last: boolean; disabled: boolean; onAct: (a: 'arrived' | 'missed' | 'done' | 'call' | 'restore') => void }) {
  const t = useT();
  const { width } = useWindowDimensions();
  // On phones the buttons go under the name so the name stays readable.
  const stacked = width < 560;
  const small = (label: string, a: 'arrived' | 'missed' | 'call' | 'restore', tone: 'teal' | 'plain' = 'plain') => (
    <Pressable key={a} disabled={disabled || x.pending} onPress={() => { tap(); onAct(a); }} accessibilityRole="button"
      style={{ height: 36, paddingHorizontal: 12, borderRadius: 12, justifyContent: 'center', backgroundColor: tone === 'teal' ? C.brand : C.bg, opacity: disabled || x.pending ? 0.5 : 1 }}>
      <T w="bold" size={13} color={tone === 'teal' ? C.white : C.ink}>{label}</T>
    </Pressable>
  );
  return (
    <View style={[{ flexDirection: 'row', flexWrap: stacked ? 'wrap' : 'nowrap', alignItems: 'center', gap: 12, padding: 12 }, !last && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
      <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: x.state === 'ARRIVED' ? C.tint : C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <T numeric w="black" size={x.number ? 22 : 16} color={x.state === 'ARRIVED' ? C.link : C.ink}>{x.number ?? '…'}</T>
      </View>
      <View style={{ flex: 1, minWidth: stacked ? 160 : 0 }}>
        <T w="heavy" size={16} lines={1}>{x.patientName}</T>
        <T size={13} color={C.sec} lines={1}>
          {t(`src_${x.source}` as Key)}{x.patientAge ? `, ${x.patientAge}` : ''}{x.state === 'ARRIVED' ? `, ${t('arrived').toLowerCase()}` : ''}{x.pending ? `, ${t('pending')}` : ''}
        </T>
      </View>
      <View style={[{ flexDirection: 'row', gap: 6 }, stacked && { width: '100%', paddingLeft: 64 }]}>
        {x.state === 'BOOKED' ? small(t('arrived'), 'arrived') : null}
        {x.state === 'BOOKED' || x.state === 'ARRIVED' ? small(t('markMissed'), 'missed') : null}
        {x.state === 'MISSED' ? small(t('restore'), 'restore') : null}
        {x.state === 'MISSED' || x.state === 'BOOKED' || x.state === 'ARRIVED' ? small(t('callNow'), 'call', 'teal') : null}
        {x.state === 'DONE' ? <Avatar name={x.patientName} size={30} /> : null}
      </View>
    </View>
  );
}

function WalkInSheet({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const ins = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ number: number | null; name: string } | null>(null);

  const reset = () => { setName(''); setAge(''); setPhone(''); setGender('MALE'); setResult(null); };
  const close = () => { reset(); onClose(); };

  async function give() {
    setBusy(true);
    const clientRef = newClientRef();
    const body = { name: name.trim(), age: age ? Number(age) : undefined, gender, phone: phone.trim() || undefined, clientRef };
    act(sessionId, { kind: 'walkin', body });
    const number = await waitForNumber(sessionId, clientRef);
    setResult({ number, name: body.name });
    setBusy(false);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,25,26,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel={t('close')} />
        <View style={{ backgroundColor: C.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: ins.bottom + 20, gap: 14, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          {result ? (
            <>
              <T w="heavy" size={20}>{t('tokenGiven')}</T>
              <View style={{ borderRadius: 24, backgroundColor: C.night, padding: 18, alignItems: 'center' }}>
                <T numeric w="black" size={result.number ? 96 : 40} color={C.white} style={{ lineHeight: result.number ? 96 : 48 }}>{result.number ?? '…'}</T>
                <T w="heavy" size={18} color={C.white}>{result.name}</T>
              </View>
              <T size={15} color={C.sec} style={{ textAlign: 'center' }}>{result.number ? t('tellPatient') : t('pendingNumber')}</T>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title={t('close')} kind="secondary" style={{ flex: 1 }} onPress={close} />
                <Button title={t('addWalkIn')} style={{ flex: 1 }} onPress={reset} />
              </View>
            </>
          ) : (
            <>
              <T w="heavy" size={20}>{t('walkInTitle')}</T>
              <Field label={t('name')} value={name} onChangeText={setName} autoCapitalize="words" autoFocus />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ width: 110 }}><Field label={t('age')} value={age} onChangeText={(v) => setAge(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" /></View>
                <View style={{ flex: 1 }}><Field label={t('phone')} value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d+]/g, '').slice(0, 13))} keyboardType="phone-pad" /></View>
              </View>
              <Segmented value={gender} onChange={setGender} options={[{ value: 'MALE', label: t('male') }, { value: 'FEMALE', label: t('female') }, { value: 'OTHER', label: t('other') }]} />
              <Button title={t('giveToken')} onPress={give} loading={busy} disabled={name.trim().length < 2} />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
