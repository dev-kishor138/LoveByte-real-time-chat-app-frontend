import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer, Typography, Button, Input, Icon } from '@/components/ui';
import { Spacing, BorderRadius } from '@/constants/spacing';
import { useAppTheme } from '@/hooks/useAppTheme';
import { authApi } from '@/services/api';
import { ApiError } from '@/services/api/types';
import {
  validateEmail,
  validatePassword,
  validateConfirmPassword,
  validateRegisterForm,
} from '@/utils/validation';

export default function RegisterScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
    if (apiError) {
      setApiError(null);
    }
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
    if (apiError) {
      setApiError(null);
    }
  };

  const handleConfirmPasswordChange = (text: string) => {
    setConfirmPassword(text);
    if (fieldErrors.confirmPassword) {
      setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
    }
  };

  const handleEmailBlur = () => {
    if (email.trim().length > 0) {
      const error = validateEmail(email, 'register');
      setFieldErrors((prev) => ({ ...prev, email: error || undefined }));
    }
  };

  const handlePasswordBlur = () => {
    if (password.length > 0) {
      const error = validatePassword(password);
      setFieldErrors((prev) => ({ ...prev, password: error || undefined }));
      if (confirmPassword.length > 0) {
        const confirmErr = validateConfirmPassword(password, confirmPassword);
        setFieldErrors((prev) => ({ ...prev, confirmPassword: confirmErr || undefined }));
      }
    }
  };

  const handleConfirmPasswordBlur = () => {
    if (confirmPassword.length > 0) {
      const error = validateConfirmPassword(password, confirmPassword);
      setFieldErrors((prev) => ({ ...prev, confirmPassword: error || undefined }));
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    setApiError(null);
    const validation = validateRegisterForm({ email, password, confirmPassword });
    if (!validation.isValid) {
      setFieldErrors(validation.errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await authApi.register({ email, password });
      // Successfully registered (HTTP 201). Navigate to verification screen.
      router.replace({
        pathname: '/(auth)/verify-email',
        params: { email: email.trim().toLowerCase(), registered: 'true' },
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.statusCode === 400 && err.details && err.details.length > 0) {
          const newErrors: { email?: string; password?: string } = {};
          let unmappedMessage: string | null = null;
          err.details.forEach((d) => {
            if (d.field === 'email') {
              newErrors.email = d.message;
            } else if (d.field === 'password') {
              newErrors.password = d.message;
            } else {
              unmappedMessage = d.message;
            }
          });
          setFieldErrors((prev) => ({ ...prev, ...newErrors }));
          if (unmappedMessage) {
            setApiError(unmappedMessage);
          }
        } else if (err.statusCode === 409) {
          setApiError('An account with this email already exists.');
        } else if (err.statusCode === 429) {
          setApiError('Too many authentication attempts. Please try again later.');
        } else {
          setApiError(err.message || 'Registration failed. Please try again.');
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
          <Icon name="heart" size={13} color={colors.accentSoft} style={styles.badgeIcon} />
          <Typography variant="label" color={colors.accentSoft}>
            LoveByte
          </Typography>
        </View>

        <Typography variant="title" style={styles.title}>
          Create Account
        </Typography>
        <Typography variant="body" color={colors.textSecondary}>
          Connect with your partner using your verified Gmail address.
        </Typography>
      </View>

      {/* Form Section */}
      <View style={styles.form}>
        {Boolean(apiError) && (
          <View
            style={[
              styles.errorBanner,
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
          onChangeText={handleEmailChange}
          onBlur={handleEmailBlur}
          error={fieldErrors.email}
          editable={!isSubmitting}
          helperText="Only @gmail.com addresses are supported"
        />

        <Input
          label="Password"
          placeholder="Min 8 chars, 1 uppercase, 1 symbol"
          secureTextEntry
          value={password}
          onChangeText={handlePasswordChange}
          onBlur={handlePasswordBlur}
          error={fieldErrors.password}
          editable={!isSubmitting}
        />

        <Input
          label="Confirm Password"
          placeholder="Repeat your password"
          secureTextEntry
          value={confirmPassword}
          onChangeText={handleConfirmPasswordChange}
          onBlur={handleConfirmPasswordBlur}
          error={fieldErrors.confirmPassword}
          editable={!isSubmitting}
        />

        <Button
          title="Create Account"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={handleSubmit}
          style={styles.submitButton}
        />

        <TouchableOpacity
          activeOpacity={0.7}
          disabled={isSubmitting}
          onPress={() => router.push('/(auth)/login')}
          style={styles.switchRow}
        >
          <Typography variant="caption" color={colors.textSecondary}>
            Already have an account?{' '}
            <Typography variant="caption" color={colors.accent} style={styles.linkText}>
              Sign in
            </Typography>
          </Typography>
        </TouchableOpacity>
      </View>

      {/* Footer Navigation */}
      <View style={styles.footer}>
        <Button
          title="Back to Welcome"
          variant="ghost"
          size="sm"
          disabled={isSubmitting}
          onPress={() => router.back()}
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
  errorBanner: {
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
  switchRow: {
    alignItems: 'center',
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
