import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ViewStyle,
  Keyboard,
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
  keyboardAvoiding?: boolean;
  keyboardBehavior?: 'padding' | 'height' | 'position';
  keyboardVerticalOffset?: number;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
}

export function ScreenContainer({
  children,
  scrollable = false,
  withPadding = true,
  style,
  contentContainerStyle,
  keyboardAvoiding,
  keyboardBehavior,
  keyboardVerticalOffset = 0,
  keyboardShouldPersistTaps = 'handled',
}: ScreenContainerProps) {
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const containerPadding: ViewStyle = withPadding
    ? {
        paddingHorizontal: Spacing.base,
      }
    : {};

  // On Android with softwareKeyboardLayoutMode="resize", the window resizes natively
  // to sit above the keyboard. Retaining bottom insets when the keyboard is open causes
  // redundant spacing or input clipping.
  const effectiveBottomInset =
    Platform.OS === 'android' && isKeyboardVisible ? 0 : insets.bottom;

  const safeAreaStyle: ViewStyle = {
    paddingTop: insets.top,
    paddingBottom: effectiveBottomInset,
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
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fixedContent, containerPadding, contentContainerStyle]}>
      {children}
    </View>
  );

  // Platform-aware keyboard avoidance: On Android with resize mode, native window resizing
  // handles keyboard adjustment. On iOS, KeyboardAvoidingView provides smooth padding.
  const shouldAvoidKeyboard =
    keyboardAvoiding !== undefined
      ? keyboardAvoiding
      : scrollable && Platform.OS === 'ios';

  const defaultBehavior = Platform.OS === 'ios' ? 'padding' : undefined;

  const renderedContent = shouldAvoidKeyboard ? (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={keyboardBehavior || defaultBehavior}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
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
      {renderedContent}
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
