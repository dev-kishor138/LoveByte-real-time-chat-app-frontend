import type { Conversation, LastMessage, Message } from '../services/api/types.ts';
import type { ClientMessage, MessageDeliveryStatus } from './chatTypes.ts';

/**
 * Pure state reducer helpers for chat messages and conversations.
 * Enables 100% deterministic unit testing and guarantees consistent ordering.
 *
 * STORAGE STRATEGY: Ascending Chronological Order
 * Messages are always stored and returned in ascending chronological order:
 * - index 0 is the oldest message in memory (cursor boundary for loading older history).
 * - index messages.length - 1 is the latest message in memory.
 */

/**
 * Classifies send failures into definite rejections vs ambiguous/uncertain outcomes.
 * - Confirmed 429: Server rejected without creating message; retryable after backoff.
 * - Confirmed 4xx: Server rejected without creating message; not retryable with same payload.
 * - Indeterminate (status 0, timeout, ECONNABORTED, 5xx): Uncertain whether DB committed; NEVER auto-retry.
 */
export function classifySendError(err: unknown): {
  status: 'failed' | 'uncertain';
  errorMessage: string;
  isRetryable: boolean;
} {
  const statusCode = (err as any)?.statusCode ?? (err as any)?.response?.status;
  const rawMessage = (err as any)?.message;
  const errorMessage =
    typeof rawMessage === 'string' && rawMessage.trim()
      ? rawMessage
      : 'Failed to send message';

  // Indeterminate transport failures: Network offline, timeout, ECONNABORTED, or server 5xx
  // The server might have persisted the message before the client lost connection or gateway timed out.
  // With persistent server-side idempotency (Stage 5), it is safe to manually retry with the SAME clientMutationId.
  if (statusCode === 0 || statusCode === undefined || statusCode === null || statusCode >= 500) {
    return {
      status: 'uncertain',
      errorMessage,
      isRetryable: true,
    };
  }

  // 429 Rate Limited: Definite server rejection without message creation.
  // Safe to retry once backoff window expires.
  if (statusCode === 429) {
    return {
      status: 'failed',
      errorMessage,
      isRetryable: true,
    };
  }

  // Other 4xx client errors (400, 401, 403, 404, 409): Definite server rejection, not retryable.
  return {
    status: 'failed',
    errorMessage,
    isRetryable: false,
  };
}

/**
 * Reconciles an in-flight optimistic message with the server's canonical response.
 * Handles race conditions where:
 * 1. A Socket.IO broadcast might arrive before REST returns.
 * 2. A newer socket edit or soft-delete arrives before a delayed REST response (FINDING-07).
 *    A stale REST response must NEVER restore deleted content or overwrite newer edited text.
 * 3. The optimistic message was previously marked 'failed' or 'uncertain'.
 */
export function reconcileOptimisticMessage(
  messages: ClientMessage[],
  serverMessage: Message,
  tempId?: string
): ClientMessage[] {
  const existingByIdIndex = messages.findIndex((m) => m.id === serverMessage.id);
  const effectiveTempId = tempId || serverMessage.clientMutationId;
  const existingByTempIdIndex = effectiveTempId
    ? messages.findIndex(
        (m) =>
          m.tempId === effectiveTempId ||
          m.id === effectiveTempId ||
          (m.clientMutationId && m.clientMutationId === effectiveTempId)
      )
    : -1;

  // Inspect existing canonical message if already present via earlier socket event
  const existingCanonical = existingByIdIndex !== -1 ? messages[existingByIdIndex] : undefined;

  // Preserve newer edit/delete states (FINDING-07)
  const isDeleted = existingCanonical?.isDeleted || serverMessage.isDeleted;
  const isEdited = existingCanonical?.isEdited || serverMessage.isEdited;
  const isExistingNewer = existingCanonical
    ? new Date(existingCanonical.updatedAt).getTime() > new Date(serverMessage.updatedAt).getTime()
    : false;

  const content = isDeleted
    ? null
    : isExistingNewer && existingCanonical?.isEdited
    ? existingCanonical.content
    : serverMessage.content;

  const editedAt = isExistingNewer && existingCanonical?.editedAt
    ? existingCanonical.editedAt
    : serverMessage.editedAt;

  const updatedAt = isExistingNewer && existingCanonical?.updatedAt
    ? existingCanonical.updatedAt
    : serverMessage.updatedAt;

  const resolvedMessage: ClientMessage = {
    ...serverMessage,
    content,
    isEdited,
    editedAt,
    isDeleted,
    updatedAt,
    fileKey: isDeleted ? null : serverMessage.fileKey,
    fileMime: isDeleted ? null : serverMessage.fileMime,
    fileSize: isDeleted ? null : serverMessage.fileSize,
    localStatus: existingCanonical?.localStatus === 'read' || serverMessage.readAt ? 'read' : 'sent',
    tempId: undefined,
    sendError: undefined,
  };

  // Case 1: Server ID already exists in state (from earlier socket broadcast).
  // Update canonical record with merged state and remove the duplicate optimistic entry.
  if (existingByIdIndex !== -1) {
    return messages
      .filter((m) => !effectiveTempId || (m.tempId !== effectiveTempId && m.id !== effectiveTempId))
      .map((m) => (m.id === serverMessage.id ? resolvedMessage : m));
  }

  // Case 2: Matching tempId exists in state (standard optimistic reconciliation).
  if (existingByTempIdIndex !== -1) {
    const next = [...messages];
    next[existingByTempIdIndex] = resolvedMessage;
    return next;
  }

  // Case 3: Neither exists in state, append in chronological order
  return [...messages, resolvedMessage];
}

