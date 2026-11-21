import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, S, card, num } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { mediaUrl } from '@/lib/api';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';

export const tap = () => { Haptics.selectionAsync().catch(() => {}); };

export function T({ style, children, w = 'regular', size = 15, color = C.ink, lines, numeric, onPress }: {
  style?: StyleProp<TextStyle>; children: React.ReactNode; w?: keyof typeof F; size?: number; color?: string; lines?: number; numeric?: boolean; onPress?: () => void;
}) {
  return (
    <Text onPress={onPress} suppressHighlighting numberOfLines={lines} style={[F[w], { fontSize: size, color, lineHeight: Math.round(size * 1.3) }, numeric && num, style]}>
      {children}
    </Text>
  );
}

export function H1({ children, size = 34, style }: { children: React.ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  return <T w="black" size={size} style={[{ letterSpacing: -size * 0.03, lineHeight: Math.round(size * 1.08) }, style]}>{children}</T>;
}

export function SectionHead({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: 24, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }, style]}>
      <T w="heavy" size={22} style={{ letterSpacing: -0.5 }}>{title}</T>
      {action ? <Pressable hitSlop={10} onPress={onAction}><T w="bold" size={15} color={C.link}>{action}</T></Pressable> : null}
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', loading, disabled, icon, style }: {
  title: string; onPress?: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'night'; loading?: boolean; disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>;
}) {
  const bg = { primary: C.brand, secondary: C.white, danger: C.white, night: C.night }[kind];
  const fg = { primary: C.white, secondary: C.ink, danger: C.bad, night: C.white }[kind];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={() => { tap(); onPress?.(); }}
      style={({ pressed }) => [
        { height: 54, borderRadius: 16, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
        kind === 'primary' ? S.btn : kind !== 'night' ? { borderWidth: 1, borderColor: C.field } : null,
        { opacity: off ? 0.55 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Icon name={icon} size={19} color={fg} width={2.4} /> : null}
          <T w="heavy" size={17} color={fg}>{title}</T>
        </>
      )}
    </Pressable>
  );
}

export function RoundButton({ icon, onPress, label, dot, dark }: { icon: IconName; onPress: () => void; label: string; dot?: boolean; dark?: boolean }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" hitSlop={6} onPress={() => { tap(); onPress(); }}>
      <Glass style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }} dark={dark}>
        <Icon name={icon} size={20} color={dark ? C.white : C.ink} width={2.2} />
        {dot ? <View style={{ position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand, borderWidth: 1.5, borderColor: C.white }} /> : null}
      </Glass>
    </Pressable>
  );
}

/** Light glass bar fixed at the top with a back button. */
export function TopBar({ title, right, onBack }: { title?: string; right?: React.ReactNode; onBack?: () => void }) {
  const ins = useSafeAreaInsets();
  return (
    <Glass style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: ins.top + 6, paddingBottom: 8, paddingHorizontal: 14, borderRadius: 0 }} tint="rgba(243,245,249,0.72)">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42 }}>
        <RoundButton icon="back" label="Back" onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'))} />
        <T w="heavy" size={17} lines={1} style={{ flex: 1 }}>{title ?? ''}</T>
        {right}
      </View>
    </Glass>
  );
}

export function useTopPad() {
  const ins = useSafeAreaInsets();
  return ins.top + 66;
}

/** Scrollable page. `bar` leaves room for a TopBar, `tabs` for the tab bar. */
export function Page({ children, bar, tabs, style, refresh }: {
  children: React.ReactNode; bar?: boolean; tabs?: boolean; style?: StyleProp<ViewStyle>; refresh?: React.ReactElement<React.ComponentProps<typeof import('react-native').RefreshControl>>;
}) {
  const ins = useSafeAreaInsets();
  const top = bar ? ins.top + 70 : ins.top + 12;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={[{ paddingTop: top, paddingHorizontal: 18, paddingBottom: (tabs ? 100 : 28) + ins.bottom }, style]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={refresh}
    >
      {children}
    </ScrollView>
  );
}

export function initials(name: string) {
  return name.replace(/^Dr\.?\s+/i, '').split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export function Avatar({ name, uri, size = 48, radius, bg = C.tint, fg = C.link }: { name: string; uri?: string | null; size?: number; radius?: number; bg?: string; fg?: string }) {
  const r = radius ?? size / 2;
  const src = mediaUrl(uri);
  // Cutout photos sit on the tint colour, framed from the top so the face shows.
  if (src) return <Image source={src} style={{ width: size, height: size, borderRadius: r, backgroundColor: bg === C.brand ? C.tint : bg }} contentFit="cover" contentPosition="top" accessibilityLabel={name} />;
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <T w="heavy" size={Math.round(size * 0.36)} color={fg}>{initials(name)}</T>
    </View>
  );
}

