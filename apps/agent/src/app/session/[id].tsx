import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { act, dismissNewBookings, refreshBoard, useCounter, type DoctorStatus, type TokenRow } from '@/lib/counter';
import { ask } from '@/lib/ask';
import { openReceipt } from '@/lib/receipt';
import { Inbox } from '@/components/Inbox';
import { SittingSwitch } from '@/components/SittingSwitch';
import { WalkInSheet } from '@/components/WalkInSheet';
import { useLiveBoard } from '@/lib/live';
import { useT, type Key } from '@/lib/i18n';
import { C, S } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { SyncBar } from '@/components/SyncBar';
import { Button, Card, Chip, Segmented, Status, T, TopBar, tap } from '@/components/ui';

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
  useEffect(() => { dismissNewBookings(id); }, [id, board?.tokens.length]);

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
  const nextUp = groups.waiting[0] ?? null;
  // 3/12: patients seen so far (including the one with the doctor) out of all serials given.
  const seen = board.tokens.filter((x) => x.state === 'DONE').length + (groups.serving ? 1 : 0);
  const total = board.tokens.filter((x) => ['BOOKED', 'ARRIVED', 'SERVING', 'DONE', 'MISSED', 'NO_SHOW'].includes(x.state)).length;
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
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center' }}>
          <T numeric w="black" size={16} color={C.brand}>{seen}</T>
          <T numeric w="bold" size={14} color="rgba(255,255,255,0.7)">/{total}</T>
        </View>
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
      {over ? <T w="medium" size={14} color="rgba(255,255,255,0.8)">{t('endedNote')}</T> : nextUp ? <T w="medium" size={14} color={C.brand}>{t('next')}: <T numeric w="black" size={14} color={C.brand}>{nextUp.number ?? '…'}</T> {nextUp.patientName}{nextUp.missCount ? ` (${t('backOfLine')})` : ''}</T> : null}
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
        {!over ? (
          <Pressable accessibilityRole="button" onPress={() => { tap(); void setStatus('NOT_COMING'); }}
            style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white, borderWidth: 1, borderColor: C.line }}>
            <T w="bold" size={14} color={C.bad}>{t('st_NOT_COMING')}</T>
          </Pressable>
        ) : null}
      </View>
      {lateOpen ? (
        <View style={{ gap: 8 }}>
          <T size={13} color={C.sec}>{t('lateBy')}</T>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {[15, 30, 45, 60, 90].map((m) => <Chip key={m} label={`${m} ${t('min')}`} on={s.doctorStatus === 'LATE' && s.lateMinutes === m} onPress={() => { setLateOpen(false); void setStatus('LATE', m); }} />)}
          </View>
        </View>
      ) : null}
      {over ? <T w="bold" size={14} color={s.status === 'CANCELLED' ? C.bad : C.sec}>{s.status === 'CANCELLED' ? t('cancelled') : t('ended')}</T> : null}
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
      <TopBar title={`${s.doctor.name}, ${s.time}`} right={<SittingSwitch s={s} />} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: ins.top + 70, paddingHorizontal: 16, paddingBottom: ins.bottom + 110, width: '100%', maxWidth: 1180, alignSelf: 'center' }}>
        <Inbox />
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
          <Button title={t('walkIn')} icon="plus" style={{ height: 58, borderRadius: 29, paddingHorizontal: 22, ...S.up }} onPress={() => setWalkIn(true)} />
        </View>
      ) : null}
      <WalkInSheet sessionId={id} doctor={`${s.doctor.name}, ${s.time}`} open={walkIn} onClose={() => setWalkIn(false)} />
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
          {t(`src_${x.source}` as Key)}{x.patientAge ? `, ${x.patientAge}` : ''}{x.state === 'ARRIVED' ? `, ${t('arrived').toLowerCase()}` : ''}{x.missCount && x.state !== 'MISSED' ? `, ${t('backOfLine')}` : ''}{x.paidAmount ? `, ₹${x.paidAmount} ${x.paidMethod === 'UPI' ? 'UPI' : t('cash').toLowerCase()}` : ''}{x.pending ? `, ${t('pending')}` : ''}
        </T>
      </View>
      <View style={[{ flexDirection: 'row', gap: 6 }, stacked && { width: '100%', paddingLeft: 64 }]}>
        {x.state === 'BOOKED' ? small(t('arrived'), 'arrived') : null}
        {x.state === 'BOOKED' || x.state === 'ARRIVED' ? small(t('markMissed'), 'missed') : null}
        {x.state === 'MISSED' ? small(t('restore'), 'restore') : null}
        {x.state === 'MISSED' || x.state === 'BOOKED' || x.state === 'ARRIVED' ? small(t('callNow'), 'call', 'teal') : null}
        {!x.pending ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('printReceipt')} onPress={() => { tap(); void openReceipt(x.id).catch(() => {}); }}
            style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
            <Icon name="receipt" size={17} color={C.sec} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