/**
 * Appends a new message or updates an existing message by ID or clientMutationId.
 * Deduplicates strictly by stable backend message ID or clientMutationId against optimistic tempId.
 * Preserves newer edit and soft-delete states.
 */
export function appendOrUpdateMessage(
  messages: ClientMessage[],
  incomingMessage: Message | ClientMessage
): ClientMessage[] {
  const incomingMutationId = incomingMessage.clientMutationId;
  const existingIndex = messages.findIndex(
    (m) =>
      m.id === incomingMessage.id ||
      (incomingMutationId !== undefined &&
        (m.tempId === incomingMutationId || m.clientMutationId === incomingMutationId))
  );

  if (existingIndex !== -1) {
    const existing = messages[existingIndex];
    const isDeleted = existing.isDeleted || incomingMessage.isDeleted;
    const isEdited = existing.isEdited || incomingMessage.isEdited;
    const isExistingNewer =
      new Date(existing.updatedAt).getTime() > new Date(incomingMessage.updatedAt).getTime();

    const next = [...messages];
    next[existingIndex] = {
      ...existing,
      ...incomingMessage,
      id: incomingMessage.id,
      tempId: undefined, // Clear optimistic tempId on reconciliation
      sendError: undefined,
      content: isDeleted
        ? null
        : isExistingNewer && existing.isEdited
        ? existing.content
        : incomingMessage.content,
      isEdited,
      editedAt: isExistingNewer && existing.editedAt ? existing.editedAt : incomingMessage.editedAt,
      isDeleted,
      fileKey: isDeleted ? null : incomingMessage.fileKey,
      fileMime: isDeleted ? null : incomingMessage.fileMime,
      fileSize: isDeleted ? null : incomingMessage.fileSize,
      updatedAt: isExistingNewer ? existing.updatedAt : incomingMessage.updatedAt,
      localStatus: existing.localStatus === 'read' || incomingMessage.readAt ? 'read' : 'sent',
    };
    return next;
  }

  return [...messages, incomingMessage];
}

/**
 * Prepends older messages to the top (index 0) of the list while filtering duplicates.
 */
export function prependOlderMessages(
  currentMessages: ClientMessage[],
  olderMessages: Message[]
): ClientMessage[] {
  const existingIds = new Set(currentMessages.map((m) => m.id));
  const newOlder = olderMessages.filter((m) => !existingIds.has(m.id));

  return [...newOlder, ...currentMessages];
}

/**
 * Marks an optimistic message with delivery status (failed, uncertain, pending, etc.).
 */
export function markMessageFailed(
  messages: ClientMessage[],
  tempId: string,
  error: string,
  status: MessageDeliveryStatus = 'failed'
): ClientMessage[] {
  return messages.map((m) => {
    if (m.id === tempId || m.tempId === tempId) {
      return {
        ...m,
        localStatus: status,
        sendError: error,
      };
    }
    return m;
  });
}

/**
 * Applies an edit mutation to a message in state.
 */
export function applyMessageEdit(
  messages: ClientMessage[],
  messageId: string,
  content: string,
  isEdited: boolean,
  editedAt: string | null,
  updatedAt: string
): ClientMessage[] {
  return messages.map((m) => {
    if (m.id === messageId) {
      return {
        ...m,
        content,
        isEdited,
        editedAt,
        updatedAt,
      };
    }
    return m;
  });
}

/**
 * Applies a soft-delete tombstone mutation to a message in state.
 * Masks content to null and sets isDeleted to true.
 */
export function applyMessageDelete(
  messages: ClientMessage[],
  messageId: string,
  updatedAt: string
): ClientMessage[] {
  return messages.map((m) => {
    if (m.id === messageId) {
      return {
        ...m,
        content: null,
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isDeleted: true,
        updatedAt,
      };
    }
    return m;
  });
}

/**
 * Marks messages sent by current user as read when the partner reads them.
 */
