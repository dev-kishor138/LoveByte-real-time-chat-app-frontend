import { useColorScheme } from 'react-native';
import { Colors, ThemeColors } from '@/constants/colors';

export interface AppTheme {
  colors: ThemeColors;
  isDark: boolean;
  colorScheme: 'light' | 'dark';
}

/**
 * Accesses active theme tokens based on device system preference.
 * Defaults to light mode as approved in design specifications.
 */
export function useAppTheme(): AppTheme {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  return {
    colors,
    isDark,
    colorScheme: isDark ? 'dark' : 'light',
  };
}

