import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { formatDateSeparator } from '@/utils/date';
import { Spacing, BorderRadius } from '@/constants/spacing';

export interface DateSeparatorProps {
  date: string | Date;
  style?: ViewStyle;
}

/**
 * Calendar day divider for the chat message stream.
 * Displays "Today", "Yesterday", or formatted calendar date strings.
 */
export function DateSeparator({ date, style }: DateSeparatorProps) {
  const { colors, isDark } = useAppTheme();
  const label = formatDateSeparator(date);

  if (!label) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.pill,
          {
            backgroundColor: isDark ? colors.surfaceElevated : colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Typography variant="timestamp" color={colors.textSecondary} style={styles.text}>
          {label}
        </Typography>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});

