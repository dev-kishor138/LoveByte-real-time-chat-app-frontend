import React from 'react';
import { Stack } from 'expo-router';
import { useAppTheme } from '@/hooks/useAppTheme';
import { ChatProvider } from '@/context/ChatContext';

/**
 * ChatLayout
 * Mounts ChatProvider strictly within the authenticated chat route boundary (FINDING-05).
 * Guarantees that chat subscriptions and REST sync are active only for authenticated users,
 * and automatically unmounts upon logout.
 */
export default function ChatLayout() {
  const { colors } = useAppTheme();

  return (
    <ChatProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="[conversationId]" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </ChatProvider>
  );
}

