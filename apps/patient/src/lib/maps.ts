import { Linking, Platform } from 'react-native';

/** Open the chamber in the phone's maps app (Google Maps on Android and web). */
export function openMaps(lat: number | null, lng: number | null, label: string) {
  const google = lat && lng
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${label}, Kailashahar, Tripura`)}`;
  const url = Platform.OS === 'ios' && lat && lng ? `maps://?q=${encodeURIComponent(label)}&ll=${lat},${lng}` : google;
  Linking.openURL(url).catch(() => { void Linking.openURL(google); });
}
