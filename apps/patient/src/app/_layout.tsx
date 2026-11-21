import { useEffect } from 'react';
import { startLive } from '@/lib/live';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black } from '@expo-google-fonts/inter';
import { queryClient } from '@/lib/query';
import { restoreSession, useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

export default function RootLayout() {
  // iPhone uses SF Pro (the system font). Android and web load Inter.
  const [fontsLoaded] = useFonts(Platform.OS === 'ios' ? {} : { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black });
  const { ready, token, me } = useAuth((s) => s);

  useEffect(() => { void restoreSession(); startLive(); }, []);

  if (!ready || !fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const signedIn = !!token;
  const needsSetup = signedIn && !!me && !me.name;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }}>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="login" />
            <Stack.Screen name="otp" />
          </Stack.Protected>
          <Stack.Protected guard={needsSetup}>
            <Stack.Screen name="setup" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn && !needsSetup}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="doctors" />
            <Stack.Screen name="doctor/[id]" />
            <Stack.Screen name="chamber/[id]" />
            <Stack.Screen name="book/[doctorId]" />
            <Stack.Screen name="confirmed/[id]" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="live/[id]" />
            <Stack.Screen name="reschedule/[id]" />
            <Stack.Screen name="absent/[id]" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="family" />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
