import React, { useState } from 'react';
import {
  TouchableOpacity,
  TouchableOpacityProps,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from './Typography';
import { Spacing, BorderRadius } from '@/constants/spacing';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  onPress,
  ...props
}: ButtonProps) {
  const { colors } = useAppTheme();
  const [isPressed, setIsPressed] = useState(false);
  const isDisabled = disabled || loading;

  const getContainerStyle = (): ViewStyle => {
    let bg: string = colors.primary;
    let border: string = 'transparent';
    let borderWidth = 0;

    switch (variant) {
      case 'primary':
        bg = isDisabled
          ? colors.buttonDisabled
          : isPressed
          ? colors.primaryHover
          : colors.primary;
        break;
      case 'secondary':
        bg = isDisabled ? colors.buttonDisabled : colors.surface;
        border = colors.border;
        borderWidth = 1;
        break;
      case 'outline':
        bg = 'transparent';
        border = isDisabled ? colors.border : colors.border;
        borderWidth = 1.5;
        break;
      case 'ghost':
        bg = isPressed ? colors.surface : 'transparent';
        break;
      case 'accent':
        bg = isDisabled ? colors.buttonDisabled : colors.accent;
        break;
    }

    const paddingVertical =
      size === 'sm' ? Spacing.sm : size === 'lg' ? Spacing.base : Spacing.md;
    const paddingHorizontal =
      size === 'sm' ? Spacing.md : size === 'lg' ? Spacing.xl : Spacing.base;
    const minHeight = size === 'sm' ? 38 : size === 'lg' ? 54 : 48;

    return {
      backgroundColor: bg,
      borderColor: border,
      borderWidth,
      borderRadius: BorderRadius.md,
      paddingVertical,
      paddingHorizontal,
      minHeight,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: fullWidth ? 'stretch' : 'auto',
      opacity: isDisabled && (variant === 'ghost' || variant === 'outline') ? 0.45 : 1,
    };
  };

  const getTextColor = (): string => {
    if (isDisabled) {
      return colors.textDisabled;
    }
    switch (variant) {
      case 'primary':
        return colors.primaryForeground; // Always pure white on #7549D6
      case 'accent':
        return colors.primaryForeground;
      case 'secondary':
      case 'outline':
      case 'ghost':
        return colors.textPrimary;
      default:
        return colors.primaryForeground;
    }
  };

  const getTextVariant = () => {
    switch (size) {
      case 'sm':
        return 'caption';
      case 'lg':
        return 'subtitle';
      default:
        return 'bodyMedium';
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={isDisabled}
      onPress={onPress}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      style={[getContainerStyle(), style]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <Typography
          variant={getTextVariant()}
          color={getTextColor()}
          style={styles.text}
        >
          {title}
        </Typography>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  text: {
    letterSpacing: 0.2,
    fontWeight: '600',
  },
});
