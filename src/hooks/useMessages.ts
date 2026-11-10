import { useState, useEffect, useCallback, useRef } from 'react';
import { chatApi } from '../services/api/chat.ts';
import type { Message, LastMessage } from '../services/api/types.ts';
import { socketClient, type SocketConnectionState } from '../services/socket/socketClient.ts';
import { sessionManager } from '../services/auth/sessionManager.ts';
import { messageQueue, type QueuedMessage } from '../services/chat/messageQueue.ts';
import { queueProcessor } from '../services/chat/queueProcessor.ts';
import { useChatContext } from '../context/ChatContext.tsx';
import type { ClientMessage } from '../context/chatTypes.ts';
import { generateUUID, isCanonicalUuid } from '../utils/uuid.ts';
import {
  reconcileOptimisticMessage,
  appendOrUpdateMessage,
  prependOlderMessages,
  markMessageFailed,
  applyMessageEdit,
  applyMessageDelete,
  applyMessagesRead,
  classifySendError,
  syncMessagesOnReconnect,
} from '../context/chatReducers.ts';

export interface UseMessagesResult {
  messages: ClientMessage[];
  isLoading: boolean;
  isLoadingOlder: boolean;
  hasMoreOlder: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<ClientMessage>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  markAsRead: (lastMessageId?: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  retrySendMessage: (tempId: string) => Promise<void>;
}

/**
 * Hook for managing the message stream of an active conversation.
 *
 * STORAGE & ORDERING STRATEGY:
 * Messages are strictly stored and returned in ASCENDING CHRONOLOGICAL ORDER:
 * - index 0 is the oldest message in memory (used as cursor for loading older messages).
 * - index messages.length - 1 is the latest message in memory.
 * Consumers requiring inverted rendering (e.g. inverted FlatList) can pass [...messages].reverse().
 */
export function useMessages(conversationId: string): UseMessagesResult {
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active conversation tracker across hook renders
  const activeConversationIdRef = useRef<string>(conversationId);
  activeConversationIdRef.current = conversationId;

  // Synchronous pagination lock guard and monotonic request ownership token (Fix A)
  const isLoadingOlderRef = useRef<boolean>(false);
  const paginationRequestIdRef = useRef<number>(0);

  // Read receipt 300ms trailing debounce refs (Phase 1C)
  const markReadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingMarkReadIdRef = useRef<string | null>(null);

  // Socket reconnect synchronization lock guard and operation ownership token (Fix B)
  const isSyncingOnReconnectRef = useRef<boolean>(false);
  const reconnectSyncIdRef = useRef<number>(0);
  const hasInitialLoadedRef = useRef<boolean>(false);
  const previousSocketStateRef = useRef<SocketConnectionState>(socketClient.getState());

  const {
    setActiveConversationId,
    updateConversationPreview,
    markConversationAsReadLocally,
  } = useChatContext();

  const currentUserId = sessionManager.getUser()?.id || '';

  // 1. Initial messages fetch & active room join with session generation guard (FINDING-03)
  useEffect(() => {
    let isCancelled = false;
    const opGen = sessionManager.getGenerationId();

    setActiveConversationId(conversationId);
    socketClient.joinConversation(conversationId).catch(() => {});

    setIsLoading(true);
    setError(null);
    hasInitialLoadedRef.current = false;

    chatApi
      .getMessages(conversationId, { limit: 50 })
      .then(async (data) => {
        if (isCancelled || opGen !== sessionManager.getGenerationId()) return;

        // Reconcile and load uncommitted local queued messages for this conversation
        const queued = await messageQueue
          .getQueueForConversation(currentUserId, conversationId)
          .catch(() => []);

        if (isCancelled || opGen !== sessionManager.getGenerationId()) return;

        const serverMutationIds = new Set(
          data.map((m) => m.clientMutationId).filter(Boolean) as string[]
        );

        // Dequeue any messages that are already committed on the server
        for (const qm of queued) {
          if (serverMutationIds.has(qm.clientMutationId)) {
            messageQueue.dequeue(currentUserId, qm.clientMutationId).catch(() => {});
          }
        }

        const clientMsgs: ClientMessage[] = data.map((m) => ({
          ...m,
          localStatus: m.readAt ? 'read' : 'sent',
        }));

        // Append uncommitted queued messages (those not yet in server history)
        const uncommitted = queued.filter((qm) => !serverMutationIds.has(qm.clientMutationId));
        for (const qm of uncommitted) {
          clientMsgs.push({
            id: qm.clientMutationId,
            tempId: qm.clientMutationId,
            clientMutationId: qm.clientMutationId,
            conversationId: qm.conversationId,
            senderId: qm.senderId,
            type: 'TEXT',
            content: qm.content,
            fileKey: null,
            fileMime: null,
            fileSize: null,
            isEdited: false,
            editedAt: null,
            isDeleted: false,
            readAt: null,
            createdAt: qm.createdAt,
            updatedAt: qm.createdAt,
            localStatus: qm.localStatus,
            sendError: qm.lastError,
          });
        }

        // Sort chronologically [createdAt ASC, id ASC]
        clientMsgs.sort((a, b) => {
          const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        });

        setMessages(clientMsgs);
        if (data.length < 50) {
          setHasMoreOlder(false);
        }
        hasInitialLoadedRef.current = true;

        // Trigger queue processing for eligible messages if socket is connected
        if (socketClient.isConnected()) {
          queueProcessor.processConversationQueue(conversationId).catch(() => {});
        }

        // Mark incoming messages as read upon viewing
        const hasUnreadFromPartner = clientMsgs.some(
          (m) => m.senderId !== currentUserId && !m.readAt && !m.isDeleted
        );
        if (hasUnreadFromPartner) {
          chatApi.markAsRead(conversationId).catch(() => {});
          markConversationAsReadLocally(conversationId);
        }
      })
      .catch(async (err) => {
        if (isCancelled || opGen !== sessionManager.getGenerationId()) return;

        // Offline / server error fallback: restore queued messages from local storage
        try {
          const queued = await messageQueue.getQueueForConversation(currentUserId, conversationId);
          if (isCancelled || opGen !== sessionManager.getGenerationId()) return;
          if (queued.length > 0) {
            const fallbackMsgs: ClientMessage[] = queued.map((qm) => ({
              id: qm.clientMutationId,
              tempId: qm.clientMutationId,
              clientMutationId: qm.clientMutationId,
              conversationId: qm.conversationId,
              senderId: qm.senderId,
              type: 'TEXT',
              content: qm.content,
              fileKey: null,
              fileMime: null,
              fileSize: null,
              isEdited: false,
              editedAt: null,
              isDeleted: false,
              readAt: null,
              createdAt: qm.createdAt,
              updatedAt: qm.createdAt,
              localStatus: qm.localStatus,
              sendError: qm.lastError,
            }));
            setMessages(fallbackMsgs);
          }
        } catch {
          // Ignore fallback storage error
        }

        setError(err?.message || 'Failed to load messages');
      })
      .finally(() => {
        if (!isCancelled && opGen === sessionManager.getGenerationId()) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      // Invalidate any in-flight pagination request from this conversation
      paginationRequestIdRef.current++;
      isLoadingOlderRef.current = false;

      // Invalidate any in-flight reconnect sync from this conversation
      reconnectSyncIdRef.current++;
      isSyncingOnReconnectRef.current = false;

      hasInitialLoadedRef.current = false;
      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = null;
      }
      pendingMarkReadIdRef.current = null;
      socketClient.leaveConversation(conversationId).catch(() => {});
      setActiveConversationId(null);
    };
  }, [conversationId, currentUserId, setActiveConversationId, markConversationAsReadLocally]);

  // 2. Real-time Socket.IO subscriptions for active conversation
  useEffect(() => {
    const unsubNewMessage = socketClient.on('new_message', (payload) => {
      if (payload.conversationId === conversationId) {
        setMessages((prev) => appendOrUpdateMessage(prev, payload));

        // Automatically mark as read if message is from partner using 300ms trailing debounce (Phase 1C)
        if (payload.senderId !== currentUserId) {
          markConversationAsReadLocally(conversationId);

          pendingMarkReadIdRef.current = payload.id;

          if (markReadTimerRef.current) {
            clearTimeout(markReadTimerRef.current);
          }

          const opGen = sessionManager.getGenerationId();
          const targetConvId = conversationId;
          markReadTimerRef.current = setTimeout(() => {
            markReadTimerRef.current = null;
            const targetMessageId = pendingMarkReadIdRef.current;
            pendingMarkReadIdRef.current = null;

            if (!targetMessageId) return;
            if (
              opGen !== sessionManager.getGenerationId() ||
              targetConvId !== activeConversationIdRef.current
            ) {
              return;
            }

            chatApi
              .markAsRead(targetConvId, { lastMessageId: targetMessageId })
              .catch(() => {});
          }, 300);
        }
      }
    });

    const unsubMessageSent = socketClient.on('message_sent', (payload) => {
      if (payload.conversationId === conversationId) {
        setMessages((prev) => appendOrUpdateMessage(prev, payload));
      }
    });

    const unsubMessageEdited = socketClient.on('message_edited', (payload) => {
      if (payload.conversationId === conversationId) {
        setMessages((prev) =>
          applyMessageEdit(
            prev,
            payload.id,
            payload.content || '',
            payload.isEdited,
            payload.editedAt,
            payload.updatedAt
          )
        );
      }
    });

    const unsubMessageDeleted = socketClient.on('message_deleted', (payload) => {
      if (payload.conversationId === conversationId) {
        setMessages((prev) => applyMessageDelete(prev, payload.id, payload.updatedAt));
      }
    });

    const unsubMessagesRead = socketClient.on('messages_read', (payload) => {
      if (payload.conversationId === conversationId) {
        setMessages((prev) =>
          applyMessagesRead(prev, currentUserId, payload.readAt, payload.lastReadMessageId)
        );
      }
    });

    return () => {
      unsubNewMessage();
      unsubMessageSent();
      unsubMessageEdited();
      unsubMessageDeleted();
      unsubMessagesRead();
      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = null;
      }
      pendingMarkReadIdRef.current = null;
    };
  }, [conversationId, currentUserId, markConversationAsReadLocally]);

