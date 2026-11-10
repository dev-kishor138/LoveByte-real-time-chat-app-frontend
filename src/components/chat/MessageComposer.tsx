import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
} from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { Spacing, BorderRadius } from '@/constants/spacing';

export interface EditingMessage {
  id: string;
  content: string;
}

export interface MessageComposerProps {
  onSendMessage: (content: string) => Promise<void>;
  onSaveEdit: (messageId: string, content: string) => Promise<void>;
  editingMessage: EditingMessage | null;
  onCancelEdit: () => void;
  onStartTyping: () => void;
  onStopTyping: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}

const MAX_MESSAGE_LENGTH = 5000;
const CHAR_WARNING_THRESHOLD = 4500;

/**
 * Message composer input bar supporting multiline entry, 5000-character validation,
 * typing indicator emissions, duplicate submission prevention, and inline editing mode.
 */
export function MessageComposer({
  onSendMessage,
  onSaveEdit,
  editingMessage,
  onCancelEdit,
  onStartTyping,
  onStopTyping,
  disabled = false,
  style,
}: MessageComposerProps) {
  const { colors, isDark } = useAppTheme();
  const [text, setText] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const inputRef = useRef<any>(null);

  // Sync composer input when editing mode is activated or cancelled
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.content);
      inputRef.current?.focus();
    } else {
      setText('');
    }
  }, [editingMessage]);

  const handleTextChange = useCallback(
    (newText: string) => {
      setText(newText);

      // Typing events are only emitted during active message composition (not editing)
      if (!editingMessage) {
        if (newText.trim().length > 0) {
          onStartTyping();
        } else {
          onStopTyping();
        }
      }
    },
    [editingMessage, onStartTyping, onStopTyping]
  );

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSubmitting || disabled) return;

    if (trimmed.length > MAX_MESSAGE_LENGTH) return;

    setIsSubmitting(true);
    try {
      if (editingMessage) {
        await onSaveEdit(editingMessage.id, trimmed);
        onCancelEdit();
        setText('');
      } else {
        onStopTyping();
        setText('');
        await onSendMessage(trimmed);
      }
    } catch {
      // Errors handled by parent/hooks
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEditing = Boolean(editingMessage);
  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_MESSAGE_LENGTH && !isSubmitting && !disabled;
  const showCharWarning = text.length > CHAR_WARNING_THRESHOLD;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        style,
      ]}
    >
      {/* Editing Mode Banner */}
      {isEditing && (
        <View
          style={[
            styles.editBanner,
            {
              backgroundColor: isDark ? colors.surfaceElevated : colors.accentSubtle,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.editInfo}>
            <Typography variant="label" color={colors.accentSoft} style={styles.editLabel}>
              Editing Message
            </Typography>
            <Typography
              variant="caption"
              color={colors.textSecondary}
              numberOfLines={1}
              style={styles.editSnippet}
            >
              {editingMessage?.content}
            </Typography>
          </View>

          <TouchableOpacity
            onPress={onCancelEdit}
            style={styles.cancelEditButton}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
          >
            <Typography variant="bodyMedium" color={colors.textMuted} style={styles.cancelEditText}>
              ✕
            </Typography>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Composer Row */}
      <View style={styles.inputRow}>
        <View
          style={[
            styles.inputWrapper,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
            },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={handleTextChange}
            placeholder={isEditing ? 'Edit your message...' : 'Message your partner...'}
            placeholderTextColor={colors.inputPlaceholder}
            multiline={true}
            maxLength={MAX_MESSAGE_LENGTH}
            editable={!disabled && !isSubmitting}
            style={[
              styles.input,
              {
                color: colors.textPrimary,
              },
            ]}
          />

          {showCharWarning && (
            <Typography
              variant="timestamp"
              color={text.length >= MAX_MESSAGE_LENGTH ? colors.error : colors.textMuted}
              style={styles.charCounter}
            >
              {text.length}/{MAX_MESSAGE_LENGTH}
            </Typography>
          )}
        </View>

        {/* Send / Save Button */}
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.8}
          style={[
            styles.sendButton,
            {
              backgroundColor: canSubmit ? colors.primary : colors.buttonDisabled,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'Save edited message' : 'Send message'}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Typography
              variant="bodyMedium"
              color={canSubmit ? colors.primaryForeground : colors.textDisabled}
              style={styles.sendIcon}
            >
              {isEditing ? '✓' : '↑'}
            </Typography>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  editLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  editSnippet: {
    fontSize: 12,
  },
  cancelEditButton: {
    padding: Spacing.xs,
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelEditText: {
    fontSize: 14,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  inputWrapper: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.xs + 2,
    justifyContent: 'center',
  },
  input: {
    fontSize: 15,
    lineHeight: 20,
    paddingTop: 0,
    paddingBottom: 0,
    margin: 0,
  },
  charCounter: {
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
});
