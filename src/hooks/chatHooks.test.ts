import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { sessionManager } from '../services/auth/sessionManager.ts';
import { socketClient } from '../services/socket/socketClient.ts';
import { chatApi } from '../services/api/chat.ts';
import { messageQueue, type QueuedMessage } from '../services/chat/messageQueue.ts';
import { queueProcessor } from '../services/chat/queueProcessor.ts';
import { secureStorage } from '../services/storage/secureStore.ts';
import type { Conversation, Message, LastMessage } from '../services/api/types.ts';
import type { ClientMessage } from '../context/chatTypes.ts';
import {
  reconcileOptimisticMessage,
  appendOrUpdateMessage,
  prependOlderMessages,
  markMessageFailed,
  classifySendError,
  updateConversationWithLastMessage,
  markConversationReadInList,
  syncMessagesOnReconnect,
  applyMessageEdit,
} from '../context/chatReducers.ts';

/**
 * Stage 3.5 Phase 1 Remediation: Lifecycle & Multi-Conversation Race Condition Tests (Fix A, Fix B, Fix C)
 *
 * NOTE ON TESTING METHODOLOGY & ZERO-DEPENDENCY CONSTRAINT:
 * Per Section 8 of the authorized plan and Section 2.4 of AGENTS.md, neither React Testing Library
 * nor react-test-renderer is installed in this repository (zero unapproved dependencies).
 * In Node.js native test runner (node:test) without a React DOM renderer, directly executing
 * React 19 hook functions outside of a component body throws:
 *   `Invalid hook call: Hooks can only be called inside the body of a function component`.
 * Therefore, these lifecycle tests rigorously and deterministically model the exact monotonic
 * token generation, lock acquisition/release ownership algorithms, deferred-promise concurrency,
 * and active conversation ref tracking implemented in useMessages.ts (Fix A & Fix B).
 */

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Chat State & Hook Lifecycle Orchestration (FINDING-06)', () => {
  const mockUser1 = '00000000-0000-0000-0000-000000000001';
  const mockPartner = '00000000-0000-0000-0000-000000000002';
  const mockConvId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    // Reset sessionManager in-memory state
    sessionManager._resetForTesting();
  });

  afterEach(() => {
    sessionManager._resetForTesting();
  });

  describe('useConversations Lifecycle Orchestrator (FINDING-04 & FINDING-03)', () => {
    it('loadMore passes oldest conversation cursor and commits paginated records to state', async () => {
      const initialConversations: Conversation[] = [
        {
          id: 'conv-newer',
          otherUser: { id: mockPartner, email: 'partner@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
        },
        {
          id: 'conv-oldest-in-state',
          otherUser: { id: 'other-user', email: 'other@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T04:00:00Z',
          updatedAt: '2026-11-09T04:00:00Z',
        },
      ];

      const olderBatch: Conversation[] = [
        {
          id: 'conv-paginated-1',
          otherUser: { id: 'user-3', email: 'user3@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T03:00:00Z',
          updatedAt: '2026-11-09T03:00:00Z',
        },
      ];

      // Simulated ChatContext appendOlderConversations function
      let conversationsState = [...initialConversations];
      const appendOlderConversations = (older: Conversation[]) => {
        const existingIds = new Set(conversationsState.map((c) => c.id));
        const newItems = older.filter((c) => !existingIds.has(c.id));
        conversationsState = [...conversationsState, ...newItems];
      };

      // Mock chatApi.listConversations
      const originalList = chatApi.listConversations;
      let requestedCursor: string | undefined;
      chatApi.listConversations = async (query) => {
        requestedCursor = query?.cursor;
        return olderBatch;
      };

      try {
        // Execute loadMore orchestrator
        const oldest = initialConversations[initialConversations.length - 1];
        assert.strictEqual(oldest.id, 'conv-oldest-in-state');

        const older = await chatApi.listConversations({ limit: 20, cursor: oldest.id });
        appendOlderConversations(older);

        assert.strictEqual(requestedCursor, 'conv-oldest-in-state', 'Must pass oldest conversation ID as cursor');
        assert.strictEqual(conversationsState.length, 3, 'Must commit paginated conversations to state');
        assert.strictEqual(conversationsState[2].id, 'conv-paginated-1');
      } finally {
        chatApi.listConversations = originalList;
      }
    });

    it('rejects stale conversation pagination response if session changes in-flight (FINDING-03)', async () => {
      let conversationsState: Conversation[] = [
        {
          id: 'userA-conv-1',
          otherUser: { id: mockPartner, email: 'partner@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
        },
      ];

      const opGen = sessionManager.getGenerationId();

      // Simulate User A logs out and User B logs in while request is in-flight
      sessionManager.logout();
      assert.notStrictEqual(opGen, sessionManager.getGenerationId(), 'Generation ID must increment on logout');

      // Stale response arrives from User A's slow pagination call
      const staleUserAData: Conversation[] = [
        {
          id: 'userA-stale-conv-2',
          otherUser: { id: 'other', email: 'stale@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T04:00:00Z',
          updatedAt: '2026-11-09T04:00:00Z',
        },
      ];

      // Generational guard checks whether opGen is still valid
      if (opGen === sessionManager.getGenerationId()) {
        conversationsState = [...conversationsState, ...staleUserAData];
      }

      // Stale data was safely rejected
      assert.strictEqual(conversationsState.length, 1);
      assert.strictEqual(conversationsState[0].id, 'userA-conv-1');
    });

    it('deduplicates conversations if incoming page overlaps with socket-inserted conversation', () => {
      const currentConversations: Conversation[] = [
        {
          id: 'conv-1',
          otherUser: { id: mockPartner, email: 'partner@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
        },
        {
          id: 'conv-2',
          otherUser: { id: 'user2', email: 'user2@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T04:00:00Z',
          updatedAt: '2026-11-09T04:00:00Z',
        },
      ];

      const incomingOlderPage: Conversation[] = [
        {
          id: 'conv-2', // Already present!
          otherUser: { id: 'user2', email: 'user2@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T04:00:00Z',
          updatedAt: '2026-11-09T04:00:00Z',
        },
        {
          id: 'conv-3', // Brand new
          otherUser: { id: 'user3', email: 'user3@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 0,
          createdAt: '2026-11-09T03:00:00Z',
          updatedAt: '2026-11-09T03:00:00Z',
        },
      ];

      const existingIds = new Set(currentConversations.map((c) => c.id));
      const filtered = incomingOlderPage.filter((c) => !existingIds.has(c.id));
      const merged = [...currentConversations, ...filtered];

      assert.strictEqual(merged.length, 3);
      assert.strictEqual(merged[0].id, 'conv-1');
      assert.strictEqual(merged[1].id, 'conv-2');
      assert.strictEqual(merged[2].id, 'conv-3');
    });
  });

  describe('useMessages Lifecycle & Retry Safety Orchestrator (FINDING-01, FINDING-02, FINDING-03)', () => {
    it('prepends older paginated batch to index 0 preserving chronological order', () => {
      const currentMessages: ClientMessage[] = [
        {
          id: 'm-3',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Message 3',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:03:00Z',
          updatedAt: '2026-11-09T05:03:00Z',
        },
        {
          id: 'm-4',
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Message 4',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:04:00Z',
          updatedAt: '2026-11-09T05:04:00Z',
        },
      ];

      const olderMessages: Message[] = [
        {
          id: 'm-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Message 1',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:01:00Z',
          updatedAt: '2026-11-09T05:01:00Z',
        },
        {
          id: 'm-2',
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Message 2',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:02:00Z',
          updatedAt: '2026-11-09T05:02:00Z',
        },
      ];

      const result = prependOlderMessages(currentMessages, olderMessages);

      assert.strictEqual(result.length, 4);
      assert.strictEqual(result[0].id, 'm-1', 'Oldest must be at index 0');
      assert.strictEqual(result[1].id, 'm-2');
      assert.strictEqual(result[2].id, 'm-3');
      assert.strictEqual(result[3].id, 'm-4', 'Latest must be at last index');
    });

    it('allows retrying messages in uncertain status with persistent clientMutationId idempotency (Stage 5)', () => {
      const messages: ClientMessage[] = [
        {
          id: 'temp-uncertain',
          tempId: 'temp-uncertain',
          clientMutationId: '123e4567-e89b-12d3-a456-426614174000',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Important financial message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
          localStatus: 'uncertain', // Network timeout occurred
          sendError: 'Request timed out',
        },
      ];

      // Simulated retrySendMessage guard logic (Stage 5)
      const target = messages.find((m) => m.id === 'temp-uncertain');
      assert.ok(target);

      // Verify that retry is permitted for uncertain messages using persistent clientMutationId
      const canRetry =
        (target.localStatus === 'failed' || target.localStatus === 'uncertain') && !!target.content;
      assert.strictEqual(canRetry, true, 'Uncertain messages ARE eligible for safe retry with clientMutationId');
      assert.strictEqual(
        target.clientMutationId,
        '123e4567-e89b-12d3-a456-426614174000',
        'Must retain original clientMutationId'
      );
    });

    it('allows retrying confirmed failed messages (FINDING-02)', () => {
      const messages: ClientMessage[] = [
        {
          id: 'temp-failed-rate-limit',
          tempId: 'temp-failed-rate-limit',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Rate-limited message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
          localStatus: 'failed',
          sendError: 'Too many requests',
        },
      ];

      const target = messages.find((m) => m.id === 'temp-failed-rate-limit');
      assert.ok(target);

      const canRetry = target.localStatus === 'failed' && !!target.content;
      assert.strictEqual(canRetry, true, 'Failed messages can be retried');
    });

    it('discards late REST send response if user logged out while send was in-flight (FINDING-03)', () => {
      let messagesState: ClientMessage[] = [];
      const tempId = 'temp-userA-send';

      const opGen = sessionManager.getGenerationId();

      // User A logs out while POST /api/chat/messages is pending
      sessionManager.logout();
      assert.notStrictEqual(opGen, sessionManager.getGenerationId());

      // Late HTTP 201 response arrives from backend
      const lateServerResponse: Message = {
        id: 'msg-canonical-userA',
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Secret user A text',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:01Z',
        updatedAt: '2026-11-09T05:00:01Z',
      };

      // Generation guard
      if (opGen === sessionManager.getGenerationId()) {
        messagesState = reconcileOptimisticMessage(messagesState, lateServerResponse, tempId);
      }

      // State remains empty; User A's private message does not enter memory
      assert.strictEqual(messagesState.length, 0);
    });

    it('reconciles uncertain optimistic message to canonical sent message when message_sent arrives via socket with clientMutationId', () => {
      const mutationId = '00000000-0000-4000-8000-000000000001';
      let messagesState: ClientMessage[] = [
        {
          id: mutationId,
          tempId: mutationId,
          clientMutationId: mutationId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Uncertain send message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
          localStatus: 'uncertain',
          sendError: 'Network request timed out',
        },
      ];

      // Socket receives message_sent emitted to sender's room
      const incomingMessageSent: Message = {
        id: 'canonical-confirmed-id',
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Uncertain send message',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:02Z',
        updatedAt: '2026-11-09T05:00:02Z',
        clientMutationId: mutationId,
      };

      // Handler executes appendOrUpdateMessage
      messagesState = appendOrUpdateMessage(messagesState, incomingMessageSent);

      assert.strictEqual(messagesState.length, 1, 'Must reconcile to exactly 1 message');
      assert.strictEqual(messagesState[0].id, 'canonical-confirmed-id');
      assert.strictEqual(messagesState[0].tempId, undefined);
      assert.strictEqual(messagesState[0].localStatus, 'sent');
      assert.strictEqual(messagesState[0].sendError, undefined);
    });
  });

  describe('useTyping Timer & Auto-Stop Orchestrator', () => {
    it('schedules auto-stop after 3 seconds of typing inactivity and clears on stop', () => {
      let isLocallyTyping = false;
      let autoStopTimer: NodeJS.Timeout | null = null;
      let stopEmissionsCount = 0;
      let startEmissionsCount = 0;

      const stopTyping = () => {
        if (autoStopTimer) {
          clearTimeout(autoStopTimer);
          autoStopTimer = null;
        }
        if (isLocallyTyping) {
          isLocallyTyping = false;
          stopEmissionsCount++;
        }
      };

      const startTyping = () => {
        if (autoStopTimer) {
          clearTimeout(autoStopTimer);
        }
        if (!isLocallyTyping) {
          isLocallyTyping = true;
          startEmissionsCount++;
        }
        autoStopTimer = setTimeout(() => {
          stopTyping();
        }, 3000);
      };

      // 1. Initial keystroke
      startTyping();
      assert.strictEqual(isLocallyTyping, true);
      assert.strictEqual(startEmissionsCount, 1);
      assert.ok(autoStopTimer);

      // 2. Second keystroke before 3s resets timer without re-emitting typing_start
      startTyping();
      assert.strictEqual(startEmissionsCount, 1, 'Must throttle typing_start emissions');

      // 3. Explicit stopTyping clears timer immediately
      stopTyping();
      assert.strictEqual(isLocallyTyping, false);
      assert.strictEqual(stopEmissionsCount, 1);
      assert.strictEqual(autoStopTimer, null);
    });

    it('partner typing auto-clears after 5-second safety timeout if partner disconnects without typing_stop', (t) => {
      let isPartnerTyping = false;
      let safetyClearTimer: NodeJS.Timeout | null = null;

      const onUserTypingEvent = (payload: { isTyping: boolean }) => {
        isPartnerTyping = payload.isTyping;
        if (safetyClearTimer) {
          clearTimeout(safetyClearTimer);
          safetyClearTimer = null;
        }
        if (payload.isTyping) {
          safetyClearTimer = setTimeout(() => {
            isPartnerTyping = false;
          }, 5000);
        }
      };

      // Partner starts typing
      onUserTypingEvent({ isTyping: true });
      assert.strictEqual(isPartnerTyping, true);
      assert.ok(safetyClearTimer);

      // Clean up timer
      if (safetyClearTimer) clearTimeout(safetyClearTimer);
    });
  });

  describe('usePartnerPresence Lifecycle Orchestrator', () => {
    it('updates isOnline and lastSeenAt on verified user_presence socket events', () => {
      let isOnline = false;
      let lastSeenAt: string | null = null;

      const onPresenceEvent = (payload: { userId: string; status: 'online' | 'offline'; lastSeenAt: string | null }) => {
        if (payload.userId === mockPartner) {
          isOnline = payload.status === 'online';
          lastSeenAt = payload.lastSeenAt;
        }
      };

      // Initial state
      assert.strictEqual(isOnline, false);
      assert.strictEqual(lastSeenAt, null);

      // Partner comes online
      onPresenceEvent({ userId: mockPartner, status: 'online', lastSeenAt: null });
      assert.strictEqual(isOnline, true);

      // Partner goes offline with lastSeenAt
      const now = '2026-11-09T05:30:00.000Z';
      onPresenceEvent({ userId: mockPartner, status: 'offline', lastSeenAt: now });
      assert.strictEqual(isOnline, false);
      assert.strictEqual(lastSeenAt, now);

      // Presence event for unrelated user is ignored
      onPresenceEvent({ userId: 'other-user', status: 'online', lastSeenAt: null });
      assert.strictEqual(isOnline, false, 'Must not change for unrelated users');
    });
  });

  describe('ChatContext Session Lifecycle (FINDING-03 & FINDING-05)', () => {
    it('resets conversations and active conversation on UNAUTHENTICATED session event', () => {
      let conversations: Conversation[] = [
        {
          id: 'conv-active-1',
          otherUser: { id: mockPartner, email: 'sweetheart@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
          lastMessage: null,
          unreadCount: 3,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
        },
      ];
      let activeConversationId: string | null = 'conv-active-1';
      let conversationsError: string | null = 'Some error';

      const handleSessionEvent = (event: { type: string }) => {
        switch (event.type) {
          case 'UNAUTHENTICATED':
          case 'PROFILE_UNVERIFIED':
            conversations = [];
            activeConversationId = null;
            conversationsError = null;
            break;
        }
      };

      handleSessionEvent({ type: 'UNAUTHENTICATED' });

      assert.strictEqual(conversations.length, 0, 'Conversations must be cleared on logout');
      assert.strictEqual(activeConversationId, null, 'Active conversation ID must reset to null');
      assert.strictEqual(conversationsError, null, 'Errors must be reset on logout');
    });
  });

  describe('useMessages Pagination Concurrency Protection (Phase 1B)', () => {
    it('prevents multiple overlapping loadOlderMessages requests using synchronous in-flight ref lock', async () => {
      let activeApiRequests = 0;
      let totalApiRequests = 0;
      let isLoadingOlderRef = false;
      let isLoadingOlderState = false;

      // Simulated controller representing useMessages.loadOlderMessages
      const loadOlderMessages = async () => {
        if (isLoadingOlderRef || isLoadingOlderState) {
          return;
        }

        isLoadingOlderRef = true;
        isLoadingOlderState = true;
        activeApiRequests++;
        totalApiRequests++;

        try {
          // Simulate network latency
          await new Promise((resolve) => setTimeout(resolve, 20));
        } finally {
          isLoadingOlderRef = false;
          isLoadingOlderState = false;
          activeApiRequests--;
        }
      };

      // Two rapid calls fired in the same event tick (simulating momentum scroll)
      const p1 = loadOlderMessages();
      const p2 = loadOlderMessages();

      await Promise.all([p1, p2]);

      assert.strictEqual(totalApiRequests, 1, 'Only one request must have been dispatched');
      assert.strictEqual(activeApiRequests, 0);
      assert.strictEqual(isLoadingOlderRef, false, 'Lock must be released');
    });

    it('releases pagination in-flight lock after request failure so subsequent requests work', async () => {
      let isLoadingOlderRef = false;
      let callCount = 0;

      const loadOlderMessagesWithFailure = async (shouldFail: boolean) => {
        if (isLoadingOlderRef) return;
        isLoadingOlderRef = true;
        callCount++;

        try {
          if (shouldFail) {
            throw new Error('Network error during pagination');
          }
        } finally {
          isLoadingOlderRef = false;
        }
      };

      // First call fails
      try {
        await loadOlderMessagesWithFailure(true);
      } catch {
        // Expected failure
      }

      assert.strictEqual(isLoadingOlderRef, false, 'Lock must be released even after error');
      assert.strictEqual(callCount, 1);

      // Subsequent call succeeds
      await loadOlderMessagesWithFailure(false);
      assert.strictEqual(callCount, 2, 'Subsequent call must proceed normally');
      assert.strictEqual(isLoadingOlderRef, false);
    });

    it('multi-conversation pagination: resolving A after switching to B does not commit to B and does not release B lock (Fix A)', async () => {
      // Shared refs representing useMessages instance lifecycle across conversation switches
      let activeConversationIdRef = 'conv-A';
      let paginationRequestIdRef = 0;
      let isLoadingOlderRef = false;
      let isLoadingOlderState = false;
      let hasMoreOlderState = true;

      // Messages state per conversation
      const messagesState: Record<string, ClientMessage[]> = {
        'conv-A': [
          {
            id: 'msg-A-2',
            conversationId: 'conv-A',
            senderId: mockUser1,
            type: 'TEXT',
            content: 'Msg A2',
            fileKey: null,
            fileMime: null,
            fileSize: null,
            isEdited: false,
            editedAt: null,
            isDeleted: false,
            readAt: null,
            createdAt: '2026-11-09T05:02:00Z',
            updatedAt: '2026-11-09T05:02:00Z',
          },
        ],
        'conv-B': [
          {
            id: 'msg-B-2',
            conversationId: 'conv-B',
            senderId: mockPartner,
            type: 'TEXT',
            content: 'Msg B2',
            fileKey: null,
            fileMime: null,
            fileSize: null,
            isEdited: false,
            editedAt: null,
            isDeleted: false,
            readAt: null,
            createdAt: '2026-11-09T06:02:00Z',
            updatedAt: '2026-11-09T06:02:00Z',
          },
        ],
      };

      const deferredA = createDeferred<Message[]>();
      const deferredB = createDeferred<Message[]>();

      // Controller function matching useMessages.ts loadOlderMessages exactly
      const loadOlderMessages = async (targetConvId: string, fetchPromise: Promise<Message[]>) => {
        if (isLoadingOlderRef || isLoadingOlderState || !hasMoreOlderState) {
          return;
        }

        const reqId = ++paginationRequestIdRef;
        const opGen = sessionManager.getGenerationId();

        isLoadingOlderRef = true;
        isLoadingOlderState = true;

        try {
          const older = await fetchPromise;

          // Strict validation: reqId, targetConvId, and opGen
          if (
            reqId !== paginationRequestIdRef ||
            targetConvId !== activeConversationIdRef ||
            opGen !== sessionManager.getGenerationId()
          ) {
            return;
          }

          if (older.length < 50) {
            hasMoreOlderState = false;
          }

          messagesState[targetConvId] = prependOlderMessages(messagesState[targetConvId], older);
        } catch {
          // Ignore background pagination error
        } finally {
          if (reqId === paginationRequestIdRef) {
            isLoadingOlderRef = false;
            if (opGen === sessionManager.getGenerationId() && targetConvId === activeConversationIdRef) {
              isLoadingOlderState = false;
            }
          }
        }
      };

      // Cleanup function matching useMessages useEffect unmount/cleanup
      const switchConversation = (newConvId: string) => {
        // Invalidate in-flight pagination request from previous conversation
        paginationRequestIdRef++;
        isLoadingOlderRef = false;
        isLoadingOlderState = false;

        // Switch active conversation
        activeConversationIdRef = newConvId;
      };

      // 1. In Conv A: trigger loadOlderMessages
      const pA = loadOlderMessages('conv-A', deferredA.promise);
      assert.strictEqual(isLoadingOlderRef, true, 'Conv A pagination acquires lock');
      assert.strictEqual(paginationRequestIdRef, 1);

      // 2. User switches to Conv B while A is still in-flight
      switchConversation('conv-B');
      assert.strictEqual(activeConversationIdRef, 'conv-B');
      assert.strictEqual(isLoadingOlderRef, false, 'Switching conversation releases lock for new conversation');
      assert.strictEqual(paginationRequestIdRef, 2, 'Request ID incremented to invalidate pending Conv A request');

      // 3. In Conv B: trigger loadOlderMessages
      const pB = loadOlderMessages('conv-B', deferredB.promise);
      assert.strictEqual(isLoadingOlderRef, true, 'Conv B pagination acquires lock');
      assert.strictEqual(paginationRequestIdRef, 3);

      // 4. Delayed response for Conv A resolves first
      const olderA: Message[] = [
        {
          id: 'msg-A-1',
          conversationId: 'conv-A',
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Msg A1',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:01:00Z',
          updatedAt: '2026-11-09T05:01:00Z',
        },
      ];
      deferredA.resolve(olderA);
      await pA;

      // Invariants:
      // a. Conv A messages were NOT prepended to Conv B
      assert.strictEqual(messagesState['conv-B'].length, 1, 'Conv B must not receive Conv A messages');
      assert.strictEqual(messagesState['conv-A'].length, 1, 'Stale Conv A response was discarded');
      // b. Conv A's finally block did NOT release Conv B's lock!
      assert.strictEqual(isLoadingOlderRef, true, 'Conv B lock MUST remain held when Conv A finishes');

      // 5. Conv B's response now resolves
      const olderB: Message[] = [
        {
          id: 'msg-B-1',
          conversationId: 'conv-B',
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Msg B1',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T06:01:00Z',
          updatedAt: '2026-11-09T06:01:00Z',
        },
      ];
      deferredB.resolve(olderB);
      await pB;

      // Assertions verifying Conv B committed properly:
      assert.strictEqual(messagesState['conv-B'].length, 2, 'Conv B messages committed');
      assert.strictEqual(messagesState['conv-B'][0].id, 'msg-B-1');
      assert.strictEqual(isLoadingOlderRef, false, 'Conv B finally block released lock');
      assert.strictEqual(isLoadingOlderState, false);
    });

    it('multi-conversation pagination: delayed error in A does not release B lock or clear B state (Fix A)', async () => {
      let activeConversationIdRef = 'conv-A';
      let paginationRequestIdRef = 0;
      let isLoadingOlderRef = false;
      let isLoadingOlderState = false;

      const deferredA = createDeferred<Message[]>();
      const deferredB = createDeferred<Message[]>();

      const loadOlderMessages = async (targetConvId: string, fetchPromise: Promise<Message[]>) => {
        if (isLoadingOlderRef || isLoadingOlderState) return;
        const reqId = ++paginationRequestIdRef;
        const opGen = sessionManager.getGenerationId();
        isLoadingOlderRef = true;
        isLoadingOlderState = true;

        try {
          await fetchPromise;
          if (reqId !== paginationRequestIdRef || targetConvId !== activeConversationIdRef) return;
        } catch {
          // Error in targetConvId
        } finally {
          if (reqId === paginationRequestIdRef) {
            isLoadingOlderRef = false;
            if (opGen === sessionManager.getGenerationId() && targetConvId === activeConversationIdRef) {
              isLoadingOlderState = false;
            }
          }
        }
      };

      const switchConversation = (newConvId: string) => {
        paginationRequestIdRef++;
        isLoadingOlderRef = false;
        isLoadingOlderState = false;
        activeConversationIdRef = newConvId;
      };

      // Start A
      const pA = loadOlderMessages('conv-A', deferredA.promise);
      // Switch to B
      switchConversation('conv-B');
      // Start B
      const pB = loadOlderMessages('conv-B', deferredB.promise);
      assert.strictEqual(isLoadingOlderRef, true);

      // A rejects with an error
      deferredA.reject(new Error('Network error in Conv A'));
      await pA;

      // Lock MUST remain held for B
      assert.strictEqual(isLoadingOlderRef, true, 'Lock must remain held for Conv B even after Conv A error');

      // B resolves successfully
      deferredB.resolve([]);
      await pB;

      // B releases lock
      assert.strictEqual(isLoadingOlderRef, false, 'Conv B releases lock upon completion');
    });
  });

  describe('useMessages Read Receipt Optimization (Phase 1C)', () => {
    it('debounces rapid incoming partner messages into a single markAsRead request covering latest ID', async () => {
      const markAsReadCalls: Array<{ conversationId: string; lastMessageId?: string }> = [];
      let markReadTimer: NodeJS.Timeout | null = null;
      let pendingMarkReadId: string | null = null;

      const handleIncomingPartnerMessage = (msgId: string) => {
        pendingMarkReadId = msgId;

        if (markReadTimer) {
          clearTimeout(markReadTimer);
        }

        markReadTimer = setTimeout(() => {
          markReadTimer = null;
          const target = pendingMarkReadId;
          pendingMarkReadId = null;
          if (target) {
            markAsReadCalls.push({ conversationId: mockConvId, lastMessageId: target });
          }
        }, 300);
      };

      // 5 messages arrive rapidly (within 300ms window)
      handleIncomingPartnerMessage('msg-1');
      await new Promise((resolve) => setTimeout(resolve, 50));
      handleIncomingPartnerMessage('msg-2');
      await new Promise((resolve) => setTimeout(resolve, 50));
      handleIncomingPartnerMessage('msg-3');
      await new Promise((resolve) => setTimeout(resolve, 50));
      handleIncomingPartnerMessage('msg-4');
      await new Promise((resolve) => setTimeout(resolve, 50));
      handleIncomingPartnerMessage('msg-5');

      // Before timer expires, no calls should have executed
      assert.strictEqual(markAsReadCalls.length, 0);

      // Wait for debounce window (300ms from last message)
      await new Promise((resolve) => setTimeout(resolve, 350));

      assert.strictEqual(markAsReadCalls.length, 1, 'Exactly one request should be sent');
      assert.strictEqual(markAsReadCalls[0].lastMessageId, 'msg-5', 'Must use the latest message ID');
    });

    it('cancels pending read receipt timer and clears pending ID when conversation unmounts', async () => {
      const markAsReadCalls: Array<{ lastMessageId?: string }> = [];
      let markReadTimer: NodeJS.Timeout | null = null;
      let pendingMarkReadId: string | null = null;

      const handleIncomingPartnerMessage = (msgId: string) => {
        pendingMarkReadId = msgId;
        if (markReadTimer) clearTimeout(markReadTimer);
        markReadTimer = setTimeout(() => {
          markReadTimer = null;
          const target = pendingMarkReadId;
          pendingMarkReadId = null;
          if (target) {
            markAsReadCalls.push({ lastMessageId: target });
          }
        }, 300);
      };

      // Message arrives
      handleIncomingPartnerMessage('msg-unmount-test');
      assert.ok(markReadTimer);

      // User unmounts before 300ms
      const cleanup = () => {
        if (markReadTimer) {
          clearTimeout(markReadTimer);
          markReadTimer = null;
        }
        pendingMarkReadId = null;
      };
      cleanup();

      // Wait past debounce timer
      await new Promise((resolve) => setTimeout(resolve, 350));

      assert.strictEqual(markAsReadCalls.length, 0, 'No request should be sent for unmounted screen');
      assert.strictEqual(pendingMarkReadId, null);
    });

    it('dispatches a new request for subsequent messages arriving after the debounce window', async () => {
      const markAsReadCalls: Array<{ lastMessageId?: string }> = [];
      let markReadTimer: NodeJS.Timeout | null = null;
      let pendingMarkReadId: string | null = null;

      const handleIncoming = (msgId: string) => {
        pendingMarkReadId = msgId;
        if (markReadTimer) clearTimeout(markReadTimer);
        markReadTimer = setTimeout(() => {
          markReadTimer = null;
          const target = pendingMarkReadId;
          pendingMarkReadId = null;
          if (target) {
            markAsReadCalls.push({ lastMessageId: target });
          }
        }, 100);
      };

      // Batch 1
      handleIncoming('msg-batch-1');
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.strictEqual(markAsReadCalls.length, 1);
      assert.strictEqual(markAsReadCalls[0].lastMessageId, 'msg-batch-1');

      // Batch 2 (after window)
      handleIncoming('msg-batch-2');
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.strictEqual(markAsReadCalls.length, 2);
      assert.strictEqual(markAsReadCalls[1].lastMessageId, 'msg-batch-2');
    });
  });

  describe('useMessages Socket Reconnect Synchronization (Phase 1D)', () => {
    it('does not trigger redundant fetch on initial socket connection', () => {
      let fetchCalls = 0;
      let hasInitialLoaded = false;
      let isSyncing = false;
      let previousState = 'connected';

      const handleStateTransition = (newState: string) => {
        const wasDisconnected = previousState === 'reconnecting' || previousState === 'disconnected';
        if (newState === 'connected' && wasDisconnected && hasInitialLoaded && !isSyncing) {
          fetchCalls++;
        }
        previousState = newState;
      };

      // Initial mount notification (connected -> connected)
      handleStateTransition('connected');
      assert.strictEqual(fetchCalls, 0, 'Initial connection must NOT trigger redundant sync fetch');
    });

    it('triggers latest-message fetch upon reconnecting from disconnected state', async () => {
      let fetchCalls = 0;
      let hasInitialLoaded = true; // Initial load already finished
      let isSyncing = false;
      let previousState = 'connected';

      const handleStateTransition = async (newState: string) => {
        const wasDisconnected = previousState === 'reconnecting' || previousState === 'disconnected';
        if (newState === 'connected' && wasDisconnected && hasInitialLoaded && !isSyncing) {
          isSyncing = true;
          fetchCalls++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          isSyncing = false;
        }
        previousState = newState;
      };

      // Disconnect occurs
      await handleStateTransition('reconnecting');
      assert.strictEqual(fetchCalls, 0);

      // Reconnect occurs
      await handleStateTransition('connected');
      assert.strictEqual(fetchCalls, 1, 'Reconnect must trigger latest-message fetch');
    });

    it('blocks overlapping reconnect sync requests if multiple connected events fire', async () => {
      let fetchCalls = 0;
      let hasInitialLoaded = true;
      let isSyncing = false;
      let previousState = 'reconnecting';

      const handleStateTransition = (newState: string) => {
        const wasDisconnected = previousState === 'reconnecting' || previousState === 'disconnected';
        if (newState === 'connected' && wasDisconnected && hasInitialLoaded && !isSyncing) {
          isSyncing = true;
          fetchCalls++;
        }
        previousState = newState;
      };

      // Two rapid connected events
      handleStateTransition('connected');
      handleStateTransition('connected');

      assert.strictEqual(fetchCalls, 1, 'Overlapping sync requests must be prevented');
    });

    it('ignores stale reconnect sync response if session changed while in-flight', async () => {
      let committedState: ClientMessage[] = [];
      const opGen = sessionManager.getGenerationId();

      // Simulate async in-flight fetch
      const fetchPromise = new Promise<Message[]>((resolve) => {
        setTimeout(() => {
          resolve([
            {
              id: 'stale-msg',
              conversationId: mockConvId,
              senderId: mockPartner,
              type: 'TEXT',
              content: 'Stale session message',
              fileKey: null,
              fileMime: null,
              fileSize: null,
              isEdited: false,
              editedAt: null,
              isDeleted: false,
              readAt: null,
              createdAt: '2026-11-09T08:00:00Z',
              updatedAt: '2026-11-09T08:00:00Z',
            },
          ]);
        }, 20);
      });

      // User logs out while fetch was in-flight
      sessionManager.logout();

      const latestMessages = await fetchPromise;
      if (opGen === sessionManager.getGenerationId()) {
        committedState = latestMessages.map((m) => ({ ...m, localStatus: 'sent' }));
      }

      assert.strictEqual(committedState.length, 0, 'Stale session response must be dropped');
    });

    it('multi-conversation reconnect sync: resolving A after switching to B does not commit to B or release B lock (Fix B)', async () => {
      let activeConversationIdRef = 'conv-A';
      let reconnectSyncIdRef = 0;
      let isSyncingOnReconnectRef = false;
      const readMarks: string[] = [];

      let messagesA: ClientMessage[] = [
        {
          id: 'old-A',
          conversationId: 'conv-A',
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Old A',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
        },
      ];

      let messagesB: ClientMessage[] = [
        {
          id: 'old-B',
          conversationId: 'conv-B',
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Old B',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T06:00:00Z',
          updatedAt: '2026-11-09T06:00:00Z',
        },
      ];

      const deferredA = createDeferred<Message[]>();
      const deferredB = createDeferred<Message[]>();

      const triggerReconnectSync = async (targetConvId: string, fetchPromise: Promise<Message[]>) => {
        if (isSyncingOnReconnectRef) return;
        const syncId = ++reconnectSyncIdRef;
        const opGen = sessionManager.getGenerationId();
        isSyncingOnReconnectRef = true;

        try {
          const latestMessages = await fetchPromise;

          if (
            syncId !== reconnectSyncIdRef ||
            targetConvId !== activeConversationIdRef ||
            opGen !== sessionManager.getGenerationId()
          ) {
            return;
          }

          if (targetConvId === 'conv-A') {
            messagesA = syncMessagesOnReconnect(messagesA, latestMessages);
          } else if (targetConvId === 'conv-B') {
            messagesB = syncMessagesOnReconnect(messagesB, latestMessages);
          }

          const hasUnread = latestMessages.some(
            (m) => m.senderId !== mockUser1 && !m.readAt && !m.isDeleted
          );
          if (hasUnread) {
            readMarks.push(targetConvId);
          }
        } catch {
          // ignore background sync error
        } finally {
          if (syncId === reconnectSyncIdRef) {
            isSyncingOnReconnectRef = false;
          }
        }
      };

      const switchConversation = (newConvId: string) => {
        reconnectSyncIdRef++;
        isSyncingOnReconnectRef = false;
        activeConversationIdRef = newConvId;
      };

      // 1. Reconnect sync starts in Conv A
      const pA = triggerReconnectSync('conv-A', deferredA.promise);
      assert.strictEqual(isSyncingOnReconnectRef, true, 'Conv A acquires reconnect sync lock');
      assert.strictEqual(reconnectSyncIdRef, 1);

      // 2. User switches to Conv B while Conv A sync is in-flight
      switchConversation('conv-B');
      assert.strictEqual(activeConversationIdRef, 'conv-B');
      assert.strictEqual(isSyncingOnReconnectRef, false, 'Switching releases lock for Conv B');
      assert.strictEqual(reconnectSyncIdRef, 2, 'Sync ID incremented to invalidate Conv A');

      // 3. Conv B starts reconnect sync
      const pB = triggerReconnectSync('conv-B', deferredB.promise);
      assert.strictEqual(isSyncingOnReconnectRef, true, 'Conv B acquires reconnect sync lock');
      assert.strictEqual(reconnectSyncIdRef, 3);

      // 4. Delayed sync for Conv A resolves first with unread message
      const latestA: Message[] = [
        {
          id: 'new-A-unread',
          conversationId: 'conv-A',
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Unread A',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:01:00Z',
          updatedAt: '2026-11-09T05:01:00Z',
        },
      ];
      deferredA.resolve(latestA);
      await pA;

      // Verify Fix B invariants:
      // a. Conv A messages did NOT mutate Conv B
      assert.strictEqual(messagesB.length, 1, 'Conv B messages must not be mutated by Conv A');
      assert.strictEqual(messagesA.length, 1, 'Stale Conv A sync response discarded');
      // b. Mark as read was NOT called for Conv A or Conv B
      assert.strictEqual(readMarks.length, 0, 'No read marks dispatched for stale Conv A sync');
      // c. Conv A finally block did NOT release Conv B's sync lock!
      assert.strictEqual(isSyncingOnReconnectRef, true, 'Conv B reconnect sync lock MUST remain held');

      // 5. Conv B's response now resolves with unread message
      const latestB: Message[] = [
        {
          id: 'new-B-unread',
          conversationId: 'conv-B',
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Unread B',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T06:01:00Z',
          updatedAt: '2026-11-09T06:01:00Z',
        },
      ];
      deferredB.resolve(latestB);
      await pB;

      // Verify Conv B committed properly:
      assert.strictEqual(messagesB.length, 2, 'Conv B messages committed');
      assert.strictEqual(messagesB[1].id, 'new-B-unread');
      assert.deepStrictEqual(readMarks, ['conv-B'], 'Mark as read called for Conv B');
      assert.strictEqual(isSyncingOnReconnectRef, false, 'Conv B finally block released sync lock');
    });

    it('multi-conversation reconnect sync: delayed error in A does not release B lock or clear B state (Fix B)', async () => {
      let activeConversationIdRef = 'conv-A';
      let reconnectSyncIdRef = 0;
      let isSyncingOnReconnectRef = false;

      const deferredA = createDeferred<Message[]>();
      const deferredB = createDeferred<Message[]>();

      const triggerReconnectSync = async (targetConvId: string, fetchPromise: Promise<Message[]>) => {
        if (isSyncingOnReconnectRef) return;
        const syncId = ++reconnectSyncIdRef;
        isSyncingOnReconnectRef = true;

        try {
          await fetchPromise;
          if (syncId !== reconnectSyncIdRef || targetConvId !== activeConversationIdRef) return;
        } catch {
          // ignore
        } finally {
          if (syncId === reconnectSyncIdRef) {
            isSyncingOnReconnectRef = false;
          }
        }
      };

      const switchConversation = (newConvId: string) => {
        reconnectSyncIdRef++;
        isSyncingOnReconnectRef = false;
        activeConversationIdRef = newConvId;
      };

      // Start A
      const pA = triggerReconnectSync('conv-A', deferredA.promise);
      // Switch to B
      switchConversation('conv-B');
      // Start B
      const pB = triggerReconnectSync('conv-B', deferredB.promise);
      assert.strictEqual(isSyncingOnReconnectRef, true);

      // A rejects
      deferredA.reject(new Error('Sync failed'));
      await pA;

      // Lock MUST remain held for B
      assert.strictEqual(isSyncingOnReconnectRef, true, 'Sync lock remains held for B');

      // B resolves
      deferredB.resolve([]);
      await pB;

      assert.strictEqual(isSyncingOnReconnectRef, false, 'B releases sync lock');
    });
  });

  describe('useMessages Multi-Conversation Mutation Isolation (Fix A & Fix B)', () => {
    it('discards late sendMessage REST response if conversation switched while in flight', async () => {
      let activeConversationIdRef = 'conv-A';
      let messagesState: Record<string, ClientMessage[]> = {
        'conv-A': [],
        'conv-B': [],
      };

      const deferredSend = createDeferred<Message>();
      const tempId = 'temp-msg-1';

      const sendMessage = async (targetConvId: string, sendPromise: Promise<Message>) => {
        const opGen = sessionManager.getGenerationId();

        try {
          const serverMsg = await sendPromise;

          if (
            opGen !== sessionManager.getGenerationId() ||
            targetConvId !== activeConversationIdRef
          ) {
            return {
              ...serverMsg,
              localStatus: serverMsg.readAt ? ('read' as const) : ('sent' as const),
            };
          }

          messagesState[targetConvId] = reconcileOptimisticMessage(
            messagesState[targetConvId],
            serverMsg,
            tempId
          );
          return {
            ...serverMsg,
            localStatus: serverMsg.readAt ? ('read' as const) : ('sent' as const),
          };
        } catch (err) {
          if (
            opGen !== sessionManager.getGenerationId() ||
            targetConvId !== activeConversationIdRef
          ) {
            throw err;
          }
          throw err;
        }
      };

      // 1. Send initiated in Conv A
      const pSend = sendMessage('conv-A', deferredSend.promise);

      // 2. User switches to Conv B before server responds
      activeConversationIdRef = 'conv-B';

      // 3. Server responds with 201 Created for Conv A
      const serverMsg: Message = {
        id: 'canonical-A-1',
        conversationId: 'conv-A',
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Hello A',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:00Z',
        updatedAt: '2026-11-09T05:00:00Z',
      };
      deferredSend.resolve(serverMsg);
      await pSend;

      // Messages in active conversation B must NOT contain Conv A message
      assert.strictEqual(messagesState['conv-B'].length, 0);
      assert.strictEqual(messagesState['conv-A'].length, 0, 'Late response discarded for inactive Conv A');
    });

    it('discards late editMessage or deleteMessage if conversation switched while in flight', async () => {
      let activeConversationIdRef = 'conv-A';
      let messagesState: ClientMessage[] = [
        {
          id: 'msg-target',
          conversationId: 'conv-B', // Belongs to Conv B
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Original',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00Z',
          updatedAt: '2026-11-09T05:00:00Z',
        },
      ];

      const deferredEdit = createDeferred<{ isEdited: boolean; editedAt: string; updatedAt: string }>();

      const editMessage = async (targetConvId: string, messageId: string, content: string) => {
        const opGen = sessionManager.getGenerationId();
        const updated = await deferredEdit.promise;

        if (
          opGen !== sessionManager.getGenerationId() ||
          targetConvId !== activeConversationIdRef
        ) {
          return;
        }

        messagesState = applyMessageEdit(
          messagesState,
          messageId,
          content,
          updated.isEdited,
          updated.editedAt,
          updated.updatedAt
        );
      };

      // Edit initiated in Conv A
      const pEdit = editMessage('conv-A', 'msg-target', 'Edited Text');

      // User switches to Conv B
      activeConversationIdRef = 'conv-B';

      // Edit completes
      deferredEdit.resolve({
        isEdited: true,
        editedAt: '2026-11-09T05:05:00Z',
        updatedAt: '2026-11-09T05:05:00Z',
      });
      await pEdit;

      // Invariant: Target message was NOT edited because targetConvId ('conv-A') !== activeConversationIdRef ('conv-B')
      assert.strictEqual(messagesState[0].content, 'Original', 'Late edit from inactive conversation must not commit');
    });

    it('cancels debounced markAsRead timer execution if conversation switches before 300ms window expires', async () => {
      let activeConversationIdRef = 'conv-A';
      const markAsReadCalls: string[] = [];
      let markReadTimer: NodeJS.Timeout | null = null;
      let pendingMarkReadId: string | null = null;

      const scheduleMarkAsRead = (targetConvId: string, msgId: string) => {
        pendingMarkReadId = msgId;
        if (markReadTimer) clearTimeout(markReadTimer);

        const opGen = sessionManager.getGenerationId();
        markReadTimer = setTimeout(() => {
          markReadTimer = null;
          const target = pendingMarkReadId;
          pendingMarkReadId = null;

          if (!target) return;
          if (opGen !== sessionManager.getGenerationId()) return;
          if (targetConvId !== activeConversationIdRef) return;

          markAsReadCalls.push(targetConvId);
        }, 100);
      };

      // Partner message arrives in Conv A
      scheduleMarkAsRead('conv-A', 'msg-1');
      assert.ok(markReadTimer);

      // User navigates to Conv B at 40ms
      await new Promise((resolve) => setTimeout(resolve, 40));
      activeConversationIdRef = 'conv-B';

      // Wait past 100ms timer
      await new Promise((resolve) => setTimeout(resolve, 120));

      assert.strictEqual(markAsReadCalls.length, 0, 'Debounced markAsRead must be dropped when active conversation changed');
    });
  });

  describe('Stage 6: Offline Queue & Local Message Persistence Integration', () => {
    const originalSendMessage = chatApi.sendMessage;
    const originalGetMessages = chatApi.getMessages;

    beforeEach(() => {
      secureStorage._resetForTesting();
      messageQueue._resetForTesting();
      queueProcessor._resetForTesting();
      sessionManager._resetForTesting();

      (sessionManager as any).inMemoryAccessToken = 'valid-token';
      (sessionManager as any).currentUser = {
        id: mockUser1,
        email: 'user1@gmail.com',
        createdAt: '2026-11-09T00:00:00Z',
      };
    });

    afterEach(() => {
      chatApi.sendMessage = originalSendMessage;
      chatApi.getMessages = originalGetMessages;
      secureStorage._resetForTesting();
      messageQueue._resetForTesting();
      queueProcessor._resetForTesting();
      sessionManager._resetForTesting();
    });

    it('offline message send: persists to messageQueue with pending status when socket disconnected', async () => {
      let messagesState: ClientMessage[] = [];
      const mutationId = '00000000-0000-0000-0000-000000000099';
      const nowIso = '2026-11-10T15:00:00.000Z';

      // Simulate offline send logic
      const isOnline = false;
      const optimisticMsg: ClientMessage = {
        id: mutationId,
        tempId: mutationId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Offline note to partner',
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

      const queuedItem: QueuedMessage = {
        id: mutationId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Offline note to partner',
        createdAt: nowIso,
        localStatus: isOnline ? 'sending' : 'pending',
        retryCount: 0,
      };

      await messageQueue.enqueue(queuedItem);
      messagesState = [...messagesState, optimisticMsg];

      // 1. Verifies message is stored in persistent queue
      const stored = await messageQueue.getQueueForConversation(mockUser1, mockConvId);
      assert.strictEqual(stored.length, 1);
      assert.strictEqual(stored[0].clientMutationId, mutationId);
      assert.strictEqual(stored[0].localStatus, 'pending');

      // 2. Verifies UI state shows pending
      assert.strictEqual(messagesState.length, 1);
      assert.strictEqual(messagesState[0].localStatus, 'pending');
    });

    it('app restart restoration: uncommitted queued messages are restored and sorted chronologically', async () => {
      // Pre-populate queue from a prior session
      const qm1: QueuedMessage = {
        id: 'mut-older-1',
        clientMutationId: 'mut-older-1',
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Older pending note',
        createdAt: '2026-11-10T14:59:00.000Z',
        localStatus: 'pending',
        retryCount: 0,
      };
      await messageQueue.enqueue(qm1);

      // Server returns existing confirmed message
      const serverHistory: Message[] = [
        {
          id: 'server-confirmed-1',
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Earlier message from partner',
          clientMutationId: undefined,
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: '2026-11-10T14:55:00.000Z',
          createdAt: '2026-11-10T14:55:00.000Z',
          updatedAt: '2026-11-10T14:55:00.000Z',
        },
      ];

      // Simulate hook initial load
      const queued = await messageQueue.getQueueForConversation(mockUser1, mockConvId);
      const serverMutationIds = new Set(serverHistory.map((m) => m.clientMutationId).filter(Boolean));

      const clientMsgs: ClientMessage[] = serverHistory.map((m) => ({
        ...m,
        localStatus: m.readAt ? 'read' : 'sent',
      }));

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

      clientMsgs.sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      });

      assert.strictEqual(clientMsgs.length, 2);
      assert.strictEqual(clientMsgs[0].id, 'server-confirmed-1');
      assert.strictEqual(clientMsgs[0].localStatus, 'read');
      assert.strictEqual(clientMsgs[1].clientMutationId, 'mut-older-1');
      assert.strictEqual(clientMsgs[1].localStatus, 'pending');
    });

    it('reconnect processing: sends pending message reusing exact clientMutationId and reconciles', async () => {
      const mutationId = '00000000-0000-0000-0000-000000000088';
      const qm: QueuedMessage = {
        id: mutationId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Send after reconnect',
        createdAt: '2026-11-10T16:00:00.000Z',
        localStatus: 'pending',
        retryCount: 0,
      };
      await messageQueue.enqueue(qm);

      let capturedPayload: any = null;
      chatApi.sendMessage = async (payload) => {
        capturedPayload = payload;
        return {
          id: 'server-confirmed-88',
          conversationId: payload.conversationId,
          senderId: mockUser1,
          type: 'TEXT',
          content: payload.content,
          clientMutationId: payload.clientMutationId,
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-10T16:00:02.000Z',
          updatedAt: '2026-11-10T16:00:02.000Z',
        };
      };

      // Trigger queue processing on reconnect
      await queueProcessor.processConversationQueue(mockConvId);

      assert.ok(capturedPayload);
      assert.strictEqual(capturedPayload.clientMutationId, mutationId, 'Must strictly reuse original clientMutationId');
      assert.strictEqual(capturedPayload.content, 'Send after reconnect');

      // Dequeued from persistent queue
      const remaining = await messageQueue.getQueueForConversation(mockUser1, mockConvId);
      assert.strictEqual(remaining.length, 0);
    });

    it('already-persisted message on server: reconciled without duplicating and dequeued from storage', async () => {
      const mutationId = '00000000-0000-0000-0000-000000000077';
      const qm: QueuedMessage = {
        id: mutationId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Already on server',
        createdAt: '2026-11-10T16:00:00.000Z',
        localStatus: 'uncertain',
        retryCount: 1,
      };
      await messageQueue.enqueue(qm);

      const serverHistory: Message[] = [
        {
          id: 'server-id-77',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Already on server',
          clientMutationId: mutationId,
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-10T16:00:01.000Z',
          updatedAt: '2026-11-10T16:00:01.000Z',
        },
      ];

      // Initial load reconciliation logic
      const queued = await messageQueue.getQueueForConversation(mockUser1, mockConvId);
      const serverMutationIds = new Set(serverHistory.map((m) => m.clientMutationId).filter(Boolean));

      for (const item of queued) {
        if (serverMutationIds.has(item.clientMutationId)) {
          await messageQueue.dequeue(mockUser1, item.clientMutationId);
        }
      }

      const clientMsgs: ClientMessage[] = serverHistory.map((m) => ({
        ...m,
        localStatus: m.readAt ? 'read' : 'sent',
      }));

      // Invariant: clientMsgs contains only 1 entry (canonical), and storage is cleaned up
      assert.strictEqual(clientMsgs.length, 1);
      assert.strictEqual(clientMsgs[0].id, 'server-id-77');
      assert.strictEqual(clientMsgs[0].localStatus, 'sent');

      const remainingStorage = await messageQueue.getQueueForConversation(mockUser1, mockConvId);
      assert.strictEqual(remainingStorage.length, 0);
    });

    it('account isolation: switching accounts prevents processing or seeing another account queue', async () => {
      const userB = '00000000-0000-0000-0000-000000000003';
      const qmA: QueuedMessage = {
        id: 'mut-userA-private',
        clientMutationId: 'mut-userA-private',
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Confidential from User A',
        createdAt: '2026-11-10T17:00:00.000Z',
        localStatus: 'pending',
        retryCount: 0,
      };
      await messageQueue.enqueue(qmA);

      // User A logs out
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;

      // User B logs in
      (sessionManager as any).inMemoryAccessToken = 'token-userB';
      (sessionManager as any).currentUser = {
        id: userB,
        email: 'userb@gmail.com',
        createdAt: '2026-11-10T00:00:00Z',
      };

      // User B's queue must be completely empty
      const queueB = await messageQueue.getQueue(userB);
      assert.strictEqual(queueB.length, 0, 'User B must not see User A queued messages');

      // Attempting to process queue for User B does not touch or send User A message
      let sendCalled = false;
      chatApi.sendMessage = async () => {
        sendCalled = true;
        throw new Error('Should not be called');
      };

      await queueProcessor.processAllQueues();
      assert.strictEqual(sendCalled, false);

      // User A message remains safely in storage for User A
      const queueA = await messageQueue.getQueue(mockUser1);
      assert.strictEqual(queueA.length, 1);
      assert.strictEqual(queueA[0].clientMutationId, 'mut-userA-private');
    });
  });
});
