import { useEffect } from 'react';
import Tabs from 'expo-router/js-tabs';
import { LiquidTabBar } from '@/components/LiquidTabBar';
import { startInbox, useInbox } from '@/lib/inbox';
import { C } from '@/lib/theme';

export default function TabsLayout() {
  useEffect(() => { startInbox(); }, []);
  const unread = useInbox((s) => s.list.filter((m) => !m.readAt).length);
  return (
    <Tabs tabBar={(p) => <LiquidTabBar {...p} badges={{ inbox: unread }} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="doctors" />
      <Tabs.Screen name="chamber" />
      <Tabs.Screen name="inbox" />
    </Tabs>
  );
}
