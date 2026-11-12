import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenContainer, Typography, Button, Input, Icon } from '@/components/ui';
import { Spacing, BorderRadius } from '@/constants/spacing';
import { useAppTheme } from '@/hooks/useAppTheme';
import { authApi } from '@/services/api/auth';
import { ApiError } from '@/services/api/types';
import { validateEmail } from '@/utils/validation';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    email?: string;
    registered?: string;
    reason?: string;
  }>();
  const { colors, isDark } = useAppTheme();

  const [email, setEmail] = useState(params.email || '');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [apiError, setApiError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(
    params.registered === 'true'
      ? 'A 6-digit verification code was sent to your email.'
      : params.reason === 'unverified'
      ? 'Please verify your email before signing in.'
      : null
  );
  const [isVerifying, setIsVerifying] = useState(false);
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
    // Digits only, max 6 characters
    const cleaned = text.replace(/[^0-9]/g, '').slice(0, 6);
    setCode(cleaned);
    if (codeError) setCodeError(null);
    if (apiError) setApiError(null);
  };

  const handleVerify = async () => {
    if (isVerifying) return;
    setApiError(null);

    // Validate email
    const emailErr = validateEmail(email, 'login');
    if (emailErr) {
      setEmailError(emailErr);
      return;
    }
    setEmailError(null);

    // Validate code
    if (code.trim().length !== 6) {
      setCodeError('Please enter the complete 6-digit code');
      return;
    }
    setCodeError(null);

    setIsVerifying(true);
    try {
      await authApi.verifyEmail({
        email: email.trim().toLowerCase(),
        code: code.trim(),
      });

      // Verification successful! Redirect to login with banner
      router.replace({
        pathname: '/(auth)/login',
        params: { verified: 'true', email: email.trim().toLowerCase() },
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setApiError(err.message || 'Verification failed. Please try again.');
      } else {
        setApiError('Unable to connect to server. Please check your network connection.');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setApiError(null);

    const emailErr = validateEmail(email, 'login');
    if (emailErr) {
      setEmailError(emailErr);
      return;
    }
    setEmailError(null);

    setIsResending(true);
    try {
      const response = await authApi.resendOtp({
        email: email.trim().toLowerCase(),
        type: 'EMAIL_VERIFICATION',
      });
      setInfoMessage(response.message || 'A fresh verification code has been sent.');
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
          <Icon name="mail" size={13} color={colors.accentSoft} style={styles.badgeIcon} />
          <Typography variant="label" color={colors.accentSoft}>
            Email Verification
          </Typography>
        </View>

        <Typography variant="title" style={styles.title}>
          Verify Your Email
        </Typography>
        <Typography variant="body" color={colors.textSecondary}>
          Enter the 6-digit code sent to your Gmail address to activate your account.
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
            if (emailError) setEmailError(null);
          }}
          error={emailError || undefined}
          editable={!isVerifying && !isResending}
        />

        <Input
          label="6-Digit Verification Code"
          placeholder="123456"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={handleCodeChange}
          error={codeError || undefined}
          editable={!isVerifying}
          style={styles.codeInput}
          helperText="Codes expire after 15 minutes."
        />

        <Button
          title="Verify Email"
          variant="primary"
          size="lg"
          fullWidth
          loading={isVerifying}
          disabled={isVerifying || code.length !== 6}
          onPress={handleVerify}
          style={styles.submitButton}
        />

        {/* Resend Action */}
        <View style={styles.resendRow}>
          <Typography variant="caption" color={colors.textSecondary}>
            Didn't receive the code?{' '}
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
          disabled={isVerifying}
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

