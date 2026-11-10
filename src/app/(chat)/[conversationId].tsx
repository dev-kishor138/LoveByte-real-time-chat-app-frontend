import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { Typography } from '@/components/ui/Typography';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { PresenceBadge } from '@/components/chat/PresenceBadge';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { DateSeparator } from '@/components/chat/DateSeparator';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageComposer, EditingMessage } from '@/components/chat/MessageComposer';
import { MessageActionModal } from '@/components/chat/MessageActionModal';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useChatContext } from '@/context/ChatContext';
import { useMessages } from '@/hooks/useMessages';
import { useTyping } from '@/hooks/useTyping';
import { usePartnerPresence } from '@/hooks/usePartnerPresence';
import { sessionManager } from '@/services/auth/sessionManager';
import { isSameDay } from '@/utils/date';
import { Spacing, BorderRadius, Shadows } from '@/constants/spacing';
import type { ClientMessage } from '@/context/chatTypes';

export default function ActiveChatRoomScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { getConversation } = useChatContext();

  const flatListRef = useRef<FlatList<ClientMessage>>(null);
  const convId = conversationId || '';

  const conversation = convId ? getConversation(convId) : undefined;
  const partner = conversation?.otherUser;
  const partnerName = partner?.displayName || partner?.email || 'Partner';
  const partnerMonogram = (partnerName.charAt(0) || 'P').toUpperCase();
  const currentUserId = sessionManager.getUser()?.id || '';

  // 1. Core Chat Hooks
  const {
    messages,
    isLoading,
    isLoadingOlder,
    hasMoreOlder,
    error,
    sendMessage,
    editMessage,
    deleteMessage,
    loadOlderMessages,
    retrySendMessage,
  } = useMessages(convId);

  const { isPartnerTyping, startTyping, stopTyping } = useTyping(convId);

  const { isOnline, lastSeenAt } = usePartnerPresence(
    partner?.id,
    'offline',
    partner?.lastSeenAt || null
  );

  // 2. Action Modal & Editing State
  const [actionTargetMessage, setActionTargetMessage] = useState<ClientMessage | null>(null);
  const [isActionModalVisible, setIsActionModalVisible] = useState<boolean>(false);
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null);

  // 3. Scroll to bottom tracking
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false);
  const [hasNewUnreadWhileScrolled, setHasNewUnreadWhileScrolled] = useState<boolean>(false);
  const prevMessagesCountRef = useRef<number>(messages.length);

  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current && isScrolledUp) {
      setHasNewUnreadWhileScrolled(true);
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages.length, isScrolledUp]);

  // Inverted display list: index 0 is newest message at bottom
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      if (offsetY > 300) {
        if (!isScrolledUp) setIsScrolledUp(true);
      } else {
        if (isScrolledUp) {
          setIsScrolledUp(false);
          setHasNewUnreadWhileScrolled(false);
        }
      }
    },
    [isScrolledUp]
  );

  const handleScrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    setIsScrolledUp(false);
    setHasNewUnreadWhileScrolled(false);
  }, []);

  // Message Action handlers
  const handleOpenActions = useCallback((message: ClientMessage) => {
    setActionTargetMessage(message);
    setIsActionModalVisible(true);
  }, []);

  const handleCloseActions = useCallback(() => {
    setIsActionModalVisible(false);
    setActionTargetMessage(null);
  }, []);

  const handleStartEdit = useCallback((message: ClientMessage) => {
    if (message.content) {
      setEditingMessage({
        id: message.id,
        content: message.content,
      });
    }
  }, []);

  const handleSaveEdit = useCallback(
    async (messageId: string, newContent: string) => {
      await editMessage(messageId, newContent);
      setEditingMessage(null);
    },
    [editMessage]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
  }, []);

  const handleConfirmDelete = useCallback(
    async (messageId: string) => {
      await deleteMessage(messageId);
    },
    [deleteMessage]
  );

  const handleRetry = useCallback(
    (message: ClientMessage) => {
      const targetId = message.tempId || message.id;
      if (targetId) {
        retrySendMessage(targetId).catch(() => {});
      }
    },
    [retrySendMessage]
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      await sendMessage(content);
      // Auto-scroll to latest on send
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    },
    [sendMessage]
  );

  // Render individual item in inverted FlatList
  const renderItem = useCallback(
    ({ item, index }: { item: ClientMessage; index: number }) => {
      const isOutgoing = item.senderId === currentUserId;
      const olderMessage = reversedMessages[index + 1];
      const isFirstOfDay =
        !olderMessage || !isSameDay(new Date(item.createdAt), new Date(olderMessage.createdAt));

      return (
        <View key={item.id || item.tempId}>
          {isFirstOfDay && <DateSeparator date={item.createdAt} />}
          <MessageBubble
            message={item}
            isOutgoing={isOutgoing}
            onLongPress={handleOpenActions}
            onRetry={handleRetry}
          />
        </View>
      );
    },
    [currentUserId, reversedMessages, handleOpenActions, handleRetry]
  );

  const keyExtractor = useCallback((item: ClientMessage) => item.id || item.tempId || '', []);

  return (
    <ScreenContainer withPadding={false} contentContainerStyle={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <View style={styles.responsiveWrapper}>
          {/* Top Header */}
          <View
            style={[
              styles.header,
              {
                backgroundColor: colors.surface,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => router.back()}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Back to conversations"
            >
              <Typography variant="bodyMedium" color={colors.accent} style={styles.backText}>
                ‹ Back
              </Typography>
            </TouchableOpacity>

            <View style={styles.headerCenter}>
              <View style={styles.partnerInfoRow}>
                <View
                  style={[
                    styles.avatarCircle,
                    {
                      backgroundColor: colors.accentSubtle,
                      borderColor: isDark ? colors.border : colors.accentSubtle,
                    },
                  ]}
                >
                  <Typography variant="label" color={colors.accentSoft} style={styles.avatarText}>
                    {partnerMonogram}
                  </Typography>
                </View>

                <View style={styles.partnerTextGroup}>
                  <Typography variant="bodyMedium" numberOfLines={1} style={styles.headerTitle}>
                    {partnerName}
                  </Typography>
                  <PresenceBadge isOnline={isOnline} lastSeenAt={lastSeenAt} />
                </View>
              </View>
            </View>

            <View style={styles.headerRightPlaceholder} />
          </View>

          {/* Error Banner */}
          {Boolean(error) && (
            <View style={[styles.errorBanner, { backgroundColor: colors.errorBackground }]}>
              <Typography variant="caption" color={colors.error} align="center">
                {error}
              </Typography>
            </View>
          )}

          {/* Active Message Stream */}
          {isLoading && messages.length === 0 ? (
            <View style={styles.loadingContainer}>
              <LoadingIndicator message="Loading conversation..." />
            </View>
          ) : messages.length === 0 ? (
            /* Friendly Empty Chat Room */
            <View style={styles.emptyContainer}>
              <View
                style={[
                  styles.emptyHeartCircle,
                  {
                    backgroundColor: colors.accentSubtle,
                    borderColor: isDark ? colors.border : colors.accentSubtle,
                  },
                ]}
              >
                <Typography variant="title" color={colors.accent} style={styles.heartGlyph}>
                  ♥
                </Typography>
              </View>

              <Typography variant="subtitle" align="center" style={styles.emptyTitle}>
                No messages yet
              </Typography>

              <Typography
                variant="body"
                align="center"
                color={colors.textSecondary}
                style={styles.emptySubtitle}
              >
                Say hello to {partnerName} to start your private conversation!
              </Typography>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={reversedMessages}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              inverted={true}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              onEndReached={() => {
                if (!isLoadingOlder && hasMoreOlder && messages.length >= 50) {
                  loadOlderMessages();
                }
              }}
              onEndReachedThreshold={0.2}
              maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
              ListFooterComponent={
                isLoadingOlder ? (
                  <View style={styles.paginationLoading}>
                    <ActivityIndicator size="small" color={colors.accent} />
                  </View>
                ) : undefined
              }
              contentContainerStyle={styles.listContent}
            />
          )}

          {/* Scroll to Bottom FAB */}
          {isScrolledUp && (
            <TouchableOpacity
              onPress={handleScrollToBottom}
              activeOpacity={0.8}
              style={[
                styles.fab,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
                Shadows.medium,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Scroll to newest messages"
            >
              <Typography variant="bodyMedium" color={colors.accent} style={styles.fabIcon}>
                ↓
              </Typography>

              {hasNewUnreadWhileScrolled && (
                <View style={[styles.fabBadge, { backgroundColor: colors.accent }]} />
              )}
            </TouchableOpacity>
          )}

          {/* Partner Typing Indicator */}
          <TypingIndicator isTyping={isPartnerTyping} partnerName={partnerName} />

          {/* Message Composer Input */}
          <MessageComposer
            onSendMessage={handleSendMessage}
            onSaveEdit={handleSaveEdit}
            editingMessage={editingMessage}
            onCancelEdit={handleCancelEdit}
            onStartTyping={startTyping}
            onStopTyping={stopTyping}
            disabled={!convId}
          />

          {/* Message Action Sheet Modal */}
          <MessageActionModal
            visible={isActionModalVisible}
            message={actionTargetMessage}
            currentUserId={currentUserId}
            onClose={handleCloseActions}
            onStartEdit={handleStartEdit}
            onConfirmDelete={handleConfirmDelete}
            onRetrySend={retrySendMessage}
          />
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  responsiveWrapper: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  backButton: {
    minWidth: 60,
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  partnerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '700',
    fontSize: 14,
  },
  partnerTextGroup: {
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontWeight: '600',
    fontSize: 15,
  },
  headerRightPlaceholder: {
    minWidth: 60,
  },
  errorBanner: {
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.base,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  emptyHeartCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  heartGlyph: {
    fontSize: 24,
  },
  emptyTitle: {
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 280,
  },
  listContent: {
    paddingVertical: Spacing.sm,
  },
  paginationLoading: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: Spacing.base,
    bottom: 74,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99,
  },
  fabIcon: {
    fontSize: 18,
    fontWeight: '700',
  },
  fabBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
