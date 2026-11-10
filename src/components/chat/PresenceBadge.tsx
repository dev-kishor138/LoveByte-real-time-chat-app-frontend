import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { Spacing } from '@/constants/spacing';
import { formatLastSeenPresence } from '@/utils/date';

export interface PresenceBadgeProps {
  isOnline: boolean;
  lastSeenAt?: string | null;
  showText?: boolean;
  dotSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function PresenceBadge({
  isOnline,
  lastSeenAt,
  showText = true,
  dotSize = 8,
  style,
}: PresenceBadgeProps) {
  const { colors } = useAppTheme();

  const statusText = formatLastSeenPresence(lastSeenAt, isOnline);
  const dotColor = isOnline ? colors.success : colors.textMuted;

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: dotColor,
          },
        ]}
      />
      {showText && (
        <Typography
          variant="timestamp"
          color={isOnline ? colors.success : colors.textSecondary}
          numberOfLines={1}
          style={styles.text}
        >
          {statusText}
        </Typography>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dot: {
    flexShrink: 0,
  },
  text: {
    fontSize: 12,
  },
});

