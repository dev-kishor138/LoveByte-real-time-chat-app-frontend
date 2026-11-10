import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { apiClient } from './client.ts';
import { chatApi } from './chat.ts';
import { usersApi } from './users.ts';
import { ApiError } from './types.ts';
import type {
  Conversation,
  Message,
  MarkMessagesAsReadResponse,
  UserProfileResponse,
} from './types.ts';

describe('Chat & Users REST API Services (Stage 3.1)', () => {
  const originalGet = apiClient.get;
  const originalPost = apiClient.post;
  const originalPatch = apiClient.patch;
  const originalDelete = apiClient.delete;

  afterEach(() => {
    apiClient.get = originalGet;
    apiClient.post = originalPost;
    apiClient.patch = originalPatch;
    apiClient.delete = originalDelete;
  });

  describe('chatApi.listConversations & getConversations', () => {
    it('sends GET /api/chat/conversations with query parameters and parses direct array', async () => {
      let capturedUrl = '';
      let capturedConfig: any = null;

      const mockConversations: Conversation[] = [
        {
          id: 'conv-uuid-1',
          otherUser: {
            id: 'partner-uuid-1',
            email: 'partner@gmail.com',
            displayName: 'Sweetheart',
            lastSeenAt: '2026-11-09T04:30:00.000Z',
            createdAt: '2026-11-06T15:00:00.000Z',
          },
          unreadCount: 3,
          lastMessage: {
            id: 'msg-uuid-1',
            senderId: 'partner-uuid-1',
            type: 'TEXT',
            content: 'Good morning!',
            isEdited: false,
            editedAt: null,
            isDeleted: false,
            readAt: null,
            createdAt: '2026-11-09T04:30:00.000Z',
          },
          createdAt: '2026-11-08T10:00:00.000Z',
          updatedAt: '2026-11-09T04:30:00.000Z',
        },
      ];

      apiClient.get = (async (url: string, config?: any) => {
        capturedUrl = url;
        capturedConfig = config;
        return { data: mockConversations, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      const result = await chatApi.listConversations({ limit: 10, cursor: 'cursor-uuid' });

      assert.strictEqual(capturedUrl, '/api/chat/conversations');
      assert.strictEqual(capturedConfig?.params?.limit, 10);
      assert.strictEqual(capturedConfig?.params?.cursor, 'cursor-uuid');
      assert.strictEqual(Array.isArray(result), true);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 'conv-uuid-1');
      assert.strictEqual(result[0].otherUser.displayName, 'Sweetheart');
      assert.strictEqual(result[0].unreadCount, 3);
      assert.strictEqual(result[0].lastMessage?.content, 'Good morning!');
    });

    it('delegates getConversations alias to listConversations and handles empty array', async () => {
      apiClient.get = (async () => ({
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      })) as any;

      const result = await chatApi.getConversations();
      assert.strictEqual(Array.isArray(result), true);
      assert.strictEqual(result.length, 0);
    });

    it('handles conversations with soft-deleted lastMessage (content masked as null)', async () => {
      const mockConversations: Conversation[] = [
        {
          id: 'conv-uuid-2',
          otherUser: {
            id: 'partner-uuid-2',
            email: 'sweetheart@gmail.com',
            displayName: null,
            lastSeenAt: null,
            createdAt: '2026-11-06T15:00:00.000Z',
          },
          unreadCount: 0,
          lastMessage: {
            id: 'msg-uuid-2',
            senderId: 'partner-uuid-2',
            type: 'TEXT',
            content: null, // Masked
            isEdited: false,
            editedAt: null,
            isDeleted: true,
            readAt: null,
            createdAt: '2026-11-09T04:31:00.000Z',
          },
          createdAt: '2026-11-08T10:00:00.000Z',
          updatedAt: '2026-11-09T04:31:00.000Z',
        },
      ];

      apiClient.get = (async () => ({
        data: mockConversations,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      })) as any;

      const result = await chatApi.listConversations();
      assert.strictEqual(result[0].lastMessage?.isDeleted, true);
      assert.strictEqual(result[0].lastMessage?.content, null);
    });

    it('propagates ApiError on conversation listing failure', async () => {
      apiClient.get = (async () => {
        throw new ApiError(500, 'Database error');
      }) as any;

      await assert.rejects(
        async () => chatApi.listConversations(),
        (err: any) => err instanceof ApiError && err.statusCode === 500 && err.message === 'Database error'
      );
    });
  });

  describe('chatApi.createConversation', () => {
    it('normalizes recipient email and sends POST /api/chat/conversations', async () => {
      let capturedUrl = '';
      let capturedPayload: any = null;

      const mockConversation: Conversation = {
        id: 'new-conv-uuid',
        user1Id: 'user1-uuid',
        user2Id: 'user2-uuid',
        otherUser: {
          id: 'user2-uuid',
          email: 'partner@gmail.com',
          createdAt: '2026-11-06T15:00:00.000Z',
        },
        createdAt: '2026-11-09T05:00:00.000Z',
        updatedAt: '2026-11-09T05:00:00.000Z',
      };

      apiClient.post = (async (url: string, data?: any) => {
        capturedUrl = url;
        capturedPayload = data;
        return { data: mockConversation, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      const result = await chatApi.createConversation({
        recipientEmail: '  PARTNER@GMAIL.COM  ',
      });

      assert.strictEqual(capturedUrl, '/api/chat/conversations');
      assert.strictEqual(capturedPayload.recipientEmail, 'partner@gmail.com');
      assert.strictEqual(result.id, 'new-conv-uuid');
      assert.strictEqual(result.otherUser.email, 'partner@gmail.com');
    });

    it('accepts raw string email parameter', async () => {
      let capturedPayload: any = null;

      apiClient.post = (async (_url: string, data?: any) => {
        capturedPayload = data;
        return {
          data: { id: 'conv-id', otherUser: { id: 'u2', email: 'partner@gmail.com', createdAt: '...' }, createdAt: '...', updatedAt: '...' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {},
        };
      }) as any;

      await chatApi.createConversation('  Partner@gmail.com  ');
      assert.strictEqual(capturedPayload.recipientEmail, 'partner@gmail.com');
    });

    it('propagates ApiError on 404 recipient not found', async () => {
      apiClient.post = (async () => {
        throw new ApiError(404, 'Recipient user not found');
      }) as any;

      await assert.rejects(
        async () => chatApi.createConversation('unknown@gmail.com'),
        (err: any) => err instanceof ApiError && err.statusCode === 404
      );
    });
  });

  describe('chatApi.getMessages', () => {
    it('sends GET /api/chat/conversations/:id/messages with pagination parameters', async () => {
      let capturedUrl = '';
      let capturedConfig: any = null;

      const mockMessages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-uuid-1',
          senderId: 'partner-uuid-1',
          type: 'TEXT',
          content: 'Hello!',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: '2026-11-09T04:32:00.000Z',
          createdAt: '2026-11-09T04:30:00.000Z',
          updatedAt: '2026-11-09T04:32:00.000Z',
        },
        {
          id: 'msg-2',
          conversationId: 'conv-uuid-1',
          senderId: 'my-uuid',
          type: 'TEXT',
          content: null,
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: true,
          readAt: null,
          createdAt: '2026-11-09T04:31:00.000Z',
          updatedAt: '2026-11-09T04:33:00.000Z',
        },
      ];

      apiClient.get = (async (url: string, config?: any) => {
        capturedUrl = url;
        capturedConfig = config;
        return { data: mockMessages, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      const result = await chatApi.getMessages('conv-uuid-1', { limit: 50, cursor: 'msg-cursor-uuid' });

      assert.strictEqual(capturedUrl, '/api/chat/conversations/conv-uuid-1/messages');
      assert.strictEqual(capturedConfig?.params?.limit, 50);
      assert.strictEqual(capturedConfig?.params?.cursor, 'msg-cursor-uuid');
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 'msg-1');
      assert.strictEqual(result[0].content, 'Hello!');
      assert.strictEqual(result[1].isDeleted, true);
      assert.strictEqual(result[1].content, null);
    });

    it('propagates ApiError on 403 participant access denied', async () => {
      apiClient.get = (async () => {
        throw new ApiError(403, 'Access denied to this conversation');
      }) as any;

      await assert.rejects(
        async () => chatApi.getMessages('unauthorized-conv-id'),
        (err: any) => err instanceof ApiError && err.statusCode === 403
      );
    });
  });

  describe('chatApi.sendMessage', () => {
    it('trims content, defaults type to TEXT, and sends POST /api/chat/messages', async () => {
      let capturedUrl = '';
      let capturedPayload: any = null;

      const mockCreatedMessage: Message = {
        id: 'new-msg-uuid',
        conversationId: 'conv-uuid-1',
        senderId: 'user-uuid-1',
        type: 'TEXT',
        content: 'I love you!',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:10:00.000Z',
        updatedAt: '2026-11-09T05:10:00.000Z',
      };

      apiClient.post = (async (url: string, data?: any) => {
        capturedUrl = url;
        capturedPayload = data;
        return { data: mockCreatedMessage, status: 201, statusText: 'Created', headers: {}, config: {} };
      }) as any;

      const result = await chatApi.sendMessage({
        conversationId: 'conv-uuid-1',
        content: '   I love you!   ',
      });

      assert.strictEqual(capturedUrl, '/api/chat/messages');
      assert.strictEqual(capturedPayload.conversationId, 'conv-uuid-1');
      assert.strictEqual(capturedPayload.content, 'I love you!');
      assert.strictEqual(capturedPayload.type, 'TEXT');
      assert.strictEqual(result.id, 'new-msg-uuid');
      assert.strictEqual(result.content, 'I love you!');
    });

    it('forwards optional clientMutationId in request body', async () => {
      let capturedPayload: any = null;
      const mutationId = '00000000-0000-4000-8000-000000000099';

      apiClient.post = (async (_url: string, data?: any) => {
        capturedPayload = data;
        return { data: { id: 'msg-1', clientMutationId: mutationId }, status: 201, statusText: 'Created', headers: {}, config: {} };
      }) as any;

      const result = await chatApi.sendMessage({
        conversationId: 'conv-uuid-1',
        content: 'Correlated message',
        clientMutationId: mutationId,
      });

      assert.strictEqual(capturedPayload.clientMutationId, mutationId);
      assert.strictEqual(result.clientMutationId, mutationId);
    });

    it('propagates ApiError on 400 empty content validation failure', async () => {
      apiClient.post = (async () => {
        throw new ApiError(400, 'Message content cannot be empty');
      }) as any;

      await assert.rejects(
        async () => chatApi.sendMessage({ conversationId: 'c1', content: '   ' }),
        (err: any) => err instanceof ApiError && err.statusCode === 400
      );
    });
  });

  describe('chatApi.editMessage', () => {
    it('trims updated content and sends PATCH /api/chat/messages/:messageId', async () => {
      let capturedUrl = '';
      let capturedPayload: any = null;

      const mockEditedMessage: Message = {
        id: 'msg-uuid-1',
        conversationId: 'conv-uuid-1',
        senderId: 'user-uuid-1',
        type: 'TEXT',
        content: 'Updated content!',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: true,
        editedAt: '2026-11-09T05:15:00.000Z',
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:00.000Z',
        updatedAt: '2026-11-09T05:15:00.000Z',
      };

      apiClient.patch = (async (url: string, data?: any) => {
        capturedUrl = url;
        capturedPayload = data;
        return { data: mockEditedMessage, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      const result = await chatApi.editMessage('msg-uuid-1', {
        content: '   Updated content!   ',
      });

      assert.strictEqual(capturedUrl, '/api/chat/messages/msg-uuid-1');
      assert.strictEqual(capturedPayload.content, 'Updated content!');
      assert.strictEqual(result.isEdited, true);
      assert.strictEqual(result.editedAt, '2026-11-09T05:15:00.000Z');
      assert.strictEqual(result.content, 'Updated content!');
    });

    it('accepts raw string content parameter', async () => {
      let capturedPayload: any = null;

      apiClient.patch = (async (_url: string, data?: any) => {
        capturedPayload = data;
        return { data: { id: 'm1', content: data.content, isEdited: true }, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      await chatApi.editMessage('msg-uuid-1', '  New text  ');
      assert.strictEqual(capturedPayload.content, 'New text');
    });

    it('propagates ApiError on 400 edit window expired (> 24 hours)', async () => {
      apiClient.patch = (async () => {
        throw new ApiError(400, 'Messages can only be edited within 24 hours of creation');
      }) as any;

      await assert.rejects(
        async () => chatApi.editMessage('msg-old', 'new content'),
        (err: any) =>
          err instanceof ApiError &&
          err.statusCode === 400 &&
          err.message === 'Messages can only be edited within 24 hours of creation'
      );
    });
  });

  describe('chatApi.deleteMessage', () => {
    it('sends DELETE /api/chat/messages/:messageId and returns tombstone', async () => {
      let capturedUrl = '';

      const mockTombstone: Message = {
        id: 'msg-to-delete',
        conversationId: 'conv-uuid-1',
        senderId: 'user-uuid-1',
        type: 'TEXT',
        content: null,
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: true,
        readAt: null,
        createdAt: '2026-11-09T05:00:00.000Z',
        updatedAt: '2026-11-09T05:20:00.000Z',
      };

      apiClient.delete = (async (url: string) => {
        capturedUrl = url;
        return { data: mockTombstone, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      const result = await chatApi.deleteMessage('msg-to-delete');

      assert.strictEqual(capturedUrl, '/api/chat/messages/msg-to-delete');
      assert.strictEqual(result.isDeleted, true);
      assert.strictEqual(result.content, null);
    });

    it('propagates ApiError on 403 not sender', async () => {
      apiClient.delete = (async () => {
        throw new ApiError(403, 'Forbidden: You can only delete your own messages');
      }) as any;

      await assert.rejects(
        async () => chatApi.deleteMessage('partner-msg'),
        (err: any) => err instanceof ApiError && err.statusCode === 403
      );
    });
  });

  describe('chatApi.markAsRead', () => {
    it('sends POST /api/chat/conversations/:id/read with lastMessageId boundary', async () => {
      let capturedUrl = '';
      let capturedPayload: any = null;

      const mockResponse: MarkMessagesAsReadResponse = {
        success: true,
        conversationId: 'conv-uuid-1',
        count: 5,
        readAt: '2026-11-09T05:25:00.000Z',
        lastReadMessageId: 'boundary-msg-uuid',
      };

      apiClient.post = (async (url: string, data?: any) => {
        capturedUrl = url;
        capturedPayload = data;
        return { data: mockResponse, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      const result = await chatApi.markAsRead('conv-uuid-1', {
        lastMessageId: 'boundary-msg-uuid',
      });

      assert.strictEqual(capturedUrl, '/api/chat/conversations/conv-uuid-1/read');
      assert.strictEqual(capturedPayload.lastMessageId, 'boundary-msg-uuid');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.count, 5);
      assert.strictEqual(result.lastReadMessageId, 'boundary-msg-uuid');
    });

    it('sends empty object when lastMessageId is omitted', async () => {
      let capturedPayload: any = null;

      apiClient.post = (async (_url: string, data?: any) => {
        capturedPayload = data;
        return {
          data: { success: true, conversationId: 'c1', count: 2, readAt: '...', lastReadMessageId: null },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {},
        };
      }) as any;

      await chatApi.markAsRead('conv-uuid-1');
      assert.deepStrictEqual(capturedPayload, {});
    });

    it('propagates ApiError on 404 boundary message not found', async () => {
      apiClient.post = (async () => {
        throw new ApiError(404, 'Boundary message not found in this conversation');
      }) as any;

      await assert.rejects(
        async () => chatApi.markAsRead('conv-uuid-1', { lastMessageId: 'nonexistent-msg' }),
        (err: any) => err instanceof ApiError && err.statusCode === 404
      );
    });
  });

  describe('usersApi.getProfile & getUser', () => {
    it('sends GET /api/users/:id and returns UserProfileResponse and unwrapped UserProfile', async () => {
      let capturedUrl = '';

      const mockResponse: UserProfileResponse = {
        user: {
          id: 'partner-uuid-1',
          email: 'partner@gmail.com',
          displayName: 'Sweetheart',
          lastSeenAt: '2026-11-09T05:00:00.000Z',
          createdAt: '2026-11-06T15:00:00.000Z',
        },
      };

      apiClient.get = (async (url: string) => {
        capturedUrl = url;
        return { data: mockResponse, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      const profileResponse = await usersApi.getProfile('partner-uuid-1');
      assert.strictEqual(capturedUrl, '/api/users/partner-uuid-1');
      assert.strictEqual(profileResponse.user.displayName, 'Sweetheart');

      const userDirect = await usersApi.getUser('partner-uuid-1');
      assert.strictEqual(userDirect.id, 'partner-uuid-1');
      assert.strictEqual(userDirect.displayName, 'Sweetheart');
      assert.strictEqual(userDirect.email, 'partner@gmail.com');
    });

    it('propagates ApiError on 403 access denied to non-partner profile', async () => {
      apiClient.get = (async () => {
        throw new ApiError(403, "Access denied: You can only view your conversation partner's profile");
      }) as any;

      await assert.rejects(
        async () => usersApi.getUser('stranger-id'),
        (err: any) => err instanceof ApiError && err.statusCode === 403
      );
    });
  });

  describe('usersApi.updateProfile & updateDisplayName', () => {
    it('trims display name and sends PATCH /api/users/profile', async () => {
      let capturedUrl = '';
      let capturedPayload: any = null;

      const mockResponse: UserProfileResponse = {
        user: {
          id: 'my-uuid',
          email: 'me@gmail.com',
          displayName: 'My Darling',
          lastSeenAt: '2026-11-09T05:00:00.000Z',
          createdAt: '2026-11-06T15:00:00.000Z',
        },
      };

      apiClient.patch = (async (url: string, data?: any) => {
        capturedUrl = url;
        capturedPayload = data;
        return { data: mockResponse, status: 200, statusText: 'OK', headers: {}, config: {} };
      }) as any;

      const result = await usersApi.updateProfile({
        displayName: '   My Darling   ',
      });

      assert.strictEqual(capturedUrl, '/api/users/profile');
      assert.strictEqual(capturedPayload.displayName, 'My Darling');
      assert.strictEqual(result.user.displayName, 'My Darling');

      const unwrapped = await usersApi.updateDisplayName('  My Darling  ');
      assert.strictEqual(unwrapped.displayName, 'My Darling');
    });

    it('propagates ApiError on 400 invalid display name format', async () => {
      apiClient.patch = (async () => {
        throw new ApiError(400, 'Display name cannot contain HTML or angle brackets');
      }) as any;

      await assert.rejects(
        async () => usersApi.updateDisplayName('<script>alert(1)</script>'),
        (err: any) => err instanceof ApiError && err.statusCode === 400
      );
    });
  });
});