  // 3. Socket reconnect synchronization listener (Fix B)
  useEffect(() => {
    let isCancelled = false;
    previousSocketStateRef.current = socketClient.getState();

    const unsubscribe = socketClient.subscribeState((newState) => {
      const prevState = previousSocketStateRef.current;
      previousSocketStateRef.current = newState;

      const wasDisconnected =
        prevState === 'reconnecting' ||
        prevState === 'disconnected' ||
        prevState === 'authentication_failure';
      if (
        newState === 'connected' &&
        wasDisconnected &&
        hasInitialLoadedRef.current &&
        !isSyncingOnReconnectRef.current &&
        !isCancelled
      ) {
        // Acquire reconnect sync ownership synchronously
        const syncId = ++reconnectSyncIdRef.current;
        const targetConvId = conversationId;
        const opGen = sessionManager.getGenerationId();

        isSyncingOnReconnectRef.current = true;

        chatApi
          .getMessages(targetConvId, { limit: 50 })
          .then((latestMessages) => {
            // Strict sync ownership and conversation active validation
            if (
              isCancelled ||
              syncId !== reconnectSyncIdRef.current ||
              targetConvId !== activeConversationIdRef.current ||
              opGen !== sessionManager.getGenerationId()
            ) {
              return;
            }

            setMessages((prev) => syncMessagesOnReconnect(prev, latestMessages));

            // Re-evaluate unread status on newly recovered partner messages
            const hasUnreadFromPartner = latestMessages.some(
              (m) => m.senderId !== currentUserId && !m.readAt && !m.isDeleted
            );
            if (hasUnreadFromPartner) {
              chatApi.markAsRead(targetConvId).catch(() => {});
              markConversationAsReadLocally(targetConvId);
            }

            // Process any pending queued messages on reconnect
            queueProcessor.processConversationQueue(targetConvId).catch(() => {});
          })
          .catch(() => {
            // Ignore background reconnect sync error
          })
          .finally(() => {
            // Release lock ONLY if this operation still owns the reconnect sync ID
            if (syncId === reconnectSyncIdRef.current) {
              isSyncingOnReconnectRef.current = false;
            }
          });
      }
    });

    return () => {
      isCancelled = true;
      // Invalidate any in-flight reconnect sync from this conversation
      reconnectSyncIdRef.current++;
      isSyncingOnReconnectRef.current = false;
      unsubscribe();
    };
  }, [conversationId, currentUserId, markConversationAsReadLocally]);

