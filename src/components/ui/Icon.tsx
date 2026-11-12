import React from 'react';
import { StyleProp, TextStyle, View, StyleSheet } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

export type IconName =
  | 'heart'
  | 'arrow-left'
  | 'arrow-down'
  | 'send'
  | 'plus'
  | 'log-out'
  | 'eye'
  | 'eye-off'
  | 'edit'
  | 'trash'
  | 'refresh'
  | 'check'
  | 'check-all'
  | 'clock'
  | 'alert-circle'
  | 'x'
  | 'user'
  | 'message-circle'
  | 'lock'
  | 'key'
  | 'mail'
  | 'info';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Unified Vector Icon component for LoveByte.
 * Provides a cohesive, minimalist aesthetic utilizing Feather as the primary
 * design language, with Ionicons for messaging-specific glyphs (such as checkmark-done).
 */
export function Icon({ name, size = 20, color = '#FFFFFF', style }: IconProps) {
  switch (name) {
    case 'heart':
      return <Feather name="heart" size={size} color={color} style={style} />;
    case 'arrow-left':
      return <Feather name="arrow-left" size={size} color={color} style={style} />;
    case 'arrow-down':
      return <Feather name="arrow-down" size={size} color={color} style={style} />;
    case 'send':
      return <Feather name="send" size={size} color={color} style={style} />;
    case 'plus':
      return <Feather name="plus" size={size} color={color} style={style} />;
    case 'log-out':
      return <Feather name="log-out" size={size} color={color} style={style} />;
    case 'eye':
      return <Feather name="eye" size={size} color={color} style={style} />;
    case 'eye-off':
      return <Feather name="eye-off" size={size} color={color} style={style} />;
    case 'edit':
      return <Feather name="edit-2" size={size} color={color} style={style} />;
    case 'trash':
      return <Feather name="trash-2" size={size} color={color} style={style} />;
    case 'refresh':
      return <Feather name="refresh-cw" size={size} color={color} style={style} />;
    case 'check':
      return <Feather name="check" size={size} color={color} style={style} />;
    case 'check-all':
      return <Ionicons name="checkmark-done" size={size + 2} color={color} style={style} />;
    case 'clock':
      return <Feather name="clock" size={size} color={color} style={style} />;
    case 'alert-circle':
      return <Feather name="alert-circle" size={size} color={color} style={style} />;
    case 'x':
      return <Feather name="x" size={size} color={color} style={style} />;
    case 'user':
      return <Feather name="user" size={size} color={color} style={style} />;
    case 'message-circle':
      return <Feather name="message-circle" size={size} color={color} style={style} />;
    case 'lock':
      return <Feather name="lock" size={size} color={color} style={style} />;
    case 'key':
      return <Feather name="key" size={size} color={color} style={style} />;
    case 'mail':
      return <Feather name="mail" size={size} color={color} style={style} />;
    case 'info':
      return <Feather name="info" size={size} color={color} style={style} />;
    default:
      return null;
  }
}

