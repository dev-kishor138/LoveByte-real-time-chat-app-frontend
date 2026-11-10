import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { Typography } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { ConversationItem } from '@/components/chat/ConversationItem';
import { EmptyChatState } from '@/components/chat/EmptyChatState';
import { StartConversationModal } from '@/components/chat/StartConversationModal';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useAuth } from '@/context/AuthContext';
import { useChatContext } from '@/context/ChatContext';
import { useConversations } from '@/hooks/useConversations';
import { Spacing, BorderRadius } from '@/constants/spacing';
import type { Conversation } from '@/services/api/types';

export default function ConversationListScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { user, logout } = useAuth();
  const { socketStatus, setActiveConversationId } = useChatContext();

  const {
    conversations,
    isLoading,
    isRefreshing,
    error,
    refresh,
    loadMore,
    createConversation,
  } = useConversations();

  const [isStartModalVisible, setIsStartModalVisible] = useState(false);

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      setActiveConversationId(conversationId);
      router.push({
        pathname: '/(chat)/[conversationId]',
        params: { conversationId },
      } as any);
    },
    [setActiveConversationId, router]
  );

  const handleStartConversationSubmit = useCallback(
    async (recipientEmail: string) => {
      const newConversation = await createConversation(recipientEmail);
      if (newConversation?.id) {
        setActiveConversationId(newConversation.id);
        router.push({
          pathname: '/(chat)/[conversationId]',
          params: { conversationId: newConversation.id },
        } as any);
      }
    },
    [createConversation, setActiveConversationId, router]
  );

  const handleLogout = useCallback(async () => {
    await logout();
    router.replace('/(auth)/login');
  }, [logout, router]);

  const renderSocketStatus = () => {
    if (socketStatus === 'connected') {
      return (
        <View style={styles.socketStatusRow}>
          <View style={[styles.socketDot, { backgroundColor: colors.success }]} />
          <Typography variant="timestamp" color={colors.textSecondary}>
            Live
          </Typography>
        </View>
      );
    }

    if (socketStatus === 'connecting' || socketStatus === 'reconnecting') {
      return (
        <View style={[styles.statusPill, { backgroundColor: colors.accentSubtle }]}>
          <Typography variant="timestamp" color={colors.accentSoft}>
            Connecting...
          </Typography>
        </View>
      );
    }

    return (
      <View style={[styles.statusPill, { backgroundColor: colors.errorBackground }]}>
        <Typography variant="timestamp" color={colors.error}>
          Offline
        </Typography>
      </View>
    );
  };

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ConversationItem
        conversation={item}
        currentUserId={user?.id}
        onPress={() => handleSelectConversation(item.id)}
      />
    ),
    [user?.id, handleSelectConversation]
  );

  return (
    <ScreenContainer withPadding={false} contentContainerStyle={styles.container}>
      {/* Top Application Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {/* Branding & Status */}
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.brandBadge,
              {
                backgroundColor: colors.accentSubtle,
                borderColor: isDark ? colors.border : colors.accentSubtle,
              },
            ]}
          >
            <Typography variant="label" color={colors.accentSoft} style={styles.heartGlyph}>
              ♥
            </Typography>
          </View>

          <View>
            <Typography variant="title" style={styles.headerTitle}>
              LoveByte
            </Typography>
            {renderSocketStatus()}
          </View>
        </View>

        {/* Action Controls: New Conversation & Logout */}
        <View style={styles.headerActions}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setIsStartModalVisible(true)}
            style={[
              styles.iconButton,
              {
                backgroundColor: colors.accentSubtle,
                borderColor: isDark ? colors.border : colors.accentSubtle,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Start new conversation"
          >
            <Typography variant="subtitle" color={colors.accentSoft} style={styles.plusIcon}>
              +
            </Typography>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleLogout}
            style={styles.logoutButton}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Typography variant="caption" color={colors.error} style={styles.logoutText}>
              Logout
            </Typography>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Area */}
      {isLoading && conversations.length === 0 ? (
        <View style={styles.centerContainer}>
          <LoadingIndicator size="large" message="Loading conversations..." />
        </View>
      ) : error && conversations.length === 0 ? (
        <View style={styles.centerContainer}>
          <Typography variant="subtitle" color={colors.error} style={styles.errorTitle}>
            Unable to load conversations
          </Typography>
          <Typography
            variant="body"
            align="center"
            color={colors.textSecondary}
            style={styles.errorSubtitle}
          >
            {error}
          </Typography>
          <Button
            title="Retry"
            variant="outline"
            size="md"
            onPress={refresh}
            style={styles.retryButton}
          />
        </View>
      ) : conversations.length === 0 ? (
        <EmptyChatState onStartConversation={() => setIsStartModalVisible(true)} />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.2}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Start Conversation Modal */}
      <StartConversationModal
        visible={isStartModalVisible}
        onClose={() => setIsStartModalVisible(false)}
        onSubmit={handleStartConversationSubmit}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  brandBadge: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartGlyph: {
    fontSize: 18,
    lineHeight: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  socketStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  socketDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPill: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: BorderRadius.xs,
    alignSelf: 'flex-start',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIcon: {
    fontSize: 24,
    fontWeight: '400',
    lineHeight: 26,
  },
  logoutButton: {
    minHeight: 44,
    minWidth: 50,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  logoutText: {
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  errorTitle: {
    marginBottom: Spacing.xs,
  },
  errorSubtitle: {
    maxWidth: 280,
    marginBottom: Spacing.lg,
  },
  retryButton: {
    minWidth: 120,
  },
  listContent: {
    flexGrow: 1,
  },
});
