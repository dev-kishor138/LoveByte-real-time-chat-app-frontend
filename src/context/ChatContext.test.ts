import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Message, Conversation, LastMessage } from '../services/api/types.ts';
import type { ClientMessage } from './chatTypes.ts';
import {
  reconcileOptimisticMessage,
  appendOrUpdateMessage,
  prependOlderMessages,
  markMessageFailed,
  applyMessageEdit,
  applyMessageDelete,
  applyMessagesRead,
  updateConversationWithLastMessage,
  markConversationReadInList,
  classifySendError,
  syncMessagesOnReconnect,
} from './chatReducers.ts';

describe('Chat State Management & Synchronization (Stage 3.3)', () => {
  const mockUser1 = 'user-uuid-1';
  const mockPartner = 'partner-uuid-2';
  const mockConvId = 'conv-uuid-1';

  describe('reconcileOptimisticMessage', () => {
    it('replaces matching pending tempId message with canonical server message', () => {
      const tempId = 'temp-12345';
      const initialMessages: ClientMessage[] = [
        {
          id: 'msg-existing-1',
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Hey there',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sent',
        },
        {
          id: tempId,
          tempId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Hello sweetheart',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:01:00.000Z',
          updatedAt: '2026-11-09T05:01:00.000Z',
          localStatus: 'sending',
        },
      ];

      const serverMessage: Message = {
        id: 'msg-canonical-server-id',
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Hello sweetheart',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:01:02.000Z',
        updatedAt: '2026-11-09T05:01:02.000Z',
      };

      const result = reconcileOptimisticMessage(initialMessages, serverMessage, tempId);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[1].id, 'msg-canonical-server-id');
      assert.strictEqual(result[1].tempId, undefined);
      assert.strictEqual(result[1].localStatus, 'sent');
      assert.strictEqual(result[0].id, 'msg-existing-1');
    });

    it('handles race condition where socket event arrives before REST response without duplicating', () => {
      const tempId = 'temp-race-1';
      const canonicalId = 'msg-canonical-1';

      // Socket event arrived first and added canonical message
      const initialMessages: ClientMessage[] = [
        {
          id: tempId,
          tempId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Race message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
        {
          id: canonicalId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Race message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:01.000Z',
          updatedAt: '2026-11-09T05:00:01.000Z',
          localStatus: 'sent',
        },
      ];

      const serverResponse: Message = {
        id: canonicalId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Race message',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:01.000Z',
        updatedAt: '2026-11-09T05:00:01.000Z',
      };

      const result = reconcileOptimisticMessage(initialMessages, serverResponse, tempId);

      // Must remove duplicate tempId and retain exactly 1 canonical message
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, canonicalId);
    });

    it('preserves newer socket-delivered edit when late REST response arrives (FINDING-07)', () => {
      const tempId = 'temp-edit-race';
      const canonicalId = 'msg-canonical-edited';

      // State has optimistic message AND socket event arrived first, followed immediately by an edit event
      const initialMessages: ClientMessage[] = [
        {
          id: tempId,
          tempId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Original draft',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
        {
          id: canonicalId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Edited content via socket',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: true,
          editedAt: '2026-11-09T05:01:00.000Z',
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:01:00.000Z', // Newer timestamp
          localStatus: 'sent',
        },
      ];

      // Late REST response contains the original, unedited content
      const staleRestResponse: Message = {
        id: canonicalId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Original draft',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:00.000Z',
        updatedAt: '2026-11-09T05:00:00.000Z', // Older timestamp
      };

      const result = reconcileOptimisticMessage(initialMessages, staleRestResponse, tempId);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, canonicalId);
      assert.strictEqual(result[0].content, 'Edited content via socket', 'Must preserve edited content');
      assert.strictEqual(result[0].isEdited, true, 'Must preserve isEdited flag');
      assert.strictEqual(result[0].editedAt, '2026-11-09T05:01:00.000Z');
      assert.strictEqual(result[0].updatedAt, '2026-11-09T05:01:00.000Z');
    });

    it('never restores soft-deleted content when late REST response arrives (FINDING-07)', () => {
      const tempId = 'temp-delete-race';
      const canonicalId = 'msg-canonical-deleted';

      // State has optimistic message AND socket delete event already marked it deleted
      const initialMessages: ClientMessage[] = [
        {
          id: tempId,
          tempId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Secret message to be deleted',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
        {
          id: canonicalId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: null, // Masked by soft-delete
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: true, // Soft-deleted
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:02:00.000Z',
          localStatus: 'sent',
        },
      ];

      // Late REST response contains original plaintext content
      const staleRestResponse: Message = {
        id: canonicalId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Secret message to be deleted',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:00.000Z',
        updatedAt: '2026-11-09T05:00:00.000Z',
      };

      const result = reconcileOptimisticMessage(initialMessages, staleRestResponse, tempId);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, canonicalId);
      assert.strictEqual(result[0].isDeleted, true, 'isDeleted must remain true');
      assert.strictEqual(result[0].content, null, 'Content must remain null tombstone');
    });

    it('reconciles optimistic messages previously marked as failed or uncertain', () => {
      const tempId = 'temp-failed-msg';
      const canonicalId = 'msg-eventual-success';

      const initialMessages: ClientMessage[] = [
        {
          id: tempId,
          tempId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Retryable message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'uncertain',
          sendError: 'Request timed out',
        },
      ];

      const serverResponse: Message = {
        id: canonicalId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Retryable message',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:01.000Z',
        updatedAt: '2026-11-09T05:00:01.000Z',
      };

      const result = reconcileOptimisticMessage(initialMessages, serverResponse, tempId);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, canonicalId);
      assert.strictEqual(result[0].tempId, undefined);
      assert.strictEqual(result[0].localStatus, 'sent');
      assert.strictEqual(result[0].sendError, undefined);
    });
  });

  describe('appendOrUpdateMessage', () => {
    it('appends a new incoming message at the end (ascending chronological order)', () => {
      const initial: ClientMessage[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'First',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
        },
      ];

      const newMsg: Message = {
        id: 'msg-2',
        conversationId: mockConvId,
        senderId: mockPartner,
        type: 'TEXT',
        content: 'Second',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:01:00.000Z',
        updatedAt: '2026-11-09T05:01:00.000Z',
      };

      const result = appendOrUpdateMessage(initial, newMsg);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 'msg-1');
      assert.strictEqual(result[1].id, 'msg-2');
    });

    it('updates existing message by ID without creating duplicate', () => {
      const initial: ClientMessage[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
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
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
        },
      ];

      const updated: Message = {
        id: 'msg-1',
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Updated Content',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: true,
        editedAt: '2026-11-09T05:02:00.000Z',
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:00.000Z',
        updatedAt: '2026-11-09T05:02:00.000Z',
      };

      const result = appendOrUpdateMessage(initial, updated);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].content, 'Updated Content');
      assert.strictEqual(result[0].isEdited, true);
    });

    it('does not collapse or collide two distinct messages with identical content (FINDING-08)', () => {
      const initial: ClientMessage[] = [
        {
          id: 'temp-id-1',
          tempId: 'temp-id-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Hello sweetheart',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
      ];

      // Second message has identical content but distinct canonical ID
      const secondIncoming: Message = {
        id: 'msg-canonical-2',
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Hello sweetheart',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:02.000Z',
        updatedAt: '2026-11-09T05:00:02.000Z',
      };

      const result = appendOrUpdateMessage(initial, secondIncoming);

      // Must keep both distinct messages because content-only correlation is unsafe
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 'temp-id-1');
      assert.strictEqual(result[1].id, 'msg-canonical-2');
    });
  });

  describe('clientMutationId correlation & ordering scenarios', () => {
    it('1. REST response arriving before message_sent leaves exactly one canonical message', () => {
      const mutationId = 'mutation-uuid-1';
      const canonicalId = 'canonical-msg-1';

      // 1. Initial optimistic message in flight
      const initialMessages: ClientMessage[] = [
        {
          id: mutationId,
          tempId: mutationId,
          clientMutationId: mutationId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Hello sweetheart',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
      ];

      // 2. REST 201 response arrives first
      const restResponse: Message = {
        id: canonicalId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Hello sweetheart',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:01.000Z',
        updatedAt: '2026-11-09T05:00:01.000Z',
      };
      const afterRest = reconcileOptimisticMessage(initialMessages, restResponse, mutationId);

      assert.strictEqual(afterRest.length, 1);
      assert.strictEqual(afterRest[0].id, canonicalId);
      assert.strictEqual(afterRest[0].tempId, undefined);
      assert.strictEqual(afterRest[0].localStatus, 'sent');

      // 3. Socket message_sent arrives second
      const socketPayload: Message = {
        id: canonicalId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Hello sweetheart',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:01.000Z',
        updatedAt: '2026-11-09T05:00:01.000Z',
      };
      const afterSocket = appendOrUpdateMessage(afterRest, socketPayload);

      assert.strictEqual(afterSocket.length, 1, 'Exactly one message must remain in state');
      assert.strictEqual(afterSocket[0].id, canonicalId);
      assert.strictEqual(afterSocket[0].tempId, undefined);
      assert.strictEqual(afterSocket[0].localStatus, 'sent');
    });

    it('2. message_sent arriving before the REST response leaves exactly one canonical message', () => {
      const mutationId = 'mutation-uuid-2';
      const canonicalId = 'canonical-msg-2';

      // 1. Initial optimistic message in flight
      const initialMessages: ClientMessage[] = [
        {
          id: mutationId,
          tempId: mutationId,
          clientMutationId: mutationId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Fast socket message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
      ];

      // 2. Socket message_sent arrives first (fast broadcast, slow HTTP return)
      const socketPayload: Message = {
        id: canonicalId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Fast socket message',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:01.000Z',
        updatedAt: '2026-11-09T05:00:01.000Z',
      };
      const afterSocket = appendOrUpdateMessage(initialMessages, socketPayload);

      // Successfully matched by clientMutationId against tempId and updated in place
      assert.strictEqual(afterSocket.length, 1, 'Socket event must reconcile optimistic entry without duplicating');
      assert.strictEqual(afterSocket[0].id, canonicalId);
      assert.strictEqual(afterSocket[0].tempId, undefined);
      assert.strictEqual(afterSocket[0].localStatus, 'sent');

      // 3. Delayed REST response resolves second
      const restResponse: Message = {
        id: canonicalId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Fast socket message',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:01.000Z',
        updatedAt: '2026-11-09T05:00:01.000Z',
      };
      const afterRest = reconcileOptimisticMessage(afterSocket, restResponse, mutationId);

      assert.strictEqual(afterRest.length, 1, 'Exactly one message must remain in state');
      assert.strictEqual(afterRest[0].id, canonicalId);
      assert.strictEqual(afterRest[0].tempId, undefined);
      assert.strictEqual(afterRest[0].localStatus, 'sent');
    });

    it('3. REST timeout after backend commit followed by message_sent leaves exactly one canonical message', () => {
      const mutationId = 'mutation-uuid-3';
      const canonicalId = 'canonical-msg-3';

      // 1. Initial optimistic message in flight
      const initialMessages: ClientMessage[] = [
        {
          id: mutationId,
          tempId: mutationId,
          clientMutationId: mutationId,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Timeout recovery message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
      ];

      // 2. REST HTTP request times out (network offline / gateway 504 / timeout)
      const timeoutError = { statusCode: 0, message: 'Network timeout after 10000ms' };
      const classified = classifySendError(timeoutError);
      assert.strictEqual(classified.status, 'uncertain');

      const afterTimeout = markMessageFailed(
        initialMessages,
        mutationId,
        classified.errorMessage,
        classified.status
      );

      assert.strictEqual(afterTimeout.length, 1);
      assert.strictEqual(afterTimeout[0].localStatus, 'uncertain');
      assert.strictEqual(afterTimeout[0].tempId, mutationId);

      // 3. Backend had successfully committed, so socket broadcast arrives with clientMutationId
      const socketPayload: Message = {
        id: canonicalId,
        clientMutationId: mutationId,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Timeout recovery message',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:02.000Z',
        updatedAt: '2026-11-09T05:00:02.000Z',
      };
      const afterSocket = appendOrUpdateMessage(afterTimeout, socketPayload);

      // Reconciles uncertain optimistic entry into confirmed canonical sent message
      assert.strictEqual(afterSocket.length, 1, 'Exactly one message must remain in state');
      assert.strictEqual(afterSocket[0].id, canonicalId);
      assert.strictEqual(afterSocket[0].tempId, undefined);
      assert.strictEqual(afterSocket[0].localStatus, 'sent');
      assert.strictEqual(afterSocket[0].sendError, undefined);
    });

    it('4. Two messages with identical content but different mutation IDs do not collide or overwrite', () => {
      const mutationIdA = 'mutation-uuid-4a';
      const mutationIdB = 'mutation-uuid-4b';
      const canonicalIdA = 'canonical-msg-4a';
      const canonicalIdB = 'canonical-msg-4b';

      // 1. User rapidly sends two identical messages: "Love you"
      const initialMessages: ClientMessage[] = [
        {
          id: mutationIdA,
          tempId: mutationIdA,
          clientMutationId: mutationIdA,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Love you',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
        {
          id: mutationIdB,
          tempId: mutationIdB,
          clientMutationId: mutationIdB,
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Love you',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:01.000Z',
          updatedAt: '2026-11-09T05:00:01.000Z',
          localStatus: 'sending',
        },
      ];

      // 2. message_sent for Message A arrives first
      const socketPayloadA: Message = {
        id: canonicalIdA,
        clientMutationId: mutationIdA,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Love you',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:02.000Z',
        updatedAt: '2026-11-09T05:00:02.000Z',
      };
      const afterSocketA = appendOrUpdateMessage(initialMessages, socketPayloadA);

      assert.strictEqual(afterSocketA.length, 2);
      assert.strictEqual(afterSocketA[0].id, canonicalIdA);
      assert.strictEqual(afterSocketA[0].tempId, undefined);
      assert.strictEqual(afterSocketA[0].localStatus, 'sent');
      // Second message must remain intact in sending state
      assert.strictEqual(afterSocketA[1].id, mutationIdB);
      assert.strictEqual(afterSocketA[1].tempId, mutationIdB);
      assert.strictEqual(afterSocketA[1].localStatus, 'sending');

      // 3. message_sent for Message B arrives second
      const socketPayloadB: Message = {
        id: canonicalIdB,
        clientMutationId: mutationIdB,
        conversationId: mockConvId,
        senderId: mockUser1,
        type: 'TEXT',
        content: 'Love you',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:03.000Z',
        updatedAt: '2026-11-09T05:00:03.000Z',
      };
      const afterSocketB = appendOrUpdateMessage(afterSocketA, socketPayloadB);

      // Both messages reconciled to their respective canonical IDs without collision
      assert.strictEqual(afterSocketB.length, 2);
      assert.strictEqual(afterSocketB[0].id, canonicalIdA);
      assert.strictEqual(afterSocketB[0].tempId, undefined);
      assert.strictEqual(afterSocketB[0].localStatus, 'sent');

      assert.strictEqual(afterSocketB[1].id, canonicalIdB);
      assert.strictEqual(afterSocketB[1].tempId, undefined);
      assert.strictEqual(afterSocketB[1].localStatus, 'sent');
    });
  });

  describe('classifySendError (FINDING-02)', () => {
    it('classifies network timeout (status 0 / timeout) as uncertain and retryable with idempotency', () => {
      const timeoutErr = {
        statusCode: 0,
        message: 'Request timed out. Please check your network connection.',
      };

      const result = classifySendError(timeoutErr);
      assert.strictEqual(result.status, 'uncertain');
      assert.strictEqual(result.isRetryable, true);
    });

    it('classifies 5xx server errors as uncertain and retryable with idempotency', () => {
      const serverErr = {
        statusCode: 500,
        message: 'Internal server error',
      };

      const result = classifySendError(serverErr);
      assert.strictEqual(result.status, 'uncertain');
      assert.strictEqual(result.isRetryable, true);
    });

    it('classifies 429 rate limit as failed and retryable', () => {
      const rateLimitErr = {
        statusCode: 429,
        message: 'Too many requests',
      };

      const result = classifySendError(rateLimitErr);
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.isRetryable, true);
    });

    it('classifies 400 validation rejection as failed and non-retryable', () => {
      const validationErr = {
        statusCode: 400,
        message: 'Validation failed',
      };

      const result = classifySendError(validationErr);
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.isRetryable, false);
    });

    it('classifies 409 conflict error as failed and non-retryable', () => {
      const conflictErr = {
        statusCode: 409,
        message: 'Idempotency conflict: clientMutationId has already been used with different content or payload',
      };

      const result = classifySendError(conflictErr);
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.isRetryable, false);
    });
  });

  describe('prependOlderMessages', () => {
    it('prepends older paginated batch to index 0 and deduplicates existing IDs', () => {
      const current: ClientMessage[] = [
        {
          id: 'msg-3',
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Recent',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:03:00.000Z',
          updatedAt: '2026-11-09T05:03:00.000Z',
        },
      ];

      const older: Message[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Oldest',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
        },
        {
          id: 'msg-3', // Duplicate of current
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Recent',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:03:00.000Z',
          updatedAt: '2026-11-09T05:03:00.000Z',
        },
      ];

      const result = prependOlderMessages(current, older);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 'msg-1', 'Oldest message must be at index 0');
      assert.strictEqual(result[1].id, 'msg-3', 'Recent message must be at index 1');
    });
  });

  describe('markMessageFailed', () => {
    it('sets localStatus to failed and attaches error message for matching tempId', () => {
      const initial: ClientMessage[] = [
        {
          id: 'temp-fail-1',
          tempId: 'temp-fail-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Will fail',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
          localStatus: 'sending',
        },
      ];

      const result = markMessageFailed(initial, 'temp-fail-1', 'Network disconnected');

      assert.strictEqual(result[0].localStatus, 'failed');
      assert.strictEqual(result[0].sendError, 'Network disconnected');
    });
  });

  describe('applyMessageEdit and applyMessageDelete', () => {
    it('updates content and edited flags on applyMessageEdit', () => {
      const initial: ClientMessage[] = [
        {
          id: 'msg-edit-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Before edit',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
        },
      ];

      const result = applyMessageEdit(
        initial,
        'msg-edit-1',
        'After edit',
        true,
        '2026-11-09T05:05:00.000Z',
        '2026-11-09T05:05:00.000Z'
      );

      assert.strictEqual(result[0].content, 'After edit');
      assert.strictEqual(result[0].isEdited, true);
      assert.strictEqual(result[0].editedAt, '2026-11-09T05:05:00.000Z');
    });

    it('soft-deletes message and masks content to null on applyMessageDelete', () => {
      const initial: ClientMessage[] = [
        {
          id: 'msg-delete-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Confidential text',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
        },
      ];

      const result = applyMessageDelete(initial, 'msg-delete-1', '2026-11-09T05:10:00.000Z');

      assert.strictEqual(result[0].content, null);
      assert.strictEqual(result[0].isDeleted, true);
      assert.strictEqual(result[0].updatedAt, '2026-11-09T05:10:00.000Z');
    });
  });

  describe('applyMessagesRead', () => {
    it('marks messages sent by current user as read up to boundary message', () => {
      const initial: ClientMessage[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Msg 1',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
        },
        {
          id: 'msg-2',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Msg 2',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:01:00.000Z',
          updatedAt: '2026-11-09T05:01:00.000Z',
        },
        {
          id: 'msg-3',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Msg 3',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:02:00.000Z',
          updatedAt: '2026-11-09T05:02:00.000Z',
        },
      ];

      const readAt = '2026-11-09T05:15:00.000Z';
      const result = applyMessagesRead(initial, mockUser1, readAt, 'msg-2');

      assert.strictEqual(result[0].readAt, readAt);
      assert.strictEqual(result[0].localStatus, 'read');
      assert.strictEqual(result[1].readAt, readAt);
      assert.strictEqual(result[1].localStatus, 'read');
      assert.strictEqual(result[2].readAt, null, 'Message after boundary must remain unread');
    });

    it('marks all messages sent by current user as read when boundary is omitted', () => {
      const initial: ClientMessage[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Msg 1',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00.000Z',
          updatedAt: '2026-11-09T05:00:00.000Z',
        },
      ];

      const readAt = '2026-11-09T05:15:00.000Z';
      const result = applyMessagesRead(initial, mockUser1, readAt);

      assert.strictEqual(result[0].readAt, readAt);
      assert.strictEqual(result[0].localStatus, 'read');
    });
  });

  describe('updateConversationWithLastMessage and markConversationReadInList', () => {
    it('moves conversation to top of list and increments unread count when inactive', () => {
      const convList: Conversation[] = [
        {
          id: 'conv-other',
          otherUser: { id: 'p2', email: 'other@gmail.com', createdAt: '...' },
          unreadCount: 0,
          lastMessage: null,
          createdAt: '2026-11-09T04:00:00.000Z',
          updatedAt: '2026-11-09T04:00:00.000Z',
        },
        {
          id: mockConvId,
          otherUser: { id: mockPartner, email: 'sweetheart@gmail.com', createdAt: '...' },
          unreadCount: 1,
          lastMessage: null,
          createdAt: '2026-11-09T04:00:00.000Z',
          updatedAt: '2026-11-09T04:00:00.000Z',
        },
      ];

      const newLastMsg: LastMessage = {
        id: 'msg-new',
        senderId: mockPartner, // From partner
        type: 'TEXT',
        content: 'New message!',
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:20:00.000Z',
      };

      const result = updateConversationWithLastMessage(
        convList,
        mockConvId,
        newLastMsg,
        false, // Not active
        mockUser1
      );

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, mockConvId, 'Must move to index 0');
      assert.strictEqual(result[0].unreadCount, 2, 'Unread count must increment by 1');
      assert.strictEqual(result[0].lastMessage?.content, 'New message!');
      assert.strictEqual(result[1].id, 'conv-other');
    });

    it('does not increment unread count when conversation is currently active', () => {
      const convList: Conversation[] = [
        {
          id: mockConvId,
          otherUser: { id: mockPartner, email: 'sweetheart@gmail.com', createdAt: '...' },
          unreadCount: 0,
          lastMessage: null,
          createdAt: '2026-11-09T04:00:00.000Z',
          updatedAt: '2026-11-09T04:00:00.000Z',
        },
      ];

      const newLastMsg: LastMessage = {
        id: 'msg-active',
        senderId: mockPartner,
        type: 'TEXT',
        content: 'While reading',
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:25:00.000Z',
      };

      const result = updateConversationWithLastMessage(
        convList,
        mockConvId,
        newLastMsg,
        true, // Currently active!
        mockUser1
      );

      assert.strictEqual(result[0].unreadCount, 0, 'Unread count must not increment while active');
    });

    it('clears unread count on markConversationReadInList', () => {
      const convList: Conversation[] = [
        {
          id: mockConvId,
          otherUser: { id: mockPartner, email: 'sweetheart@gmail.com', createdAt: '...' },
          unreadCount: 7,
          lastMessage: null,
          createdAt: '2026-11-09T04:00:00.000Z',
          updatedAt: '2026-11-09T04:00:00.000Z',
        },
      ];

      const result = markConversationReadInList(convList, mockConvId);

      assert.strictEqual(result[0].unreadCount, 0);
    });
  });

  describe('syncMessagesOnReconnect (Phase 1D)', () => {
    it('deduplicates existing messages by canonical message ID and updates server fields', () => {
      const currentMessages: ClientMessage[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Hello',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null, // Partner had not read yet
          createdAt: '2026-11-09T08:00:00.000Z',
          updatedAt: '2026-11-09T08:00:00.000Z',
          localStatus: 'sent',
        },
      ];

      const latestMessages: Message[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Hello',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: '2026-11-09T08:05:00.000Z', // Partner read while we were offline!
          createdAt: '2026-11-09T08:00:00.000Z',
          updatedAt: '2026-11-09T08:05:00.000Z',
        },
      ];

      const result = syncMessagesOnReconnect(currentMessages, latestMessages);

      assert.strictEqual(result.length, 1, 'Must deduplicate by ID');
      assert.strictEqual(result[0].id, 'msg-1');
      assert.strictEqual(result[0].readAt, '2026-11-09T08:05:00.000Z');
      assert.strictEqual(result[0].localStatus, 'read', 'Status must transition to read');
    });

    it('recovers missed partner messages that arrived during offline period', () => {
      const currentMessages: ClientMessage[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Hello',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T08:00:00.000Z',
          updatedAt: '2026-11-09T08:00:00.000Z',
          localStatus: 'sent',
        },
      ];

      const latestMessages: Message[] = [
        {
          id: 'msg-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Hello',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T08:00:00.000Z',
          updatedAt: '2026-11-09T08:00:00.000Z',
        },
        {
          id: 'msg-2-missed',
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'I missed you while you were offline!',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T08:02:00.000Z',
          updatedAt: '2026-11-09T08:02:00.000Z',
        },
      ];

      const result = syncMessagesOnReconnect(currentMessages, latestMessages);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 'msg-1');
      assert.strictEqual(result[1].id, 'msg-2-missed');
      assert.strictEqual(result[1].localStatus, 'sent');
    });

    it('preserves in-flight optimistic messages and reconciles if server returned them', () => {
      const currentMessages: ClientMessage[] = [
        {
          id: 'temp-opt-1',
          tempId: 'temp-opt-1',
          clientMutationId: 'temp-opt-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'In-flight message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T08:01:00.000Z',
          updatedAt: '2026-11-09T08:01:00.000Z',
          localStatus: 'sending',
        },
      ];

      // Case A: Server did persist it and returned it with clientMutationId
      const latestMessagesServerA: Message[] = [
        {
          id: 'server-canonical-1',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'In-flight message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T08:01:00.000Z',
          updatedAt: '2026-11-09T08:01:00.000Z',
          clientMutationId: 'temp-opt-1',
        },
      ];

      const resultA = syncMessagesOnReconnect(currentMessages, latestMessagesServerA);
      assert.strictEqual(resultA.length, 1);
      assert.strictEqual(resultA[0].id, 'server-canonical-1');
      assert.strictEqual(resultA[0].tempId, undefined);
      assert.strictEqual(resultA[0].localStatus, 'sent');

      // Case B: Server has NOT returned it yet (still in flight / pending)
      const latestMessagesServerB: Message[] = [];
      const resultB = syncMessagesOnReconnect(currentMessages, latestMessagesServerB);
      assert.strictEqual(resultB.length, 1);
      assert.strictEqual(resultB[0].id, 'temp-opt-1');
      assert.strictEqual(resultB[0].localStatus, 'sending');
    });

    it('preserves older paginated history outside the latest batch and maintains ascending order', () => {
      const currentMessages: ClientMessage[] = [
        {
          id: 'older-paginated-msg',
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Older message from history',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: '2026-11-09T07:00:00.000Z',
          createdAt: '2026-11-09T07:00:00.000Z',
          updatedAt: '2026-11-09T07:00:00.000Z',
          localStatus: 'read',
        },
        {
          id: 'msg-recent',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Recent message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T08:00:00.000Z',
          updatedAt: '2026-11-09T08:00:00.000Z',
          localStatus: 'sent',
        },
      ];

      // Reconnect returns only latest batch which does NOT include older-paginated-msg
      const latestMessages: Message[] = [
        {
          id: 'msg-recent',
          conversationId: mockConvId,
          senderId: mockUser1,
          type: 'TEXT',
          content: 'Recent message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T08:00:00.000Z',
          updatedAt: '2026-11-09T08:00:00.000Z',
        },
        {
          id: 'msg-brand-new',
          conversationId: mockConvId,
          senderId: mockPartner,
          type: 'TEXT',
          content: 'Brand new message',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T08:10:00.000Z',
          updatedAt: '2026-11-09T08:10:00.000Z',
        },
      ];

      const result = syncMessagesOnReconnect(currentMessages, latestMessages);

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].id, 'older-paginated-msg', 'Oldest preserved at index 0');
      assert.strictEqual(result[1].id, 'msg-recent');
      assert.strictEqual(result[2].id, 'msg-brand-new', 'Newest at index 2');
    });
  });
});

