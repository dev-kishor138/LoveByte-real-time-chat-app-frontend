import type { Conversation, LastMessage, Message } from '../services/api/types.ts';
import type { SocketConnectionState } from '../services/socket/socketClient.ts';

/**
 * Client delivery state for messages.
 * - pending: Waiting in persistent local offline queue for network connectivity or queue processor.
 * - sending: In-flight HTTP POST request.
 * - sent: Server-confirmed message received via REST or Socket.IO.
 * - read: Confirmed read by partner.
 * - failed: Confirmed client-side or server rejection (e.g. rate limit, validation).
 * - uncertain: Ambiguous transport outcome (network timeout, connection drop, 5xx).
 */
export type MessageDeliveryStatus = 'pending' | 'sending' | 'sent' | 'read' | 'failed' | 'uncertain';

/**
 * Enriched message representation used throughout client state.
 * Preserves canonical backend Message fields while adding client-side tracking.
 */
export interface ClientMessage extends Message {
  localStatus?: MessageDeliveryStatus;
  tempId?: string;
  sendError?: string;
}

/**
 * Shared ChatContext contract exposed to consumers.
 */
export interface ChatContextValue {
  conversations: Conversation[];
  activeConversationId: string | null;
  totalUnreadCount: number;
  socketStatus: SocketConnectionState;
  isLoadingConversations: boolean;
  conversationsError: string | null;
  refreshConversations: () => Promise<void>;
  appendOlderConversations: (older: Conversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  getConversation: (id: string) => Conversation | undefined;
  createConversation: (recipientEmail: string) => Promise<Conversation>;
  updateConversationPreview: (conversationId: string, lastMessage: LastMessage, unreadDelta?: number) => void;
  markConversationAsReadLocally: (conversationId: string) => void;
}

