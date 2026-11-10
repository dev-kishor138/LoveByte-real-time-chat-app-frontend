import { useState, useCallback, useMemo } from 'react';
import { useChatContext } from '../context/ChatContext.tsx';
import { chatApi } from '../services/api/chat.ts';
import { sessionManager } from '../services/auth/sessionManager.ts';
import type { Conversation } from '../services/api/types.ts';

export interface UseConversationsResult {
  conversations: Conversation[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  hasMore: boolean;
  totalUnreadCount: number;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  createConversation: (recipientEmail: string) => Promise<Conversation>;
}

/**
 * Hook for managing the conversation list screen.
 * Integrates shared ChatContext state with cursor pagination, pull-to-refresh,
 * and session generation guards (FINDING-03 & FINDING-04).
 */
export function useConversations(): UseConversationsResult {
  const {
    conversations,
    isLoadingConversations,
    conversationsError,
    totalUnreadCount,
    refreshConversations,
    appendOlderConversations,
    createConversation,
  } = useChatContext();

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);

  // Pull-to-refresh handler with generation guard
  const refresh = useCallback(async (): Promise<void> => {
    const opGen = sessionManager.getGenerationId();
    setIsRefreshing(true);
    try {
      await refreshConversations();
      if (opGen === sessionManager.getGenerationId()) {
        setHasMore(true);
      }
    } finally {
      if (opGen === sessionManager.getGenerationId()) {
        setIsRefreshing(false);
      }
    }
  }, [refreshConversations]);

  // Cursor-based pagination handler for conversations (FINDING-04 & FINDING-03)
  const loadMore = useCallback(async (): Promise<void> => {
    if (isLoadingMore || !hasMore || conversations.length === 0) {
      return;
    }

    const oldestConversation = conversations[conversations.length - 1];
    if (!oldestConversation) return;

    const opGen = sessionManager.getGenerationId();
    setIsLoadingMore(true);

    try {
      const older = await chatApi.listConversations({
        limit: 20,
        cursor: oldestConversation.id,
      });

      if (opGen !== sessionManager.getGenerationId()) {
        return;
      }

      if (older.length < 20) {
        setHasMore(false);
      }

      if (older.length > 0) {
        // Commit paginated records to shared ChatContext state
        appendOlderConversations(older);
      } else {
        setHasMore(false);
      }
    } catch {
      // Ignore background pagination error
    } finally {
      if (opGen === sessionManager.getGenerationId()) {
        setIsLoadingMore(false);
      }
    }
  }, [isLoadingMore, hasMore, conversations, appendOlderConversations]);

  return {
    conversations,
    isLoading: isLoadingConversations,
    isRefreshing,
    error: conversationsError,
    hasMore,
    totalUnreadCount,
    refresh,
    loadMore,
    createConversation,
  };
}

