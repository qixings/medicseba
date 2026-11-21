import Tabs from 'expo-router/js-tabs';
import { LiquidTabBar } from '@/components/LiquidTabBar';
import { C } from '@/lib/theme';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(p) => <LiquidTabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="chambers" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
