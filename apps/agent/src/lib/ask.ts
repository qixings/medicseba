import { Alert, Platform } from 'react-native';

/** Yes/no question; the yes button is shown as destructive on phones. */
export function ask(msg: string, yes: string, no: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(msg) ?? false);
  return new Promise((res) => Alert.alert('', msg, [{ text: no, style: 'cancel', onPress: () => res(false) }, { text: yes, style: 'destructive', onPress: () => res(true) }]));
}
