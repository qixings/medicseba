import { Platform, Pressable, TextInput, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { C, F, card } from '@/lib/theme';
import { Icon } from './Icon';

/** The search field used on Home, Doctors and Chambers, with a clear button once something is typed. */
export function SearchBox({ value, onChange, onSubmit, autoFocus }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; autoFocus?: boolean }) {
  const t = useT();
  return (
    <View style={[card, { marginTop: 14, height: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 6 }]}>
      <Icon name="search" size={18} color={C.faint} width={2.2} />
      <TextInput
        accessibilityLabel={t('search')}
        placeholder={t('search')}
        placeholderTextColor={C.placeholder}
        value={value}
        onChangeText={onChange}
        autoFocus={autoFocus}
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        style={[F.regular, { flex: 1, fontSize: 17, color: C.ink, height: 44 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('clearSearch')} onPress={() => onChange('')} hitSlop={6}
          style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
          <Icon name="x" size={16} color={C.sec} width={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}
