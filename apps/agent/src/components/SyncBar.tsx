import { View } from 'react-native';
import { dismissFailed, useCounter } from '@/lib/counter';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { Icon } from './Icon';
import { T } from './ui';

/** Shows when the counter is offline, how many actions are waiting, and anything the server refused. */
export function SyncBar() {
  const t = useT();
  const { online, outbox, failed, syncing } = useCounter((s) => s);
  if (online && !outbox.length && !failed.length) return null;
  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      {!online || outbox.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: online ? C.tint : C.warnBg }}>
          <Icon name={online ? 'refund' : 'alert'} size={18} color={online ? C.link : C.warn} />
          <T w="semibold" size={14} color={online ? C.link : C.warn} style={{ flex: 1 }}>
            {online ? t('syncing') : t('offline')}{outbox.length ? `  (${outbox.length} ${t('pending')})` : ''}
          </T>
          {syncing ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand }} /> : null}
        </View>
      ) : null}
      {failed.map((f) => (
        <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: C.badBg }}>
          <Icon name="alert" size={18} color={C.bad} />
          <T w="semibold" size={14} color={C.bad} style={{ flex: 1 }}>
            {t('failed')}: {f.action.kind === 'walkin' ? f.action.body.name : f.action.kind}. {f.error}
          </T>
          <T w="bold" size={14} color={C.bad} onPress={() => dismissFailed(f.id)}>{t('close')}</T>
        </View>
      ))}
    </View>
  );
}
