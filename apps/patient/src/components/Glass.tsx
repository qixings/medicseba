import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';

const nativeGlass = Platform.OS === 'ios' && (() => { try { return isGlassEffectAPIAvailable(); } catch { return false; } })();

/**
 * Apple's real Liquid Glass on iOS 26+, frosted blur everywhere else.
 * `dark` is for glass that sits on the night tab bar.
 */
export function Glass({ style, children, dark = false, tint, intensity = 40 }: {
  style?: StyleProp<ViewStyle>; children?: React.ReactNode; dark?: boolean; tint?: string; intensity?: number;
}) {
  if (nativeGlass) {
    return (
      <GlassView style={style} glassEffectStyle="regular" colorScheme={dark ? 'dark' : 'light'} tintColor={tint}>
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[style, { overflow: 'hidden' }]}>
      <BlurView
        intensity={intensity}
        tint={dark ? 'dark' : 'light'}
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint ?? (dark ? 'rgba(43,63,66,0.55)' : 'rgba(255,255,255,0.62)') }]} />
      {/* rim light: bright top edge, soft bottom edge */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, glassRim(dark), { borderRadius: StyleSheet.flatten(style)?.borderRadius ?? 0 }]} />
      {children}
    </View>
  );
}

const glassRim = (dark: boolean): ViewStyle => ({
  borderWidth: StyleSheet.hairlineWidth * 2,
  borderTopColor: dark ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.95)',
  borderLeftColor: dark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.7)',
  borderRightColor: dark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.7)',
  borderBottomColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)',
});

export const hasNativeGlass = nativeGlass;