export function applyMessagesRead(
  messages: ClientMessage[],
  currentUserId: string,
  readAt: string,
  lastReadMessageId?: string | null
): ClientMessage[] {
  let boundaryFound = false;

  return messages.map((m) => {
    // Only update unread messages sent by current user
    if (m.senderId === currentUserId && !m.readAt) {
      if (lastReadMessageId) {
        if (!boundaryFound) {
          if (m.id === lastReadMessageId) {
            boundaryFound = true;
          }
          return {
            ...m,
            readAt,
            localStatus: 'read',
          };
        }
      } else {
        return {
          ...m,
          readAt,
          localStatus: 'read',
        };
      }
    }
    return m;
  });
}

/**
 * Updates a conversation list when a new message arrives or is sent.
 * Moves the conversation to the top and increments unread count if inactive.
 */
export function updateConversationWithLastMessage(
  conversations: Conversation[],
  conversationId: string,
  lastMessage: LastMessage,
  isCurrentActive: boolean,
  currentUserId?: string | null
): Conversation[] {
  const index = conversations.findIndex((c) => c.id === conversationId);

  if (index === -1) {
    return conversations;
  }

  const existing = conversations[index];
  const isFromPartner = currentUserId ? lastMessage.senderId !== currentUserId : true;
  const unreadDelta = !isCurrentActive && isFromPartner && !lastMessage.readAt ? 1 : 0;

  const updated: Conversation = {
    ...existing,
    lastMessage,
    unreadCount: Math.max(0, (existing.unreadCount || 0) + unreadDelta),
    updatedAt: lastMessage.createdAt,
  };

  const remaining = conversations.filter((c) => c.id !== conversationId);
  return [updated, ...remaining];
}

/**
 * Clears unread count for a conversation.
 */
export function markConversationReadInList(
  conversations: Conversation[],
  conversationId: string
): Conversation[] {
  return conversations.map((c) => {
    if (c.id === conversationId) {
      return {
        ...c,
        unreadCount: 0,
      };
    }
    return c;
  });
}

/**
 * Synchronizes existing message state with a fresh batch of latest messages fetched on socket reconnect.
 * - Deduplicates by canonical message ID.
 * - Updates existing messages with latest server fields (readAt, isEdited, isDeleted, content).
 * - Preserves in-flight optimistic messages (tempId) and reconciles if server returned matching clientMutationId.
 * - Preserves older paginated history preceding the latest batch.
 * - Maintains strict ascending chronological ordering.
 */
export function syncMessagesOnReconnect(
  currentMessages: ClientMessage[],
  latestMessages: Message[]
): ClientMessage[] {
  const latestById = new Map<string, Message>();
  for (const m of latestMessages) {
    latestById.set(m.id, m);
  }

  const result: ClientMessage[] = [];
  const processedServerIds = new Set<string>();

  // 1. Process current messages in state
  for (const current of currentMessages) {
    // If it's a pending or uncertain optimistic message, check if reconciled by clientMutationId or tempId
    if (
      current.tempId ||
      (current.localStatus &&
        current.localStatus !== 'sent' &&
        current.localStatus !== 'read')
    ) {
      const matchId = current.clientMutationId || current.tempId;
      const serverMatch = matchId
        ? latestMessages.find(
            (m) =>
              (m.clientMutationId && m.clientMutationId === matchId) ||
              (current.tempId && m.clientMutationId === current.tempId)
          )
        : undefined;

      if (serverMatch) {
        result.push({
          ...serverMatch,
          localStatus: serverMatch.readAt ? 'read' : 'sent',
        });
        processedServerIds.add(serverMatch.id);
      } else {
        result.push(current);
      }
      continue;
    }

    const serverMsg = latestById.get(current.id);
    if (serverMsg) {
      const isDeleted = current.isDeleted || serverMsg.isDeleted;
      const isExistingNewer =
        new Date(current.updatedAt).getTime() > new Date(serverMsg.updatedAt).getTime();

      result.push({
        ...current,
        ...serverMsg,
        content: isDeleted
          ? null
          : isExistingNewer && current.isEdited
          ? current.content
          : serverMsg.content,
        isDeleted,
        readAt: serverMsg.readAt || current.readAt,
        localStatus: serverMsg.readAt ? 'read' : (current.localStatus || 'sent'),
      });
      processedServerIds.add(serverMsg.id);
    } else {
      // Older paginated message outside the latest batch
      result.push(current);
    }
  }

  // 2. Add newly arrived messages from server that weren't in current state
  for (const serverMsg of latestMessages) {
    if (!processedServerIds.has(serverMsg.id)) {
      result.push({
        ...serverMsg,
        localStatus: serverMsg.readAt ? 'read' : 'sent',
      });
    }
  }

  // 3. Guarantee strict ascending chronological order [createdAt ASC, id ASC]
  return result.sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}