  // 4. QueueProcessor event subscription for background sending and reconciliation
  useEffect(() => {
    const unsubQueue = queueProcessor.subscribe((event) => {
      if (event.conversationId !== conversationId) return;

      if (event.type === 'MESSAGE_SENT' || event.type === 'MESSAGE_RECONCILED') {
        if (event.serverMessage) {
          setMessages((prev) =>
            reconcileOptimisticMessage(prev, event.serverMessage!, event.clientMutationId)
          );
          updateConversationPreview(conversationId, {
            id: event.serverMessage.id,
            senderId: event.serverMessage.senderId,
            type: event.serverMessage.type,
            content: event.serverMessage.content,
            isEdited: event.serverMessage.isEdited,
            editedAt: event.serverMessage.editedAt,
            isDeleted: event.serverMessage.isDeleted,
            readAt: event.serverMessage.readAt || null,
            createdAt: event.serverMessage.createdAt,
          });
        }
      } else if (event.type === 'MESSAGE_FAILED') {
        setMessages((prev) =>
          markMessageFailed(
            prev,
            event.clientMutationId,
            event.error || 'Failed to send message',
            event.status || 'failed'
          )
        );
      } else if (event.type === 'MESSAGE_STATUS_CHANGED') {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientMutationId === event.clientMutationId || m.tempId === event.clientMutationId
              ? { ...m, localStatus: event.status }
              : m
          )
        );
      }
    });

