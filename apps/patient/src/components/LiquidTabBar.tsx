import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { C } from '@/lib/theme';
import { useT, type Key } from '@/lib/i18n';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';
import { T, tap } from './ui';

const TABS: Record<string, { label: Key; icon: IconName }> = {
  index: { label: 'home', icon: 'home' },
  chambers: { label: 'chambers', icon: 'store' },
  bookings: { label: 'bookings', icon: 'cal' },
  profile: { label: 'profile', icon: 'user' },
};

const PAD = 12;
const LENS_H = 56; // tap area
const PILL_H = 48; // the visible glass pill
const INSET = 6; // pill sits a little inside each tab
const FAST = { duration: 260, easing: Easing.bezier(0.7, 0, 0.25, 1) };
const SLOW = { duration: 470, easing: Easing.bezier(0.6, 0, 0.2, 1) };

/**
 * Solid night tab bar. The glass lens behind the active tab moves like a drop of liquid:
 * its front edge leaves first and the back edge catches up, so it stretches thin while
 * travelling and settles back into a round pill.
 */
export function LiquidTabBar({ state, navigateToTab, insets }: BottomTabBarProps) {
  const t = useT();
  const [w, setW] = useState(0);
  const n = state.routes.length;
  const item = w ? (w - PAD * 2) / n : 0;
  const L = useSharedValue(0);
  const R = useSharedValue(0);
  const press = useSharedValue(1);
  const prev = useRef(state.index);

  useEffect(() => {
    if (!item) return;
    const l = PAD + state.index * item;
    const r = l + item;
    if (prev.current === state.index || L.value === 0) {
      L.value = l; R.value = r;
    } else if (state.index > prev.current) {
      R.value = withTiming(r, FAST); L.value = withTiming(l, SLOW);
    } else {
      L.value = withTiming(l, FAST); R.value = withTiming(r, SLOW);
    }
    prev.current = state.index;
  }, [state.index, item, L, R]);

  const lens = useAnimatedStyle(() => {
    const width = Math.max(1, R.value - L.value - INSET * 2);
    const rest = item - INSET * 2;
    const stretch = rest > 0 ? width / rest : 1;
    // Keep the area roughly the same: wider means thinner, like a real drop.
    const h = PILL_H / Math.sqrt(Math.max(1, stretch));
    return { left: L.value + INSET, width, height: h, top: 6 + (LENS_H - h) / 2, transform: [{ scale: press.value }] };
  });

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.night,
        paddingTop: 6, paddingHorizontal: PAD, paddingBottom: Math.max(insets.bottom, 10) + 4,
        borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
        shadowColor: C.night, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: -8 }, elevation: 12,
      }}
    >
      {item ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', borderRadius: 999, overflow: 'hidden' }, lens]}>
          <Glass dark style={{ flex: 1, borderRadius: 999 }} tint="rgba(43,63,66,0.55)" intensity={20} />
        </Animated.View>
      ) : null}
      <View style={{ flexDirection: 'row' }}>
        {state.routes.map((r, i) => {
          const cfg = TABS[r.name] ?? { label: 'home' as Key, icon: 'home' as IconName };
          const on = i === state.index;
          return (
            <Pressable
              key={r.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t(cfg.label)}
              onPressIn={() => { press.value = withTiming(0.94, { duration: 90 }); }}
              onPressOut={() => { press.value = withSequence(withTiming(1.04, { duration: 140 }), withTiming(1, { duration: 160 })); }}
              onPress={() => { if (!on) { tap(); navigateToTab(r.key); } }}
              style={{ flex: 1, height: LENS_H, alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              <Icon name={cfg.icon} size={22} color={on ? C.brand : 'rgba(255,255,255,0.72)'} width={on ? 2.4 : 2} />
              <T w={on ? 'heavy' : 'semibold'} size={11} color={on ? C.white : 'rgba(255,255,255,0.72)'}>{t(cfg.label)}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
