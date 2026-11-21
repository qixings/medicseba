import { View } from 'react-native';
import type { Request } from '@/lib/chamber';
import { useT, type Key } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Card, Pill, T } from './ui';

/** Changes the chamber sent to MedicSeba, with their approval status. */
export function Requests({ list }: { list: Request[] }) {
  const t = useT();
  return (
    <View style={{ marginTop: 22, gap: 10 }}>
      <T w="heavy" size={18}>{t('requests')}</T>
      <Card style={{ overflow: 'hidden' }}>
        {list.map((r, i) => (
          <View key={r.id} style={[{ padding: 12, gap: 4 }, i < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <T w="bold" size={15} style={{ flex: 1 }} lines={1}>
                {r.kind === 'fees' ? `${t('bookingFeeLabel')}: ₹${r.data.bookingFee}` : r.kind === 'new_doctor' ? `${t('addDoctor')}: ${r.data.doctor?.name}` : `${t('suggestChanges')}: ${r.data.doctor?.name ?? ''}`}
              </T>
              <Pill text={t(`st_${r.status}` as Key)} tone={r.status === 'APPROVED' ? 'good' : r.status === 'REJECTED' ? 'bad' : 'warn'} />
            </View>
            {r.note ? <T size={13} color={C.bad}>{r.note}</T> : null}
          </View>
        ))}
      </Card>
    </View>
  );
}