    return () => {
      unsubQueue();
    };
  }, [conversationId, updateConversationPreview]);

  // 4. Load older messages (pagination) with synchronous request ownership guard (Fix A)
  const loadOlderMessages = useCallback(async (): Promise<void> => {
    if (isLoadingOlderRef.current || isLoadingOlder || !hasMoreOlder || messages.length === 0) {
      return;
    }

    const oldest = messages.find((m) => !m.tempId);
    if (!oldest) return;

    // Acquire request ownership synchronously
    const reqId = ++paginationRequestIdRef.current;
    const targetConvId = conversationId;
    const opGen = sessionManager.getGenerationId();

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);

    try {
      const older = await chatApi.getMessages(targetConvId, {
        limit: 50,
        cursor: oldest.id,
      });

      // Strict request ownership and conversation active validation
      if (
        reqId !== paginationRequestIdRef.current ||
        targetConvId !== activeConversationIdRef.current ||
        opGen !== sessionManager.getGenerationId()
      ) {
        return;
      }

      if (older.length < 50) {
        setHasMoreOlder(false);
      }

      setMessages((prev) => prependOlderMessages(prev, older));
    } catch {
      // Ignore background pagination error
    } finally {
      // Release lock ONLY if this request still owns the pagination request ID
      if (reqId === paginationRequestIdRef.current) {
        isLoadingOlderRef.current = false;
        if (opGen === sessionManager.getGenerationId() && targetConvId === activeConversationIdRef.current) {
          setIsLoadingOlder(false);
        }
      }
    }
  }, [isLoadingOlder, hasMoreOlder, messages, conversationId]);

  // 5. Send message with offline persistence, optimistic insertion, error classification, and generation guards (FINDING-02 & FINDING-03)
  const sendMessage = useCallback(
    async (content: string): Promise<ClientMessage> => {
      const trimmed = content.trim();
      if (!trimmed) {
        throw new Error('Message content cannot be empty');
      }

      const clientMutationId = generateUUID();
      const tempId = clientMutationId;
      const nowIso = new Date().toISOString();
      const opGen = sessionManager.getGenerationId();
      const targetConvId = conversationId;
      const isOnline = socketClient.isConnected();

      const optimisticMsg: ClientMessage = {
        id: tempId,
        tempId,
        clientMutationId,
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: trimmed,
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        localStatus: isOnline ? 'sending' : 'pending',
      };

      // 1. Persist to offline queue before network delivery
      const queuedItem: QueuedMessage = {
        id: tempId,
        clientMutationId,
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: trimmed,
        createdAt: nowIso,
        localStatus: isOnline ? 'sending' : 'pending',
        retryCount: 0,
      };
      await messageQueue.enqueue(queuedItem).catch((err) => {
        console.warn('[useMessages] Queue persistence error:', err);
      });

      // 2. Optimistically append to message list
      setMessages((prev) => [...prev, optimisticMsg]);

      // 3. Update conversation preview in shared context
      const preview: LastMessage = {
        id: tempId,
        senderId: currentUserId,
        type: 'TEXT',
        content: trimmed,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: nowIso,
      };
      updateConversationPreview(conversationId, preview);

      // If offline, return optimistic message immediately without blocking UI
      if (!isOnline) {
        return optimisticMsg;
      }

      try {
        const serverMsg = await queueProcessor.processMessage(queuedItem);
        if (!serverMsg) {
          return optimisticMsg;
        }

        // Stale session or conversation guard: Ignore if session or active conversation changed while in flight
        if (
          opGen !== sessionManager.getGenerationId() ||
          targetConvId !== activeConversationIdRef.current
        ) {
          return {
            ...serverMsg,
            localStatus: serverMsg.readAt ? 'read' : 'sent',
          };
        }

        // Reconcile optimistic message with canonical server response
        setMessages((prev) => reconcileOptimisticMessage(prev, serverMsg, tempId));

        // Update preview with canonical server message
        updateConversationPreview(conversationId, {
          id: serverMsg.id,
          senderId: serverMsg.senderId,
          type: serverMsg.type,
          content: serverMsg.content,
          isEdited: serverMsg.isEdited,
          editedAt: serverMsg.editedAt,
          isDeleted: serverMsg.isDeleted,
          readAt: serverMsg.readAt || null,
          createdAt: serverMsg.createdAt,
        });

        return {
          ...serverMsg,
          localStatus: serverMsg.readAt ? 'read' : 'sent',
        };
      } catch (err: any) {
        if (
          opGen !== sessionManager.getGenerationId() ||
          targetConvId !== activeConversationIdRef.current
        ) {
          throw err;
        }

        // Conservative error classification (FINDING-02):
        // Ambiguous transport failures (timeout, 5xx) -> 'uncertain'
        // Definite client rejections (429, 4xx) -> 'failed'
        const classified = classifySendError(err);
        setMessages((prev) =>
          markMessageFailed(prev, tempId, classified.errorMessage, classified.status)
        );
        throw err;
      }
    },
    [conversationId, currentUserId, updateConversationPreview]
  );

  // 6. Retry sending a failed, uncertain, or pending message with idempotency
  // Strictly preserves the original clientMutationId.
  const retrySendMessage = useCallback(
    async (tempId: string): Promise<void> => {
      const target = messages.find((m) => m.tempId === tempId || m.id === tempId);
      if (
        !target ||
        (target.localStatus !== 'failed' &&
          target.localStatus !== 'uncertain' &&
          target.localStatus !== 'pending') ||
        !target.content
      ) {
        return;
      }

      const opGen = sessionManager.getGenerationId();
      const targetConvId = conversationId;

      // Set to sending state
      setMessages((prev) =>
        prev.map((m) =>
          m.tempId === tempId || m.id === tempId
            ? { ...m, localStatus: 'sending', sendError: undefined }
            : m
        )
      );

      const clientMutationId =
        target.clientMutationId || (isCanonicalUuid(tempId) ? tempId : generateUUID());

      const queuedItem: QueuedMessage = {
        id: tempId,
        clientMutationId,
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: target.content,
        createdAt: target.createdAt,
        localStatus: 'sending',
        retryCount: 0,
      };

      await messageQueue.updateStatus(currentUserId, clientMutationId, 'sending').catch(() => {});

      try {
        const serverMsg = await queueProcessor.processMessage(queuedItem);
        if (!serverMsg) return;

        if (
          opGen !== sessionManager.getGenerationId() ||
          targetConvId !== activeConversationIdRef.current
        ) {
          return;
        }

        setMessages((prev) => reconcileOptimisticMessage(prev, serverMsg, tempId));
      } catch (err: any) {
        if (
          opGen !== sessionManager.getGenerationId() ||
          targetConvId !== activeConversationIdRef.current
        ) {
          return;
        }

        const classified = classifySendError(err);
        setMessages((prev) =>
          markMessageFailed(prev, tempId, classified.errorMessage, classified.status)
        );
      }
    },
    [messages, conversationId, currentUserId]
  );

  // 6. Edit message with session generation guard (FINDING-03)
  const editMessage = useCallback(
    async (messageId: string, content: string): Promise<void> => {
      const opGen = sessionManager.getGenerationId();
      const targetConvId = conversationId;
      const trimmed = content.trim();
      const updated = await chatApi.editMessage(messageId, trimmed);

      if (
        opGen !== sessionManager.getGenerationId() ||
        targetConvId !== activeConversationIdRef.current
      ) {
        return;
      }

      setMessages((prev) =>
        applyMessageEdit(
          prev,
          messageId,
          trimmed,
          updated.isEdited,
          updated.editedAt,
          updated.updatedAt
        )
      );
    },
    [conversationId]
  );

  // 7. Soft-delete message with session generation guard (FINDING-03)
  const deleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      const opGen = sessionManager.getGenerationId();
      const targetConvId = conversationId;
      const deleted = await chatApi.deleteMessage(messageId);

      if (
        opGen !== sessionManager.getGenerationId() ||
        targetConvId !== activeConversationIdRef.current
      ) {
        return;
      }

      setMessages((prev) => applyMessageDelete(prev, messageId, deleted.updatedAt));
    },
    [conversationId]
  );

  // 8. Explicit mark messages as read with session generation guard (FINDING-03)
  const markAsRead = useCallback(
    async (lastMessageId?: string): Promise<void> => {
      const opGen = sessionManager.getGenerationId();
      const targetConvId = conversationId;
      await chatApi.markAsRead(conversationId, { lastMessageId });

      if (
        opGen !== sessionManager.getGenerationId() ||
        targetConvId !== activeConversationIdRef.current
      ) {
        return;
      }

      markConversationAsReadLocally(conversationId);
    },
    [conversationId, markConversationAsReadLocally]
  );

  return {
    messages,
    isLoading,
    isLoadingOlder,
    hasMoreOlder,
    error,
    sendMessage,
    editMessage,
    deleteMessage,
    markAsRead,
    loadOlderMessages,
    retrySendMessage,
  };
}

