import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { chatApi } from '../services/api/chat.ts';
import type { Conversation, LastMessage } from '../services/api/types.ts';
import { socketClient, type SocketConnectionState } from '../services/socket/socketClient.ts';
import { sessionManager, type SessionEvent } from '../services/auth/sessionManager.ts';
import type { ChatContextValue } from './chatTypes.ts';
import {
  updateConversationWithLastMessage,
  markConversationReadInList,
} from './chatReducers.ts';

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketConnectionState>(
    socketClient.getState()
  );

  const currentUserId = sessionManager.getUser()?.id || null;

  // 1. Fetch conversations from REST API with session generation guards (FINDING-03)
  const refreshConversations = useCallback(async (): Promise<void> => {
    if (!sessionManager.isAuthenticated()) {
      setConversations([]);
      return;
    }

    const opGen = sessionManager.getGenerationId();
    setIsLoadingConversations(true);
    setConversationsError(null);

    try {
      const data = await chatApi.listConversations();
      if (opGen !== sessionManager.getGenerationId()) {
        return;
      }
      setConversations(data);
    } catch (err: any) {
      if (opGen !== sessionManager.getGenerationId()) {
        return;
      }
      setConversationsError(err?.message || 'Failed to load conversations');
    } finally {
      if (opGen === sessionManager.getGenerationId()) {
        setIsLoadingConversations(false);
      }
    }
  }, []);

  // 2. Subscribe to SessionManager events (reset on logout, load on login)
  useEffect(() => {
    const unsubSession = sessionManager.subscribe((event: SessionEvent) => {
      switch (event.type) {
        case 'AUTHENTICATED':
          refreshConversations().catch(() => {});
          break;
        case 'UNAUTHENTICATED':
        case 'PROFILE_UNVERIFIED':
          setConversations([]);
          setActiveConversationId(null);
          setConversationsError(null);
          break;
      }
    });

    // If authenticated at mount, load conversations
    if (sessionManager.isAuthenticated()) {
      refreshConversations().catch(() => {});
    }

    return unsubSession;
  }, [refreshConversations]);

  // 3. Subscribe to Socket Connection State transitions
  useEffect(() => {
    const unsubSocketState = socketClient.subscribeState((newState) => {
      setSocketStatus(newState);
    });
    return unsubSocketState;
  }, []);

  // 4. Global Socket Event Subscriptions for conversation list synchronization
  useEffect(() => {
    const unsubNewMessage = socketClient.on('new_message', (payload) => {
      setConversations((prev) => {
        const lastMsg: LastMessage = {
          id: payload.id,
          senderId: payload.senderId,
          type: payload.type,
          content: payload.isDeleted ? null : payload.content,
          isEdited: payload.isEdited,
          editedAt: payload.editedAt,
          isDeleted: payload.isDeleted,
          readAt: payload.readAt || null,
          createdAt: payload.createdAt,
        };

        const exists = prev.some((c) => c.id === payload.conversationId);
        if (!exists) {
          // If conversation is brand new, refresh the list
          refreshConversations().catch(() => {});
          return prev;
        }

        const isCurrentActive = activeConversationId === payload.conversationId;
        return updateConversationWithLastMessage(
          prev,
          payload.conversationId,
          lastMsg,
          isCurrentActive,
          sessionManager.getUser()?.id
        );
      });
    });

    const unsubMessageSent = socketClient.on('message_sent', (payload) => {
      setConversations((prev) => {
        const lastMsg: LastMessage = {
          id: payload.id,
          senderId: payload.senderId,
          type: payload.type,
          content: payload.isDeleted ? null : payload.content,
          isEdited: payload.isEdited,
          editedAt: payload.editedAt,
          isDeleted: payload.isDeleted,
          readAt: payload.readAt || null,
          createdAt: payload.createdAt,
        };

        const isCurrentActive = activeConversationId === payload.conversationId;
        return updateConversationWithLastMessage(
          prev,
          payload.conversationId,
          lastMsg,
          isCurrentActive,
          sessionManager.getUser()?.id
        );
      });
    });

    const unsubMessageEdited = socketClient.on('message_edited', (payload) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === payload.conversationId && c.lastMessage?.id === payload.id) {
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                content: payload.content,
                isEdited: payload.isEdited,
                editedAt: payload.editedAt,
              },
            };
          }
          return c;
        })
      );
    });

    const unsubMessageDeleted = socketClient.on('message_deleted', (payload) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === payload.conversationId && c.lastMessage?.id === payload.id) {
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                content: null,
                isDeleted: true,
              },
            };
          }
          return c;
        })
      );
    });

    const unsubMessagesRead = socketClient.on('messages_read', (payload) => {
      setConversations((prev) => {
        const myId = sessionManager.getUser()?.id;
        if (payload.readerId === myId) {
          return markConversationReadInList(prev, payload.conversationId);
        }
        return prev;
      });
    });

    const unsubUserPresence = socketClient.on('user_presence', (payload) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.otherUser?.id === payload.userId) {
            return {
              ...c,
              otherUser: {
                ...c.otherUser,
                lastSeenAt: payload.lastSeenAt,
              },
            };
          }
          return c;
        })
      );
    });

    return () => {
      unsubNewMessage();
      unsubMessageSent();
      unsubMessageEdited();
      unsubMessageDeleted();
      unsubMessagesRead();
      unsubUserPresence();
    };
  }, [activeConversationId, refreshConversations]);

  // 5. Total unread count derived directly from conversations
  const totalUnreadCount = useMemo(() => {
    return conversations.reduce((acc, conv) => acc + (conv.unreadCount || 0), 0);
  }, [conversations]);

  // 6. Helper: get single conversation by ID
  const getConversation = useCallback(
    (id: string): Conversation | undefined => {
      return conversations.find((c) => c.id === id);
    },
    [conversations]
  );

  // 7. Append older paginated conversations (FINDING-04)
  const appendOlderConversations = useCallback((older: Conversation[]) => {
    if (!sessionManager.isAuthenticated()) return;
    setConversations((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const newItems = older.filter((c) => !existingIds.has(c.id));
      if (newItems.length === 0) return prev;
      return [...prev, ...newItems];
    });
  }, []);

  // 8. Create conversation with session generation guard (FINDING-03)
  const createConversation = useCallback(
    async (recipientEmail: string): Promise<Conversation> => {
      const opGen = sessionManager.getGenerationId();
      const newConv = await chatApi.createConversation(recipientEmail);
      if (opGen !== sessionManager.getGenerationId()) {
        return newConv;
      }
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== newConv.id);
        return [newConv, ...filtered];
      });
      return newConv;
    },
    []
  );

  // 9. Update conversation preview
  const updateConversationPreview = useCallback(
    (conversationId: string, lastMessage: LastMessage, unreadDelta: number = 0) => {
      setConversations((prev) => {
        const index = prev.findIndex((c) => c.id === conversationId);
        if (index === -1) return prev;
        const existing = prev[index];
        const updated: Conversation = {
          ...existing,
          lastMessage,
          unreadCount: Math.max(0, (existing.unreadCount || 0) + unreadDelta),
          updatedAt: lastMessage.createdAt,
        };
        const rest = prev.filter((c) => c.id !== conversationId);
        return [updated, ...rest];
      });
    },
    []
  );

  // 10. Mark conversation read locally
  const markConversationAsReadLocally = useCallback((conversationId: string) => {
    setConversations((prev) => markConversationReadInList(prev, conversationId));
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      activeConversationId,
      totalUnreadCount,
      socketStatus,
      isLoadingConversations,
      conversationsError,
      refreshConversations,
      appendOlderConversations,
      setActiveConversationId,
      getConversation,
      createConversation,
      updateConversationPreview,
      markConversationAsReadLocally,
    }),
    [
      conversations,
      activeConversationId,
      totalUnreadCount,
      socketStatus,
      isLoadingConversations,
      conversationsError,
      refreshConversations,
      appendOlderConversations,
      getConversation,
      createConversation,
      updateConversationPreview,
      markConversationAsReadLocally,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
}

