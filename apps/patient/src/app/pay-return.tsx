import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { C } from '@/lib/theme';

// On web the checkout opens in a popup; this hands the result back to the app tab.
WebBrowser.maybeCompleteAuthSession();

export default function PayReturn() {
  useEffect(() => {
    const id = setTimeout(() => { if (router.canGoBack()) router.back(); else router.replace('/'); }, 1500);
    return () => clearTimeout(id);
  }, []);
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.deep} size="large" /></View>;
}
