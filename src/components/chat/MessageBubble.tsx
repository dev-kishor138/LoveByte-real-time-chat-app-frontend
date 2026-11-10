import React from 'react';
import { View, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { formatTime } from '@/utils/date';
import type { ClientMessage, MessageDeliveryStatus } from '@/context/chatTypes';
import { Spacing, BorderRadius } from '@/constants/spacing';

export interface MessageBubbleProps {
  message: ClientMessage;
  isOutgoing: boolean;
  onLongPress?: (message: ClientMessage) => void;
  onRetry?: (message: ClientMessage) => void;
  style?: ViewStyle;
}

/**
 * Message Bubble component rendering incoming and outgoing text messages.
 * Displays content, timestamps, edited labels, soft-delete tombstones, and delivery ticks.
 */
export function MessageBubble({
  message,
  isOutgoing,
  onLongPress,
  onRetry,
  style,
}: MessageBubbleProps) {
  const { colors, isDark } = useAppTheme();

  const isDeleted = Boolean(message.isDeleted);
  const isEdited = Boolean(message.isEdited) && !isDeleted;
  const deliveryStatus: MessageDeliveryStatus = isOutgoing
    ? message.localStatus || (message.readAt ? 'read' : 'sent')
    : 'sent';

  const timeString = message.createdAt ? formatTime(new Date(message.createdAt)) : '';

  // Delivery status glyph and color
  const renderStatusIndicator = () => {
    if (!isOutgoing || isDeleted) return null;

    switch (deliveryStatus) {
      case 'pending':
        return (
          <Typography
            variant="timestamp"
            color={colors.bubbleOutgoingTime}
            style={styles.statusTick}
            accessibilityLabel="Pending network connection"
          >
            ⏳
          </Typography>
        );
      case 'sending':
        return (
          <Typography
            variant="timestamp"
            color={colors.bubbleOutgoingTime}
            style={styles.statusTick}
            accessibilityLabel="Sending message"
          >
            ◷
          </Typography>
        );
      case 'sent':
        return (
          <Typography
            variant="timestamp"
            color={colors.bubbleOutgoingTime}
            style={styles.statusTick}
            accessibilityLabel="Sent"
          >
            ✓
          </Typography>
        );
      case 'read':
        return (
          <Typography
            variant="timestamp"
            color={colors.bubbleOutgoingTime}
            style={[styles.statusTick, styles.readTick]}
            accessibilityLabel="Read by partner"
          >
            ✓✓
          </Typography>
        );
      case 'failed':
        return (
          <TouchableOpacity
            onPress={() => onRetry?.(message)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.failedRow}
            accessibilityRole="button"
            accessibilityLabel="Message failed to send. Tap to retry."
          >
            <Typography variant="timestamp" color="#FF8080" style={styles.failedText}>
              ! Failed · Tap to retry
            </Typography>
          </TouchableOpacity>
        );
      case 'uncertain':
        return (
          <TouchableOpacity
            onPress={() => onRetry?.(message)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Message delivery uncertain due to network disruption. Tap to retry."
          >
            <Typography
              variant="timestamp"
              color="#FFD166"
              style={styles.statusTick}
            >
              ⚠
            </Typography>
          </TouchableOpacity>
        );
      default:
        return null;
    }
  };

  const bubbleBg = isOutgoing ? colors.bubbleOutgoing : colors.bubbleIncoming;
  const textColor = isOutgoing ? colors.bubbleOutgoingText : colors.bubbleIncomingText;
  const timeColor = isOutgoing ? colors.bubbleOutgoingTime : colors.bubbleIncomingTime;

  return (
    <View
      style={[
        styles.outerContainer,
        isOutgoing ? styles.outgoingOuter : styles.incomingOuter,
        style,
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        onLongPress={() => onLongPress?.(message)}
        disabled={!onLongPress}
        style={[
          styles.bubble,
          isOutgoing ? styles.outgoingBubble : styles.incomingBubble,
          {
            backgroundColor: bubbleBg,
            borderColor: !isOutgoing
              ? isDark
                ? colors.border
                : colors.borderSubtle
              : 'transparent',
            borderWidth: !isOutgoing ? 1 : 0,
          },
        ]}
        accessibilityRole="text"
        accessibilityLabel={
          isDeleted
            ? 'Deleted message'
            : `${isOutgoing ? 'Your message' : 'Partner message'}: ${message.content || ''}`
        }
      >
        {/* Message Content or Deleted Tombstone */}
        {isDeleted ? (
          <Typography
            variant="body"
            color={isOutgoing ? colors.bubbleOutgoingTime : colors.textMuted}
            style={styles.deletedText}
          >
            This message was deleted
          </Typography>
        ) : (
          <Typography
            variant="body"
            color={textColor}
            selectable={true}
            style={styles.messageContent}
          >
            {message.content}
          </Typography>
        )}

        {/* Footer: Timestamp, Edited flag, and Delivery tick */}
        <View style={styles.metaRow}>
          {isEdited && (
            <Typography
              variant="timestamp"
              color={timeColor}
              style={styles.editedLabel}
              accessibilityLabel="Edited"
            >
              (edited)
            </Typography>
          )}

          {Boolean(timeString) && (
            <Typography variant="timestamp" color={timeColor} style={styles.timestamp}>
              {timeString}
            </Typography>
          )}

          {renderStatusIndicator()}
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    marginVertical: Spacing.xxs + 1,
    paddingHorizontal: Spacing.base,
    width: '100%',
  },
  incomingOuter: {
    alignItems: 'flex-start',
  },
  outgoingOuter: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm - 2,
    borderRadius: BorderRadius.bubble,
  },
  incomingBubble: {
    borderBottomLeftRadius: 4,
  },
  outgoingBubble: {
    borderBottomRightRadius: 4,
  },
  messageContent: {
    fontSize: 15,
    lineHeight: 21,
  },
  deletedText: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: Spacing.xs - 2,
    gap: Spacing.xs,
  },
  editedLabel: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  timestamp: {
    fontSize: 11,
  },
  statusTick: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 1,
  },
  readTick: {
    letterSpacing: -1.5,
  },
  failedRow: {
    marginLeft: 2,
  },
  failedText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

