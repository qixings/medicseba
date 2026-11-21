import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { LOGO_RATIO, LOGO_SVG } from '@/assets/brand';

/** The MedicSeba wordmark. `height` sets the size; width follows the logo's shape. */
export function Logo({ height = 28 }: { height?: number }) {
  const width = Math.round(height * LOGO_RATIO);
  return (
    <View style={{ width, height }} accessibilityRole="image" accessibilityLabel="MedicSeba">
      <SvgXml xml={LOGO_SVG} width={width} height={height} />
    </View>
  );
}
