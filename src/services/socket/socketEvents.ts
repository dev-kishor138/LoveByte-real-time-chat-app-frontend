import type { Message, MessageType } from '../api/types.ts';

/**
 * Client-to-Server Event Payloads
 * Strictly matching backend validation schemas in backend/src/sockets/chat.socket.ts
 */

export interface JoinConversationPayload {
  conversationId: string;
}

export interface LeaveConversationPayload {
  conversationId: string;
}

export interface SocketSendMessagePayload {
  conversationId: string;
  content: string;
  type?: MessageType; // Defaults to 'TEXT'
  clientMutationId?: string;
}

export interface SocketEditMessagePayload {
  messageId: string;
  content: string;
}

export interface SocketDeleteMessagePayload {
  messageId: string;
}

export interface SocketMarkReadPayload {
  conversationId: string;
  lastMessageId?: string;
}

export interface SocketTypingPayload {
  conversationId: string;
}

/**
 * Acknowledgment Callbacks (Server responses to Client-to-Server events)
 */

export interface RoomAckResponse {
  success: boolean;
  conversationId?: string;
  error?: string;
}

export interface SendMessageAckResponse {
  success: boolean;
  message?: Message;
  error?: string;
}

export interface EditMessageAckResponse {
  success: boolean;
  message?: Message;
  error?: string;
}

export interface MessageTombstone {
  id: string;
  conversationId: string;
  isDeleted: boolean;
  updatedAt: string;
}

export interface DeleteMessageAckResponse {
  success: boolean;
  messageId?: string;
  tombstone?: MessageTombstone;
  error?: string;
}

export interface MarkReadAckResponse {
  success: boolean;
  conversationId?: string;
  count?: number;
  readAt?: string | Date;
  lastReadMessageId?: string | null;
  error?: string;
}

export interface TypingAckResponse {
  success: boolean;
  error?: string;
}

/**
 * Server-to-Client Inbound Event Payloads
 */

export interface MessagesReadEventPayload {
  conversationId: string;
  readerId: string;
  readAt: string;
  count: number;
  lastReadMessageId: string | null;
}

export interface UserPresenceEventPayload {
  userId: string;
  status: 'online' | 'offline';
  lastSeenAt: string | null;
}

export interface UserTypingEventPayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface ConversationJoinedEventPayload {
  conversationId: string;
}

export interface ConversationLeftEventPayload {
  conversationId: string;
}

export interface SocketErrorEventPayload {
  event?: string;
  error: string;
}

/**
 * Mapping of all Server-to-Client events and their payload signatures
 */
export interface ServerToClientEvents {
  new_message: (message: Message) => void;
  message_sent: (message: Message) => void;
  message_edited: (message: Message) => void;
  message_deleted: (tombstone: MessageTombstone) => void;
  messages_read: (payload: MessagesReadEventPayload) => void;
  user_presence: (payload: UserPresenceEventPayload) => void;
  user_typing: (payload: UserTypingEventPayload) => void;
  conversation_joined: (payload: ConversationJoinedEventPayload) => void;
  conversation_left: (payload: ConversationLeftEventPayload) => void;
  error: (payload: SocketErrorEventPayload) => void;
}

export type ServerToClientEventName = keyof ServerToClientEvents;

/**
 * Mapping of all Client-to-Server events and their payload signatures
 */
export interface ClientToServerEvents {
  join_conversation: (payload: JoinConversationPayload, callback?: (res: RoomAckResponse) => void) => void;
  leave_conversation: (payload: LeaveConversationPayload, callback?: (res: RoomAckResponse) => void) => void;
  send_message: (payload: SocketSendMessagePayload, callback?: (res: SendMessageAckResponse) => void) => void;
  edit_message: (payload: SocketEditMessagePayload, callback?: (res: EditMessageAckResponse) => void) => void;
  delete_message: (payload: SocketDeleteMessagePayload, callback?: (res: DeleteMessageAckResponse) => void) => void;
  mark_read: (payload: SocketMarkReadPayload, callback?: (res: MarkReadAckResponse) => void) => void;
  typing_start: (payload: SocketTypingPayload, callback?: (res: TypingAckResponse) => void) => void;
  typing_stop: (payload: SocketTypingPayload, callback?: (res: TypingAckResponse) => void) => void;
}

export type ClientToServerEventName = keyof ClientToServerEvents;

