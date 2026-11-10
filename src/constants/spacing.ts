import { ViewStyle } from 'react-native';

/**
 * LoveByte Spacing, Radius, and Shadow Tokens
 * Strict 4-point / 8-point rhythmic grid for unified visual balance.
 */

export const Spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
} as const;

export const BorderRadius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  bubble: 18,
  full: 9999,
} as const;

/**
 * Cross-platform shadow tokens (Android elevation + iOS drop shadow)
 */
export const Shadows = {
  none: {
    elevation: 0,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  } as ViewStyle,
  subtle: {
    elevation: 1,
    shadowColor: '#111116',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  } as ViewStyle,
  medium: {
    elevation: 3,
    shadowColor: '#111116',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  } as ViewStyle,
  card: {
    elevation: 2,
    shadowColor: '#111116',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  } as ViewStyle,
  purpleGlow: {
    elevation: 4,
    shadowColor: '#8969E8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  } as ViewStyle,
} as const;
