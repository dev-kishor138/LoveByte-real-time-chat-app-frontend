import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenContainer, Typography, Button, Input } from '@/components/ui';
import { Spacing, BorderRadius } from '@/constants/spacing';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/services/api/types';
import {
  validateEmail,
  validateLoginForm,
} from '@/utils/validation';

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ registered?: string }>();
  const { colors } = useAppTheme();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (params.registered === 'true') {
      setSuccessMessage('Account created successfully! Please sign in with your Gmail address.');
    }
  }, [params.registered]);

  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
    if (apiError) {
      setApiError(null);
    }
    if (successMessage) {
      setSuccessMessage(null);
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
    if (successMessage) {
      setSuccessMessage(null);
    }
  };

  const handleEmailBlur = () => {
    if (email.trim().length > 0) {
      const error = validateEmail(email, 'login');
      setFieldErrors((prev) => ({ ...prev, email: error || undefined }));
    }
  };

  const handlePasswordBlur = () => {
    if (!password) {
      setFieldErrors((prev) => ({ ...prev, password: 'Password is required' }));
    } else {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    setApiError(null);
    const validation = validateLoginForm({ email, password });
    if (!validation.isValid) {
      setFieldErrors(validation.errors);
      return;
    }

    setIsSubmitting(true);
    try {
      await login({ email, password });
      // On success (HTTP 200), login persists the session and sets in-memory tokens.
      // Navigate to the main chat space:
      router.replace('/(chat)');
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
        } else if (err.statusCode === 401) {
          // Generic credential error to prevent account enumeration
          setApiError('Invalid email or password');
        } else if (err.statusCode === 429) {
          setApiError('Too many authentication attempts. Please try again later.');
        } else {
          setApiError(err.message || 'Login failed. Please check your credentials.');
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
        <Typography variant="title" style={styles.title}>
          Welcome Back
        </Typography>
        <Typography variant="body" color={colors.textSecondary}>
          Sign in with your Gmail address to enter your private space.
        </Typography>
      </View>

      {/* Form Section */}
      <View style={styles.form}>
        {/* Success Banner (e.g. from registration redirect) */}
        {Boolean(successMessage) && (
          <View
            style={[
              styles.banner,
              {
                backgroundColor: colors.successBackground,
                borderColor: colors.success,
              },
            ]}
            accessibilityRole="alert"
          >
            <Typography variant="caption" color={colors.success} style={styles.bannerText}>
              {successMessage}
            </Typography>
          </View>
        )}

        {/* API Error Banner */}
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
          helperText="Registration requires a valid @gmail.com address"
        />

        <Input
          label="Password"
          placeholder="Enter your password"
          secureTextEntry
          value={password}
          onChangeText={handlePasswordChange}
          onBlur={handlePasswordBlur}
          error={fieldErrors.password}
          editable={!isSubmitting}
        />

        <Button
          title="Sign In"
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
          onPress={() => router.push('/(auth)/register')}
          style={styles.switchRow}
        >
          <Typography variant="caption" color={colors.textSecondary}>
            Don't have an account yet?{' '}
            <Typography variant="caption" color={colors.accent} style={styles.linkText}>
              Create one
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
    justifyContent: 'space-between',
    paddingVertical: Spacing.xl,
    minHeight: '100%',
  },
  header: {
    paddingTop: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  form: {
    width: '100%',
    paddingVertical: Spacing.base,
  },
  banner: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  bannerText: {
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
