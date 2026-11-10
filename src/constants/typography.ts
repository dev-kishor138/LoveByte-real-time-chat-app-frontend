import { TextStyle } from 'react-native';

/**
 * LoveByte Typography Tokens
 * Clean, legible scale tailored for high legibility on Android devices.
 */

export const Typography = {
  sizes: {
    xxs: 11,
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    display: 32,
  },
  lineHeights: {
    xxs: 14,
    xs: 16,
    sm: 20,
    base: 24,
    lg: 26,
    xl: 28,
    xxl: 32,
    display: 40,
  },
  weights: {
    regular: '400' as TextStyle['fontWeight'],
    medium: '500' as TextStyle['fontWeight'],
    semibold: '600' as TextStyle['fontWeight'],
    bold: '700' as TextStyle['fontWeight'],
  },
  letterSpacings: {
    tight: -0.5,
    normal: 0,
    wide: 0.2,
    uppercase: 0.8,
  },
} as const;
