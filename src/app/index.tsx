import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer, Typography, Button, Icon } from '@/components/ui';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Spacing, BorderRadius } from '@/constants/spacing';

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();

  return (
    <ScreenContainer scrollable withPadding contentContainerStyle={styles.container}>
      {/* Top Branding Section */}
      <View style={styles.brandingSection}>
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

        <Typography variant="display" style={styles.title}>
          LoveByte
        </Typography>

        <Typography variant="body" color={colors.textSecondary} style={styles.subtitle}>
          A calm, private messaging space designed exclusively for the two of us.
        </Typography>
      </View>

      {/* Middle Brand Monogram */}
      <View style={styles.graphicContainer}>
        <View
          style={[
            styles.avatarCircle,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Icon name="heart" size={38} color={colors.accent} />
        </View>
      </View>

      {/* Bottom Action Section */}
      <View style={styles.actionSection}>
        <Button
          title="Sign In"
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => router.push('/(auth)/login')}
          style={styles.primaryButton}
        />

        <Button
          title="Create an Account"
          variant="outline"
          size="lg"
          fullWidth
          onPress={() => router.push('/(auth)/register')}
        />

        <Typography variant="timestamp" align="center" style={styles.disclaimer}>
          Encrypted, persistent, and reserved for exactly two users.
        </Typography>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingVertical: Spacing.xl,
  },
  brandingSection: {
    alignItems: 'center',
    paddingTop: Spacing.xxl,
  },
  badge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginBottom: Spacing.base,
  },
  title: {
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    textAlign: 'center',
    maxWidth: 290,
    lineHeight: 22,
  },
  graphicContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
  },
  avatarCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartGlyph: {
    fontSize: 32,
    lineHeight: 36,
  },
  actionSection: {
    gap: Spacing.md,
    paddingBottom: Spacing.base,
  },
  primaryButton: {
    marginBottom: Spacing.xs,
  },
  disclaimer: {
    marginTop: Spacing.xs,
    fontSize: 12,
  },
});
