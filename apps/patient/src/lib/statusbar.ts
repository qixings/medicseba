import { useEffect } from 'react';
import { Platform } from 'react-native';
import { C } from './theme';

/** Colour of the strip under the phone's status bar (web app only), for screens with a coloured top. */
export function useStatusBarColor(color: string) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = globalThis.document?.getElementById('statusbar');
    if (!el) return;
    el.style.background = color;
    return () => { el.style.background = C.bg; };
  }, [color]);
}