export function Pill({ text, tone = 'good' }: { text: string; tone?: 'good' | 'warn' | 'bad' | 'teal' | 'plain' }) {
  const m = { good: [C.goodBg, C.good], warn: [C.warnBg, C.warn], bad: [C.badBg, C.bad], teal: [C.tint, C.link], plain: [C.bg, C.sec] }[tone];
  return (
    <View style={{ height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: m[0], alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}>
      <T w="bold" size={12} color={m[1]}>{text}</T>
    </View>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (!onPress) return <View style={[card, style]}>{children}</View>;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [card, style, pressed && { transform: [{ scale: 0.985 }] }]}>
      {children}
    </Pressable>
  );
}

export function Row({ left, title, sub, right, onPress, last }: { left?: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean }) {
  return (
    <Pressable disabled={!onPress} onPress={() => { tap(); onPress?.(); }} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: pressed ? C.bg : 'transparent' }, !last && { borderBottomWidth: 1, borderBottomColor: C.line }]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T w="heavy" size={16} lines={1}>{title}</T>
        {sub ? <T w="light" size={14} color={C.sec} lines={1}>{sub}</T> : null}
      </View>
      {right ?? (onPress ? <Icon name="chev" size={18} color={C.faint} width={2.4} /> : null)}
    </Pressable>
  );
}

export function Field({ label, style, ...p }: TextInputProps & { label: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <T w="bold" size={12} color={C.sec}>{label}</T>
      <TextInput
        {...p}
        accessibilityLabel={label}
        placeholderTextColor={C.placeholder}
        onFocus={(e) => { setFocus(true); p.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); p.onBlur?.(e); }}
        style={[F.bold, { height: 54, borderRadius: 16, borderWidth: focus ? 2 : 1, borderColor: focus ? C.brand : C.field, backgroundColor: C.white, paddingHorizontal: 16, fontSize: 18, color: C.ink }, style]}
      />
    </View>
  );
}

export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: 'rgba(11,18,32,0.06)', borderRadius: 14, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { tap(); onChange(o.value); }}
            style={[{ flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, on && { backgroundColor: C.white, ...S.card }]}>
            <T w={on ? 'heavy' : 'semibold'} size={15} color={on ? C.ink : C.sec}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { tap(); onPress(); }}
      style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.night : C.white, borderWidth: 1, borderColor: on ? C.night : C.line }}>
      <T w="bold" size={14} color={on ? C.white : C.ink}>{label}</T>
    </Pressable>
  );
}

/** Loading, error and empty states. */
export function Status({ loading, error, onRetry, empty, emptyAction, onEmptyAction }: {
  loading?: boolean; error?: { message: string } | null; onRetry?: () => void; empty?: string; emptyAction?: string; onEmptyAction?: () => void;
}) {
  const t = useT();
  if (loading) return <View style={st.box}><ActivityIndicator color={C.deep} size="large" /></View>;
  if (error) return (
    <View style={st.box}>
      <T size={16} color={C.sec} style={{ textAlign: 'center' }}>{error.message}</T>
      {onRetry ? <Button kind="secondary" title={t('retry')} onPress={onRetry} style={{ marginTop: 14, alignSelf: 'center' }} /> : null}
    </View>
  );
  if (empty) return (
    <View style={st.box}>
      <T size={16} color={C.sec} style={{ textAlign: 'center' }}>{empty}</T>
      {emptyAction ? <Button title={emptyAction} onPress={onEmptyAction} style={{ marginTop: 14, alignSelf: 'center' }} /> : null}
    </View>
  );
  return null;
}

const st = StyleSheet.create({ box: { paddingVertical: 48, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' } });

/** Fixed bottom area for the main action of a screen. */
export function BottomBar({ children }: { children: React.ReactNode }) {
  const ins = useSafeAreaInsets();
  return (
    <Glass style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, paddingBottom: ins.bottom + 12, borderRadius: 0 }} tint="rgba(255,255,255,0.8)">
      {children}
    </Glass>
  );
}

export const rupee = (n: number) => `₹${n}`;

/** Password box with a show/hide eye button. */
export function PasswordField({ label, value, onChangeText, onSubmitEditing }: { label: string; value: string; onChangeText: (v: string) => void; onSubmitEditing?: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <View>
      <Field label={label} value={value} onChangeText={onChangeText} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="password" onSubmitEditing={onSubmitEditing} style={{ paddingRight: 52 }} />
      <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => { tap(); setShow(!show); }} hitSlop={8}
        style={{ position: 'absolute', right: 6, bottom: 5, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={20} color={C.sec} />
      </Pressable>
    </View>
  );
}
