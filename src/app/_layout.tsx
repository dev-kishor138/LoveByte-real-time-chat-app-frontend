import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppTheme } from '@/hooks/useAppTheme';
import { AuthProvider, useAuth } from '@/context/AuthContext';

// Keep splash screen visible until initial authentication bootstrap finishes
SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigation() {
  const { colors } = useAppTheme();
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) {
      return;
    }

    // Dismiss splash screen smoothly once initialization settles
    SplashScreen.hideAsync().catch(() => {});

    const firstSegment = segments[0] as string | undefined;
    const inChatGroup = firstSegment === '(chat)';
    const inAuthGroup = firstSegment === '(auth)';
    const isRootIndex = !firstSegment || firstSegment === 'index';

    if (!isAuthenticated && inChatGroup) {
      // Direct unauthenticated user to login screen
      router.replace('/(auth)/login');
    } else if (isAuthenticated && (inAuthGroup || isRootIndex)) {
      // Direct authenticated user away from login/welcome to chat
      router.replace('/(chat)');
    }
  }, [isAuthenticated, isLoading, segments, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: colors.background,
        },
        animation: 'fade',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="(chat)" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigation />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
