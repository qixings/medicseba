import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black } from '@expo-google-fonts/inter';
import { restore, useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

export default function Root() {
  const [fonts] = useFonts(Platform.OS === 'ios' ? {} : { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black });
  const { ready, token } = useAuth((s) => s);
  useEffect(() => { void restore(); }, []);
  if (!ready || !fonts) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }}>
        <Stack.Protected guard={!token}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={!!token}>
          <Stack.Screen name="index" />
          <Stack.Screen name="session/[id]" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}
