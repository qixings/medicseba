import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { act, newClientRef, useCounter, waitForNumber } from '@/lib/counter';
import { openReceipt, whatsappReceipt } from '@/lib/receipt';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Icon } from './Icon';
import { Button, Field, Segmented, T, tap } from './ui';

type Pay = 'NONE' | 'CASH' | 'UPI';

/**
 * Walk-in in two steps: fill the details and press Give serial; the next screen shows the serial big,
 * with Print receipt and WhatsApp, and Done closes it.
 */
export function WalkInSheet({ sessionId, doctor, open, onClose }: { sessionId: string; doctor?: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const ins = useSafeAreaInsets();
  const online = useCounter((s) => s.online);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');
  const [phone, setPhone] = useState('');
  const [pay, setPay] = useState<Pay>('CASH');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ number: number | null; name: string; ref: string; phone: string } | null>(null);
  const [msg, setMsg] = useState('');

  const reset = () => { setName(''); setAge(''); setPhone(''); setGender('MALE'); setPay('CASH'); setAmount(''); setResult(null); setMsg(''); };
  const close = () => { reset(); onClose(); };

  async function give() {
    setBusy(true);
    const clientRef = newClientRef();
    const paid = pay !== 'NONE' && Number(amount) > 0;
    act(sessionId, { kind: 'walkin', body: {
      name: name.trim(), age: age ? Number(age) : undefined, gender, phone: phone.trim() || undefined, clientRef,
      paidAmount: paid ? Number(amount) : undefined, paidMethod: paid ? (pay as 'CASH' | 'UPI') : undefined,
    } });
    const number = await waitForNumber(sessionId, clientRef);
    setResult({ number, name: name.trim(), ref: clientRef, phone: phone.trim() });
    setBusy(false);
  }

  const tokenId = () => useCounter.getState().boards[sessionId]?.tokens.find((x) => x.clientRef === result?.ref && !x.pending)?.id;
  async function print() {
    const id = tokenId(); if (!id) { setMsg(t('receiptLater')); return; }
    try { await openReceipt(id); } catch (e) { setMsg((e as Error).message); }
  }
  async function whatsapp() {
    const id = tokenId(); if (!id) { setMsg(t('receiptLater')); return; }
    setBusy(true);
    try { await whatsappReceipt(id, result?.phone); setMsg(t('sentWhatsApp')); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,25,26,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel={t('close')} />
        <View style={{ backgroundColor: C.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%', width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: ins.bottom + 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T w="heavy" size={20}>{result ? t('tokenGiven') : t('walkInTitle')}</T>
                {doctor ? <T size={13} color={C.sec}>{doctor}</T> : null}
              </View>
              <Pressable onPress={close} accessibilityLabel={t('close')} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="x" size={18} color={C.sec} />
              </Pressable>
            </View>
            {result ? (
              <>
                <View style={{ borderRadius: 24, backgroundColor: C.night, padding: 18, alignItems: 'center' }}>
                  <T w="bold" size={12} color="rgba(255,255,255,0.6)">{t('serialWord')}</T>
                  <T numeric w="black" size={result.number ? 96 : 40} color={C.white} style={{ lineHeight: result.number ? 96 : 48 }}>{result.number ?? '…'}</T>
                  <T w="heavy" size={18} color={C.white}>{result.name}</T>
                </View>
                <T size={15} color={C.sec} style={{ textAlign: 'center' }}>{result.number ? t('tellPatient') : t('pendingNumber')}</T>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button title={t('printReceipt')} icon="receipt" kind="secondary" style={{ flex: 1 }} disabled={!online || !result.number} onPress={print} />
                  {result.phone ? <Button title="WhatsApp" icon="phone" kind="secondary" style={{ flex: 1 }} disabled={!online || !result.number || busy} onPress={whatsapp} /> : null}
                </View>
                {msg ? <T size={14} color={msg === t('sentWhatsApp') ? C.good : C.warn} style={{ textAlign: 'center' }}>{msg}</T> : null}
                <Button title={t('finish')} onPress={close} />
                <T w="bold" size={15} color={C.link} style={{ textAlign: 'center', paddingVertical: 4 }} onPress={() => { tap(); reset(); }}>{t('addAnother')}</T>
              </>
            ) : (
              <>
                <Field label={t('name')} value={name} onChangeText={setName} autoCapitalize="words" autoFocus />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ width: 100 }}><Field label={t('age')} value={age} onChangeText={(v) => setAge(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" /></View>
                  <View style={{ flex: 1 }}><Field label={t('whatsappNo')} value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d+]/g, '').slice(0, 13))} keyboardType="phone-pad" /></View>
                </View>
                <Segmented value={gender} onChange={setGender} options={[{ value: 'MALE', label: t('male') }, { value: 'FEMALE', label: t('female') }, { value: 'OTHER', label: t('other') }]} />
                <View style={{ gap: 6 }}>
                  <T w="bold" size={12} color={C.sec}>{t('payment')}</T>
                  <Segmented value={pay} onChange={setPay} options={[{ value: 'CASH', label: t('cash') }, { value: 'UPI', label: t('upi') }, { value: 'NONE', label: t('notPaid') }]} />
                </View>
                {pay !== 'NONE' ? <Field label={t('amount')} value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="300" /> : null}
                <Button title={t('giveToken')} onPress={give} loading={busy} disabled={name.trim().length < 2} />
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
