import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Spacing, BorderRadius } from '@/constants/spacing';

export interface EmptyChatStateProps {
  onStartConversation: () => void;
}

export function EmptyChatState({ onStartConversation }: EmptyChatStateProps) {
  const { colors, isDark } = useAppTheme();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: colors.accentSubtle,
            borderColor: isDark ? colors.border : colors.accentSubtle,
          },
        ]}
      >
        <Typography variant="label" color={colors.accentSoft}>
          Private 1-to-1 Space
        </Typography>
      </View>

      <View
        style={[
          styles.emblemCircle,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Icon name="heart" size={32} color={colors.accent} />
      </View>

      <Typography variant="title" align="center" style={styles.title}>
        Your Private Space
      </Typography>

      <Typography
        variant="body"
        align="center"
        color={colors.textSecondary}
        style={styles.description}
      >
        Connect with your partner using their Gmail address to begin your private, real-time conversation.
      </Typography>

      <Button
        title="Start Conversation"
        icon="plus"
        variant="primary"
        size="lg"
        onPress={onStartConversation}
        style={styles.actionButton}
      />

      <Typography variant="timestamp" align="center" color={colors.textMuted} style={styles.disclaimer}>
        Reserved exclusively for the two of you.
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxxl,
  },
  badge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  emblemCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  heartGlyph: {
    fontSize: 28,
    lineHeight: 32,
  },
  title: {
    marginBottom: Spacing.sm,
  },
  description: {
    maxWidth: 300,
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  actionButton: {
    minWidth: 220,
    marginBottom: Spacing.md,
  },
  disclaimer: {
    fontSize: 12,
  },
});

