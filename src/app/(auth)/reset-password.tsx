import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenContainer, Typography, Button, Input, Icon } from '@/components/ui';
import { Spacing, BorderRadius } from '@/constants/spacing';
import { useAppTheme } from '@/hooks/useAppTheme';
import { authApi } from '@/services/api/auth';
import { ApiError } from '@/services/api/types';
import {
  validateEmail,
  validatePassword,
  validateConfirmPassword,
} from '@/utils/validation';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; sent?: string }>();
  const { colors, isDark } = useAppTheme();

  const [email, setEmail] = useState(params.email || '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    code?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>({});

  const [apiError, setApiError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(
    params.sent === 'true'
      ? 'A 6-digit reset code was sent to your email.'
      : null
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = (seconds: number = 60) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCooldown(seconds);
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCodeChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '').slice(0, 6);
    setCode(cleaned);
    if (fieldErrors.code) {
      setFieldErrors((prev) => ({ ...prev, code: undefined }));
    }
    if (apiError) setApiError(null);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setApiError(null);

    const errors: {
      email?: string;
      code?: string;
      newPassword?: string;
      confirmPassword?: string;
    } = {};

    const emailErr = validateEmail(email, 'login');
    if (emailErr) errors.email = emailErr;

    if (code.trim().length !== 6) {
      errors.code = 'Please enter the 6-digit reset code';
    }

    const passwordErr = validatePassword(newPassword);
    if (passwordErr) errors.newPassword = passwordErr;

    const confirmErr = validateConfirmPassword(newPassword, confirmPassword);
    if (confirmErr) errors.confirmPassword = confirmErr;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await authApi.resetPassword({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        newPassword,
      });

      // Reset successful! Redirect to login with reset=true banner
      router.replace({
        pathname: '/(auth)/login',
        params: { reset: 'true', email: email.trim().toLowerCase() },
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setApiError(err.message || 'Password reset failed. Please check your code.');
      } else {
        setApiError('Unable to connect to server. Please check your network connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setApiError(null);

    const emailErr = validateEmail(email, 'login');
    if (emailErr) {
      setFieldErrors((prev) => ({ ...prev, email: emailErr }));
      return;
    }

    setIsResending(true);
    try {
      const response = await authApi.resendOtp({
        email: email.trim().toLowerCase(),
        type: 'PASSWORD_RESET',
      });
      setInfoMessage(response.message || 'A fresh reset code has been sent.');
      startCooldown(60);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.statusCode === 429) {
          const retryAfter = (err as any).retryAfter || 60;
          startCooldown(retryAfter);
          setApiError(err.message || 'Please wait before requesting another code.');
        } else {
          setApiError(err.message || 'Failed to resend code. Please try again.');
        }
      } else {
        setApiError('Unable to connect to server. Please check your network connection.');
      }
    } finally {
      setIsResending(false);
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
          <Icon name="key" size={13} color={colors.accentSoft} style={styles.badgeIcon} />
          <Typography variant="label" color={colors.accentSoft}>
            Reset Password
          </Typography>
        </View>

        <Typography variant="title" style={styles.title}>
          Set New Password
        </Typography>
        <Typography variant="body" color={colors.textSecondary}>
          Enter the reset code sent to your Gmail address and choose a strong new password.
        </Typography>
      </View>

      {/* Form Section */}
      <View style={styles.form}>
        {/* Info Banner */}
        {Boolean(infoMessage) && (
          <View
            style={[
              styles.banner,
              {
                backgroundColor: colors.accentSubtle,
                borderColor: colors.borderFocused,
              },
            ]}
          >
            <Icon name="info" size={16} color={colors.accentSoft} style={styles.bannerIcon} />
            <Typography variant="caption" color={colors.accentSoft} style={styles.bannerText}>
              {infoMessage}
            </Typography>
          </View>
        )}

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
            if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
          }}
          error={fieldErrors.email}
          editable={!isSubmitting}
        />

        <Input
          label="6-Digit Reset Code"
          placeholder="123456"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={handleCodeChange}
          error={fieldErrors.code}
          editable={!isSubmitting}
          style={styles.codeInput}
          helperText="Enter the 6-digit code received via email"
        />

        <Input
          label="New Password"
          placeholder="Enter new password"
          secureTextEntry
          value={newPassword}
          onChangeText={(text) => {
            setNewPassword(text);
            if (fieldErrors.newPassword) {
              setFieldErrors((prev) => ({ ...prev, newPassword: undefined }));
            }
          }}
          error={fieldErrors.newPassword}
          editable={!isSubmitting}
          helperText="Min. 8 characters with uppercase, lowercase, digit, and symbol"
        />

        <Input
          label="Confirm New Password"
          placeholder="Re-enter new password"
          secureTextEntry
          value={confirmPassword}
          onChangeText={(text) => {
            setConfirmPassword(text);
            if (fieldErrors.confirmPassword) {
              setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
            }
          }}
          error={fieldErrors.confirmPassword}
          editable={!isSubmitting}
        />

        <Button
          title="Reset Password"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={handleSubmit}
          style={styles.submitButton}
        />

        {/* Resend Action */}
        <View style={styles.resendRow}>
          <Typography variant="caption" color={colors.textSecondary}>
            Didn't receive the reset code?{' '}
          </Typography>
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={cooldown > 0 || isResending}
            onPress={handleResend}
          >
            <Typography
              variant="caption"
              color={cooldown > 0 ? colors.textDisabled : colors.accent}
              style={styles.linkText}
            >
              {isResending
                ? 'Sending...'
                : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : 'Resend Code'}
            </Typography>
          </TouchableOpacity>
        </View>
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
  codeInput: {
    letterSpacing: 6,
    fontWeight: '700',
    fontSize: 20,
    textAlign: 'center',
  },
  submitButton: {
    marginTop: Spacing.sm,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.base,
  },
  linkText: {
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    paddingTop: Spacing.base,
    paddingBottom: Spacing.sm,
  },
});

