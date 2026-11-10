import React from 'react';
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Spacing } from '@/constants/spacing';

export interface ScreenContainerProps {
  children: React.ReactNode;
  scrollable?: boolean;
  withPadding?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
}

export function ScreenContainer({
  children,
  scrollable = false,
  withPadding = true,
  style,
  contentContainerStyle,
}: ScreenContainerProps) {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();

  const containerPadding: ViewStyle = withPadding
    ? {
        paddingHorizontal: Spacing.base,
      }
    : {};

  const safeAreaStyle: ViewStyle = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };

  const webContainerStyle: ViewStyle =
    Platform.OS === 'web'
      ? {
          maxWidth: 480,
          width: '100%',
          alignSelf: 'center',
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: colors.borderSubtle,
        }
      : {};

  const content = scrollable ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, containerPadding, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fixedContent, containerPadding, contentContainerStyle]}>
      {children}
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background },
        safeAreaStyle,
        webContainerStyle,
        style,
      ]}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {content}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  fixedContent: {
    flex: 1,
  },
});
