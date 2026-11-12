import React, { useState } from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  StyleSheet,
  ViewStyle,
  TouchableOpacity,
} from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from './Typography';
import { Icon } from './Icon';
import { Spacing, BorderRadius } from '@/constants/spacing';
import { Typography as TypoTokens } from '@/constants/typography';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  containerStyle?: ViewStyle;
}

export function Input({
  label,
  error,
  helperText,
  containerStyle,
  style,
  onFocus,
  onBlur,
  secureTextEntry,
  editable = true,
  ...props
}: InputProps) {
  const { colors } = useAppTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const hasError = Boolean(error);
  const isSecured = secureTextEntry && !isPasswordVisible;

  const getBorderColor = (): string => {
    if (hasError) return colors.error;
    if (isFocused) return colors.borderFocused; // Electric Purple (#8969E8)
    return colors.inputBorder;
  };

  const handleFocus = (e: any) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {Boolean(label) && (
        <Typography variant="caption" color={colors.textSecondary} style={styles.label}>
          {label}
        </Typography>
      )}

      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: editable ? colors.inputBackground : colors.buttonDisabled,
            borderColor: getBorderColor(),
            borderWidth: isFocused ? 1.5 : 1,
          },
        ]}
      >
        <TextInput
          placeholderTextColor={colors.inputPlaceholder}
          underlineColorAndroid="transparent"
          secureTextEntry={isSecured}
          editable={editable}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.input,
            {
              color: editable ? colors.textPrimary : colors.textDisabled,
              fontSize: TypoTokens.sizes.base,
            },
            style,
          ]}
          {...props}
        />

        {secureTextEntry && (
          <TouchableOpacity
            activeOpacity={0.6}
            onPress={() => setIsPasswordVisible(!isPasswordVisible)}
            style={styles.eyeButton}
            accessibilityRole="button"
            accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
          >
            <Icon
              name={isPasswordVisible ? 'eye-off' : 'eye'}
              size={20}
              color={isFocused ? colors.accent : colors.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>

      {hasError ? (
        <Typography variant="caption" color={colors.error} style={styles.feedbackText}>
          {error}
        </Typography>
      ) : helperText ? (
        <Typography variant="caption" color={colors.textMuted} style={styles.feedbackText}>
          {helperText}
        </Typography>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.base,
    width: '100%',
  },
  label: {
    marginBottom: Spacing.xs,
    fontWeight: '500',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    minHeight: 50,
    paddingHorizontal: Spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.sm,
    height: '100%',
  },
  eyeButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: -Spacing.xs,
  },
  feedbackText: {
    marginTop: Spacing.xs,
    fontSize: 12,
  },
});
