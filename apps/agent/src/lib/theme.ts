import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Colours from the approved design. */
export const C = {
  brand: '#1ACDD4', // buttons, active states (white text on it)
  deep: '#16ACB2', // large teal surfaces
  link: '#0B7F84', // teal text on white
  tint: '#E3F8F9', // avatar and photo placeholders
  night: '#00191A', // tab bar, token card
  ink: '#0B1220',
  sec: 'rgba(11,18,32,0.66)',
  faint: 'rgba(11,18,32,0.45)',
  placeholder: 'rgba(11,18,32,0.26)', // light enough that an empty field never looks filled
  line: 'rgba(11,18,32,0.08)',
  field: 'rgba(11,18,32,0.12)',
  bg: '#F3F5F9',
  white: '#FFFFFF',
  good: '#067647',
  goodBg: '#E7F6EC',
  warn: '#B54708',
  warnBg: '#FEF0C7',
  bad: '#B42318',
  badBg: '#FEE4E2',
};

/** SF Pro on iPhone (system font), Inter elsewhere. */
const inter = (w: string) => (Platform.OS === 'ios' ? undefined : `Inter_${w}`);
export const F = {
  light: { fontFamily: inter('300Light'), fontWeight: '300' } as TextStyle,
  regular: { fontFamily: inter('400Regular'), fontWeight: '400' } as TextStyle,
  medium: { fontFamily: inter('500Medium'), fontWeight: '500' } as TextStyle,
  semibold: { fontFamily: inter('600SemiBold'), fontWeight: '600' } as TextStyle,
  bold: { fontFamily: inter('700Bold'), fontWeight: '700' } as TextStyle,
  heavy: { fontFamily: inter('800ExtraBold'), fontWeight: '800' } as TextStyle,
  black: { fontFamily: inter('900Black'), fontWeight: '900' } as TextStyle,
};
export const num: TextStyle = { fontVariant: ['tabular-nums'] };

/** Firm shadows, not soft ones. */
export const S: Record<'card' | 'up' | 'btn', ViewStyle> = {
  card: { shadowColor: '#0B1220', shadowOpacity: 0.14, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  up: { shadowColor: '#0B1220', shadowOpacity: 0.3, shadowRadius: 13, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  btn: { shadowColor: '#16ACB2', shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
};

export const card: ViewStyle = { backgroundColor: C.white, borderRadius: 20, borderWidth: 1, borderColor: C.line, ...S.card };
