import React from 'react';
import { Text, TextProps, TextStyle } from 'react-native';
import { Typography as Typo } from '@/constants/typography';
import { useAppTheme } from '@/hooks/useAppTheme';

export type TypographyVariant =
  | 'display'
  | 'title'
  | 'subtitle'
  | 'body'
  | 'bodyMedium'
  | 'caption'
  | 'label'
  | 'timestamp';

export interface TypographyProps extends TextProps {
  variant?: TypographyVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  children: React.ReactNode;
}

export function Typography({
  variant = 'body',
  color,
  align = 'left',
  style,
  children,
  ...props
}: TypographyProps) {
  const { colors } = useAppTheme();

  const variantStyles: Record<TypographyVariant, TextStyle> = {
    display: {
      fontSize: Typo.sizes.display,
      lineHeight: Typo.lineHeights.display,
      fontWeight: Typo.weights.bold,
      letterSpacing: Typo.letterSpacings.tight,
      color: colors.textPrimary,
    },
    title: {
      fontSize: Typo.sizes.xxl,
      lineHeight: Typo.lineHeights.xxl,
      fontWeight: Typo.weights.bold,
      letterSpacing: Typo.letterSpacings.tight,
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: Typo.sizes.lg,
      lineHeight: Typo.lineHeights.lg,
      fontWeight: Typo.weights.semibold,
      color: colors.textPrimary,
    },
    body: {
      fontSize: Typo.sizes.base,
      lineHeight: Typo.lineHeights.base,
      fontWeight: Typo.weights.regular,
      letterSpacing: Typo.letterSpacings.normal,
      color: colors.textPrimary,
    },
    bodyMedium: {
      fontSize: Typo.sizes.base,
      lineHeight: Typo.lineHeights.base,
      fontWeight: Typo.weights.medium,
      letterSpacing: Typo.letterSpacings.normal,
      color: colors.textPrimary,
    },
    caption: {
      fontSize: Typo.sizes.sm,
      lineHeight: Typo.lineHeights.sm,
      fontWeight: Typo.weights.regular,
      color: colors.textSecondary,
    },
    label: {
      fontSize: Typo.sizes.xs,
      lineHeight: Typo.lineHeights.xs,
      fontWeight: Typo.weights.semibold,
      letterSpacing: Typo.letterSpacings.uppercase,
      textTransform: 'uppercase',
      color: colors.textMuted,
    },
    timestamp: {
      fontSize: Typo.sizes.xxs,
      lineHeight: Typo.lineHeights.xxs,
      fontWeight: Typo.weights.medium,
      color: colors.textMuted,
    },
  };

  return (
    <Text
      style={[
        variantStyles[variant],
        color ? { color } : undefined,
        align ? { textAlign: align } : undefined,
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}
