import { apiClient } from './client.ts';
import type {
  Conversation,
  Message,
  CreateConversationPayload,
  ListConversationsQuery,
  GetMessagesQuery,
  SendMessagePayload,
  EditMessagePayload,
  MarkMessagesAsReadPayload,
  MarkMessagesAsReadResponse,
} from './types.ts';

/**
 * Chat REST API Service
 * Strictly adheres to verified backend contracts in backend/src/modules/chat/
 * Uses apiClient with automatic Bearer token injection and single-flight 401 refresh.
 */
export const chatApi = {
  /**
   * Retrieves conversations belonging to the authenticated user with optional pagination.
   * Returns a direct JSON array of Conversation objects.
   * GET /api/chat/conversations?limit=20&cursor=<uuid>
   */
  async listConversations(query?: ListConversationsQuery): Promise<Conversation[]> {
    const response = await apiClient.get<Conversation[]>('/api/chat/conversations', {
      params: query,
    });
    return response.data;
  },

  /**
   * Alias for listConversations.
   */
  async getConversations(query?: ListConversationsQuery): Promise<Conversation[]> {
    return this.listConversations(query);
  },

  /**
   * Creates or retrieves a 1-to-1 conversation with the given recipient Gmail address.
   * Normalizes email by trimming and lowercasing.
   * POST /api/chat/conversations
   */
  async createConversation(payload: CreateConversationPayload | string): Promise<Conversation> {
    const rawEmail = typeof payload === 'string' ? payload : payload.recipientEmail;
    const normalizedPayload: CreateConversationPayload = {
      recipientEmail: rawEmail.trim().toLowerCase(),
    };

    const response = await apiClient.post<Conversation>(
      '/api/chat/conversations',
      normalizedPayload
    );
    return response.data;
  },

  /**
   * Retrieves messages for a conversation with cursor pagination.
   * Returns messages in ascending chronological order ([createdAt ASC, id ASC]).
   * GET /api/chat/conversations/:conversationId/messages?limit=50&cursor=<uuid>
   */
  async getMessages(
    conversationId: string,
    query?: GetMessagesQuery
  ): Promise<Message[]> {
    const response = await apiClient.get<Message[]>(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      { params: query }
    );
    return response.data;
  },

  /**
   * Sends a TEXT message to an existing conversation.
   * Enforces trimmed content and defaults type to 'TEXT'.
   * POST /api/chat/messages
   */
  async sendMessage(payload: SendMessagePayload): Promise<Message> {
    const normalizedPayload: SendMessagePayload = {
      conversationId: payload.conversationId,
      content: payload.content.trim(),
      type: payload.type || 'TEXT',
      ...(payload.clientMutationId ? { clientMutationId: payload.clientMutationId } : {}),
    };

    const response = await apiClient.post<Message>(
      '/api/chat/messages',
      normalizedPayload
    );
    return response.data;
  },

  /**
   * Edits the content of an existing text message within 24 hours of creation.
   * Restricted strictly to the original sender on the backend.
   * PATCH /api/chat/messages/:messageId
   */
  async editMessage(
    messageId: string,
    payload: EditMessagePayload | string
  ): Promise<Message> {
    const rawContent = typeof payload === 'string' ? payload : payload.content;
    const normalizedPayload: EditMessagePayload = {
      content: rawContent.trim(),
    };

    const response = await apiClient.patch<Message>(
      `/api/chat/messages/${encodeURIComponent(messageId)}`,
      normalizedPayload
    );
    return response.data;
  },

  /**
   * Soft-deletes a message, producing a tombstone on the backend with masked content.
   * Restricted strictly to the original sender on the backend.
   * DELETE /api/chat/messages/:messageId
   */
  async deleteMessage(messageId: string): Promise<Message> {
    const response = await apiClient.delete<Message>(
      `/api/chat/messages/${encodeURIComponent(messageId)}`
    );
    return response.data;
  },

  /**
   * Marks unread messages in a conversation as read up to an optional boundary message.
   * POST /api/chat/conversations/:conversationId/read
   */
  async markAsRead(
    conversationId: string,
    payload?: MarkMessagesAsReadPayload
  ): Promise<MarkMessagesAsReadResponse> {
    const body = payload?.lastMessageId
      ? { lastMessageId: payload.lastMessageId }
      : {};

    const response = await apiClient.post<MarkMessagesAsReadResponse>(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/read`,
      body
    );
    return response.data;
  },
};

