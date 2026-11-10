/**
 * Backend Contract Types for LoveByte
 * Derived strictly from project-docs/FRONTEND_INTEGRATION_REFERENCE.md and verified backend source.
 */

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorResponse {
  error: string;
  details?: ApiFieldError[];
}

export class ApiError extends Error {
  statusCode: number;
  details?: ApiFieldError[];

  constructor(statusCode: number, message: string, details?: ApiFieldError[]) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Message types supported by LoveByte.
 * Stage 3 is strictly restricted to TEXT messages.
 * Media types (IMAGE, VOICE) are deferred to Phase 4.
 */
export type MessageType = 'TEXT';

/**
 * Participant user representation in conversation metadata.
 */
export interface OtherUser {
  id: string;
  email: string;
  displayName?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
}

/**
 * Preview summary of the last message in a conversation.
 * If the message was soft-deleted, content is masked as null.
 */
export interface LastMessage {
  id: string;
  senderId: string;
  type: MessageType;
  content: string | null;
  isEdited: boolean;
  editedAt: string | null;
  isDeleted: boolean;
  readAt: string | null;
  createdAt: string;
}

/**
 * 1-to-1 Conversation representation.
 * Returned by GET /api/chat/conversations and POST /api/chat/conversations.
 */
export interface Conversation {
  id: string;
  user1Id?: string;
  user2Id?: string;
  otherUser: OtherUser;
  unreadCount?: number;
  lastMessage?: LastMessage | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full message record returned by message queries and mutations.
 * If isDeleted is true, content is masked as null.
 */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content: string | null;
  fileKey: string | null;
  fileMime: string | null;
  fileSize: number | null;
  isEdited: boolean;
  editedAt: string | null;
  isDeleted: boolean;
  readAt?: string | null;
  createdAt: string;
  updatedAt: string;
  clientMutationId?: string;
}

/**
 * Request payload for POST /api/chat/conversations
 */
export interface CreateConversationPayload {
  recipientEmail: string;
}

/**
 * Query parameters for GET /api/chat/conversations
 */
export interface ListConversationsQuery {
  limit?: number; // 1 to 50, default 20
  cursor?: string; // conversation UUID
}

/**
 * Query parameters for GET /api/chat/conversations/:conversationId/messages
 */
export interface GetMessagesQuery {
  limit?: number; // 1 to 100, default 50
  cursor?: string; // message UUID
}

/**
 * Request payload for POST /api/chat/messages
 */
export interface SendMessagePayload {
  conversationId: string;
  content: string;
  type?: MessageType;
  clientMutationId?: string;
}

/**
 * Request payload for PATCH /api/chat/messages/:messageId
 */
export interface EditMessagePayload {
  content: string;
}

/**
 * Request payload for POST /api/chat/conversations/:conversationId/read
 */
export interface MarkMessagesAsReadPayload {
  lastMessageId?: string;
}

/**
 * Response payload for POST /api/chat/conversations/:conversationId/read
 */
export interface MarkMessagesAsReadResponse {
  success: boolean;
  conversationId: string;
  count: number;
  readAt: string;
  lastReadMessageId: string | null;
}

/**
 * User profile record returned by /api/users endpoints
 */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

/**
 * Envelope returned by /api/users endpoints
 */
export interface UserProfileResponse {
  user: UserProfile;
}

/**
 * Request payload for PATCH /api/users/profile
 */
export interface UpdateProfilePayload {
  displayName: string;
}
