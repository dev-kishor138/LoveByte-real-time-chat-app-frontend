import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from './Typography';
import { Icon } from './Icon';
import { Spacing, BorderRadius } from '@/constants/spacing';

export type AvatarSize = 'sm' | 'md' | 'lg' | number;

export interface AvatarProps {
  name?: string | null;
  size?: AvatarSize;
  isOnline?: boolean;
  showPresence?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({
  name,
  size = 'md',
  isOnline = false,
  showPresence = false,
  style,
}: AvatarProps) {
  const { colors, isDark } = useAppTheme();

  const getDimensions = (): { dimension: number; fontSize: number; presenceDotSize: number } => {
    if (typeof size === 'number') {
      return {
        dimension: size,
        fontSize: Math.round(size * 0.4),
        presenceDotSize: Math.max(8, Math.round(size * 0.22)),
      };
    }
    switch (size) {
      case 'sm':
        return { dimension: 34, fontSize: 13, presenceDotSize: 8 };
      case 'lg':
        return { dimension: 56, fontSize: 22, presenceDotSize: 13 };
      case 'md':
      default:
        return { dimension: 44, fontSize: 17, presenceDotSize: 11 };
    }
  };

  const { dimension, fontSize, presenceDotSize } = getDimensions();

  const trimmed = name?.trim() || '';
  const monogram = trimmed ? trimmed.charAt(0).toUpperCase() : null;

  return (
    <View style={[styles.wrapper, { width: dimension, height: dimension }, style]}>
      <View
        style={[
          styles.circle,
          {
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
            backgroundColor: colors.accentSubtle,
            borderColor: isDark ? colors.border : colors.accentSubtle,
          },
        ]}
      >
        {monogram ? (
          <Typography
            variant="bodyMedium"
            color={colors.accentSoft}
            style={[styles.monogram, { fontSize, lineHeight: fontSize + 4 }]}
          >
            {monogram}
          </Typography>
        ) : (
          <Icon name="user" size={Math.round(dimension * 0.48)} color={colors.accentSoft} />
        )}
      </View>

      {showPresence && isOnline && (
        <View
          style={[
            styles.presenceDot,
            {
              width: presenceDotSize,
              height: presenceDotSize,
              borderRadius: presenceDotSize / 2,
              backgroundColor: colors.success,
              borderColor: colors.surface,
              borderWidth: presenceDotSize > 10 ? 2 : 1.5,
              bottom: 0,
              right: 0,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  monogram: {
    fontWeight: '600',
    textAlign: 'center',
  },
  presenceDot: {
    position: 'absolute',
  },
});

