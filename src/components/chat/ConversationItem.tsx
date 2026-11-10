import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { Spacing, BorderRadius } from '@/constants/spacing';
import type { Conversation } from '@/services/api/types';
import { usePartnerPresence } from '@/hooks/usePartnerPresence';
import { formatConversationTimestamp } from '@/utils/date';

export interface ConversationItemProps {
  conversation: Conversation;
  currentUserId?: string | null;
  onPress: () => void;
}

export function ConversationItem({
  conversation,
  currentUserId,
  onPress,
}: ConversationItemProps) {
  const { colors, isDark } = useAppTheme();
  const { otherUser, lastMessage, unreadCount = 0 } = conversation;

  // Real-time partner presence tracking
  const { isOnline } = usePartnerPresence(
    otherUser?.id,
    'offline',
    otherUser?.lastSeenAt || null
  );

  // Avatar monogram
  const displayName = otherUser?.displayName || otherUser?.email || 'Partner';
  const monogram = (displayName.charAt(0) || 'P').toUpperCase();

  // Snippet text & styling
  const isDeleted = Boolean(lastMessage?.isDeleted);
  const isOutgoing = Boolean(lastMessage && currentUserId && lastMessage.senderId === currentUserId);

  let snippetText = 'No messages yet. Say hello!';
  let isSnippetItalic = true;

  if (lastMessage) {
    if (isDeleted) {
      snippetText = 'This message was deleted';
      isSnippetItalic = true;
    } else if (lastMessage.content) {
      snippetText = isOutgoing ? `You: ${lastMessage.content}` : lastMessage.content;
      isSnippetItalic = false;
    }
  }

  const timestampStr = formatConversationTimestamp(
    lastMessage?.createdAt || conversation.updatedAt
  );

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.borderSubtle,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${displayName}`}
    >
      {/* Avatar Container with Online Indicator */}
      <View style={styles.avatarWrapper}>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: colors.accentSubtle,
              borderColor: isDark ? colors.border : colors.accentSubtle,
            },
          ]}
        >
          <Typography
            variant="subtitle"
            color={colors.accentSoft}
            style={styles.avatarText}
          >
            {monogram}
          </Typography>
        </View>

        {/* Presence Indicator Dot */}
        {isOnline && (
          <View
            style={[
              styles.onlineDot,
              {
                backgroundColor: colors.success,
                borderColor: colors.surface,
              },
            ]}
          />
        )}
      </View>

      {/* Conversation Details */}
      <View style={styles.contentContainer}>
        {/* Top Row: Partner Name & Timestamp */}
        <View style={styles.topRow}>
          <Typography
            variant="bodyMedium"
            numberOfLines={1}
            style={[styles.partnerName, { color: colors.textPrimary }]}
          >
            {displayName}
          </Typography>

          {Boolean(timestampStr) && (
            <Typography
              variant="timestamp"
              color={unreadCount > 0 ? colors.accentSoft : colors.textSecondary}
              style={styles.timestamp}
            >
              {timestampStr}
            </Typography>
          )}
        </View>

        {/* Bottom Row: Message Snippet & Unread Badge */}
        <View style={styles.bottomRow}>
          <Typography
            variant="caption"
            numberOfLines={1}
            color={isSnippetItalic ? colors.textMuted : colors.textSecondary}
            style={[styles.snippet, isSnippetItalic && styles.italicSnippet]}
          >
            {snippetText}
          </Typography>

          {unreadCount > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
              <Typography
                variant="label"
                color={colors.primaryForeground}
                style={styles.unreadText}
              >
                {unreadCount > 99 ? '99+' : unreadCount.toString()}
              </Typography>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 68,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: Spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '700',
    fontSize: 18,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: Spacing.xxs,
  },
  partnerName: {
    flex: 1,
    fontWeight: '600',
    fontSize: 16,
    marginRight: Spacing.sm,
  },
  timestamp: {
    fontSize: 12,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  snippet: {
    flex: 1,
    fontSize: 14,
    marginRight: Spacing.sm,
  },
  italicSnippet: {
    fontStyle: 'italic',
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});

