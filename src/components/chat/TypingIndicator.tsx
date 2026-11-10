import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { Spacing, BorderRadius } from '@/constants/spacing';

export interface TypingIndicatorProps {
  isTyping: boolean;
  partnerName?: string;
  style?: ViewStyle;
}

/**
 * Three-dot partner typing indicator with subtle pulsing opacity animation.
 * Renders cleanly in incoming bubble styling when isTyping is true; returns null when false.
 */
export function TypingIndicator({ isTyping, partnerName, style }: TypingIndicatorProps) {
  const { colors, isDark } = useAppTheme();

  const dot1Opacity = useRef(new Animated.Value(0.3)).current;
  const dot2Opacity = useRef(new Animated.Value(0.3)).current;
  const dot3Opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (!isTyping) {
      dot1Opacity.setValue(0.3);
      dot2Opacity.setValue(0.3);
      dot3Opacity.setValue(0.3);
      return;
    }

    const createPulse = (dot: Animated.Value, delay: number) => {
      return Animated.sequence([
        Animated.delay(delay),
        Animated.loop(
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: 350,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0.3,
              duration: 350,
              useNativeDriver: true,
            }),
            Animated.delay(300),
          ])
        ),
      ]);
    };

    const anim1 = createPulse(dot1Opacity, 0);
    const anim2 = createPulse(dot2Opacity, 180);
    const anim3 = createPulse(dot3Opacity, 360);

    anim1.start();
    anim2.start();
    anim3.start();

    return () => {
      anim1.stop();
      anim2.stop();
      anim3.stop();
    };
  }, [isTyping, dot1Opacity, dot2Opacity, dot3Opacity]);

  if (!isTyping) {
    return null;
  }

  const dotColor = isDark ? colors.accentSoft : colors.primary;

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: colors.bubbleIncoming,
            borderColor: isDark ? colors.border : colors.borderSubtle,
          },
        ]}
        accessibilityRole="text"
        accessibilityLabel={partnerName ? `${partnerName} is typing` : 'Partner is typing'}
      >
        <View style={styles.dotsRow}>
          <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity: dot1Opacity }]} />
          <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity: dot2Opacity }]} />
          <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity: dot3Opacity }]} />
        </View>
        {Boolean(partnerName) && (
          <Typography variant="timestamp" color={colors.textSecondary} style={styles.partnerText}>
            {partnerName} is typing...
          </Typography>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.bubble,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  partnerText: {
    fontSize: 12,
  },
});

