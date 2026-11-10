import React from 'react';
import { View, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from './Typography';
import { Spacing } from '@/constants/spacing';

export interface LoadingIndicatorProps {
  message?: string;
  fullscreen?: boolean;
  size?: 'small' | 'large';
  style?: ViewStyle;
}

export function LoadingIndicator({
  message,
  fullscreen = false,
  size = 'small',
  style,
}: LoadingIndicatorProps) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        fullscreen ? styles.fullscreen : styles.inline,
        fullscreen && { backgroundColor: colors.background },
        style,
      ]}
    >
      <ActivityIndicator size={size} color={colors.accent} />
      {Boolean(message) && (
        <Typography variant="caption" color={colors.textSecondary} style={styles.message}>
          {message}
        </Typography>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inline: {
    padding: Spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreen: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  message: {
    marginTop: Spacing.sm,
  },
});
