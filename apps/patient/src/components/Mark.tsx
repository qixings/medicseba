import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { ICON_SVG } from '@/assets/brand';
import { C } from '@/lib/theme';

/** Placeholder when a chamber has no photo: the MedicSeba mark on the light teal tint. */
export function PhotoPlaceholder({ style, size = 44 }: { style?: StyleProp<ViewStyle>; size?: number }) {
  return (
    <View style={[{ backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View style={{ width: size, height: size, opacity: 0.9 }}><SvgXml xml={ICON_SVG} width={size} height={size} /></View>
    </View>
  );
}
