import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { act, type SessionRow } from '@/lib/counter';
import { ask } from '@/lib/ask';
import { useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import { T, tap } from './ui';

/** On/off switch for a sitting: green while it runs, red once ended. Ending and turning back on both ask first. */
export function SittingSwitch({ s }: { s: Pick<SessionRow, 'id' | 'status'> }) {
  const t = useT();
  const on = s.status === 'OPEN' || s.status === 'CLOSED';
  const cancelled = s.status === 'CANCELLED';
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(on ? 22 : 0, { duration: 180 }) }] }));
  async function toggle() {
    tap();
    if (cancelled) return;
    if (on) { if (await ask(t('endAsk'), t('yesSure'), t('cancel'))) act(s.id, { kind: 'status', body: { status: 'ENDED' } }); }
    else if (await ask(t('resumeAsk'), t('yesSure'), t('cancel'))) act(s.id, { kind: 'resume' });
  }
  return (
    <Pressable onPress={toggle} disabled={cancelled} accessibilityRole="switch" accessibilityState={{ checked: on, disabled: cancelled }} accessibilityLabel={on ? t('sittingOn') : t('sittingOff')} hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <T w="heavy" size={12} color={on ? C.good : C.bad}>{cancelled ? t('cancelled') : on ? t('sittingOn') : t('sittingOff')}</T>
      <View style={{ width: 46, height: 26, borderRadius: 13, padding: 3, backgroundColor: on ? C.good : C.bad, opacity: cancelled ? 0.5 : 1 }}>
        <Animated.View style={[{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.white }, knob]} />
      </View>
    </Pressable>
  );
}
