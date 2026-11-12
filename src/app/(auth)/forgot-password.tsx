import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenContainer, Typography, Button, Input, Icon } from '@/components/ui';
import { Spacing, BorderRadius } from '@/constants/spacing';
import { useAppTheme } from '@/hooks/useAppTheme';
import { authApi } from '@/services/api/auth';
import { ApiError } from '@/services/api/types';
import { validateEmail } from '@/utils/validation';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { colors, isDark } = useAppTheme();

  const [email, setEmail] = useState(params.email || '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setApiError(null);

    const error = validateEmail(email, 'login');
    if (error) {
      setEmailError(error);
      return;
    }
    setEmailError(null);

    setIsSubmitting(true);
    try {
      await authApi.forgotPassword({
        email: email.trim().toLowerCase(),
      });

      // Generic response from backend prevents account enumeration.
      // Navigate to reset password screen with prefilled email.
      router.push({
        pathname: '/(auth)/reset-password',
        params: { email: email.trim().toLowerCase(), sent: 'true' },
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.statusCode === 429) {
          setApiError(err.message || 'Please wait before requesting another code.');
        } else {
          setApiError(err.message || 'Failed to send reset code. Please try again.');
        }
      } else {
        setApiError('Unable to connect to server. Please check your network connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenContainer scrollable withPadding contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: colors.accentSubtle,
              borderColor: isDark ? colors.border : colors.accentSubtle,
            },
          ]}
        >
          <Icon name="lock" size={13} color={colors.accentSoft} style={styles.badgeIcon} />
          <Typography variant="label" color={colors.accentSoft}>
            Password Recovery
          </Typography>
        </View>

        <Typography variant="title" style={styles.title}>
          Forgot Password
        </Typography>
        <Typography variant="body" color={colors.textSecondary}>
          Enter your registered Gmail address. We'll send you a 6-digit code to securely reset your password.
        </Typography>
      </View>

      {/* Form Section */}
      <View style={styles.form}>
        {/* Error Banner */}
        {Boolean(apiError) && (
          <View
            style={[
              styles.banner,
              {
                backgroundColor: colors.errorBackground,
                borderColor: colors.error,
              },
            ]}
            accessibilityRole="alert"
          >
            <Icon name="alert-circle" size={16} color={colors.error} style={styles.bannerIcon} />
            <Typography variant="caption" color={colors.error} style={styles.bannerText}>
              {apiError}
            </Typography>
          </View>
        )}

        <Input
          label="Gmail Address"
          placeholder="yourname@gmail.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (emailError) setEmailError(null);
            if (apiError) setApiError(null);
          }}
          error={emailError || undefined}
          editable={!isSubmitting}
          helperText="Must be the Gmail address associated with your account"
        />

        <Button
          title="Send Reset Code"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={handleSubmit}
          style={styles.submitButton}
        />
      </View>

      {/* Footer Navigation */}
      <View style={styles.footer}>
        <Button
          title="Back to Login"
          variant="ghost"
          size="sm"
          disabled={isSubmitting}
          onPress={() => router.replace('/(auth)/login')}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    paddingBottom: Spacing.xxl + Spacing.lg,
  },
  header: {
    paddingTop: Spacing.sm,
    marginBottom: Spacing.base,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  badgeIcon: {
    marginRight: Spacing.xs,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  form: {
    width: '100%',
    paddingVertical: Spacing.base,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  bannerIcon: {
    marginRight: Spacing.sm,
  },
  bannerText: {
    flex: 1,
    lineHeight: 18,
    fontWeight: '500',
  },
  submitButton: {
    marginTop: Spacing.sm,
  },
  footer: {
    alignItems: 'center',
    paddingTop: Spacing.base,
    paddingBottom: Spacing.sm,
  },
});

