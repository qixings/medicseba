import { Linking, Platform } from 'react-native';
import { post } from './api';

/** Open the serial's receipt PDF; from there the browser's print or share button prints it. */
export async function openReceipt(tokenId: string) {
  const { url } = await post<{ url: string }>(`/agent/tokens/${tokenId}/receipt`, {});
  if (Platform.OS === 'web') globalThis.open?.(url, '_blank');
  else await Linking.openURL(url);
}

export async function whatsappReceipt(tokenId: string, phone?: string) {
  await post<{ sent: boolean }>(`/agent/tokens/${tokenId}/receipt`, { whatsapp: true, phone });
}
