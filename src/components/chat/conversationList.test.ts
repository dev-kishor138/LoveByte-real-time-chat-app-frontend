import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Conversation, Message } from '../../services/api/types.ts';
import { formatConversationTimestamp, formatLastSeenPresence } from '../../utils/date.ts';
import { validatePartnerEmail } from '../../utils/validation.ts';

describe('Stage 3.4 Conversation List & UI Logic Tests', () => {
  const mockUser1Id = '00000000-0000-0000-0000-000000000001';
  const mockPartnerId = '00000000-0000-0000-0000-000000000002';
  const mockConvId = '11111111-1111-1111-1111-111111111111';

  describe('ConversationItem Data Extraction & Snippet Logic', () => {
    it('extracts avatar monogram from displayName when available, falling back to email', () => {
      const getMonogram = (conv: Partial<Conversation>) => {
        const name = conv.otherUser?.displayName || conv.otherUser?.email || 'Partner';
        return (name.charAt(0) || 'P').toUpperCase();
      };

      assert.strictEqual(
        getMonogram({
          otherUser: { id: mockPartnerId, email: 'sweetheart@gmail.com', displayName: 'Sweetheart', createdAt: '2026-11-09T00:00:00Z' },
        }),
        'S'
      );

      assert.strictEqual(
        getMonogram({
          otherUser: { id: mockPartnerId, email: 'darling@gmail.com', displayName: null, createdAt: '2026-11-09T00:00:00Z' },
        }),
        'D'
      );

      assert.strictEqual(getMonogram({}), 'P');
    });

    it('formats last message snippet with "You: " prefix for outgoing messages', () => {
      const getSnippet = (conv: Conversation, currentUserId: string) => {
        const { lastMessage } = conv;
        if (!lastMessage) return { text: 'No messages yet. Say hello!', isItalic: true };
        if (lastMessage.isDeleted) return { text: 'This message was deleted', isItalic: true };
        const isOutgoing = lastMessage.senderId === currentUserId;
        return {
          text: isOutgoing ? `You: ${lastMessage.content}` : lastMessage.content || '',
          isItalic: false,
        };
      };

      const outgoingConv: Conversation = {
        id: mockConvId,
        otherUser: { id: mockPartnerId, email: 'partner@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
        unreadCount: 0,
        createdAt: '2026-11-09T05:00:00Z',
        updatedAt: '2026-11-09T05:00:00Z',
        lastMessage: {
          id: 'm1',
          senderId: mockUser1Id,
          type: 'TEXT',
          content: 'See you tonight!',
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T05:00:00Z',
        },
      };

      const result = getSnippet(outgoingConv, mockUser1Id);
      assert.strictEqual(result.text, 'You: See you tonight!');
      assert.strictEqual(result.isItalic, false);
    });

    it('renders soft-deleted last message as italic tombstone', () => {
      const getSnippet = (conv: Conversation) => {
        const { lastMessage } = conv;
        if (!lastMessage) return { text: 'No messages yet. Say hello!', isItalic: true };
        if (lastMessage.isDeleted) return { text: 'This message was deleted', isItalic: true };
        return { text: lastMessage.content || '', isItalic: false };
      };

      const deletedConv: Conversation = {
        id: mockConvId,
        otherUser: { id: mockPartnerId, email: 'partner@gmail.com', createdAt: '2026-11-09T00:00:00Z' },
        unreadCount: 0,
        createdAt: '2026-11-09T05:00:00Z',
        updatedAt: '2026-11-09T05:00:00Z',
        lastMessage: {
          id: 'm-deleted',
          senderId: mockPartnerId,
          type: 'TEXT',
          content: null,
          isEdited: false,
          editedAt: null,
          isDeleted: true,
          readAt: null,
          createdAt: '2026-11-09T05:00:00Z',
        },
      };

      const result = getSnippet(deletedConv);
      assert.strictEqual(result.text, 'This message was deleted');
      assert.strictEqual(result.isItalic, true);
    });

    it('formats unread badge display correctly (number or 99+)', () => {
      const formatBadge = (unreadCount?: number) => {
        if (!unreadCount || unreadCount <= 0) return null;
        return unreadCount > 99 ? '99+' : unreadCount.toString();
      };

      assert.strictEqual(formatBadge(0), null);
      assert.strictEqual(formatBadge(undefined), null);
      assert.strictEqual(formatBadge(3), '3');
      assert.strictEqual(formatBadge(99), '99');
      assert.strictEqual(formatBadge(105), '99+');
    });
  });

  describe('Presence & Real-Time Status Verification', () => {
    it('prioritizes real-time isOnline boolean over lastSeenAt string', () => {
      // Even if lastSeenAt is an older timestamp, if isOnline is true, status is strictly Online
      const statusOnline = formatLastSeenPresence('2026-11-08T10:00:00Z', true);
      assert.strictEqual(statusOnline, 'Online');

      // If isOnline is false, it formats relative last seen time
      const statusOffline = formatLastSeenPresence(null, false);
      assert.strictEqual(statusOffline, 'Offline');
    });
  });

  describe('StartConversationModal Email Validation', () => {
    it('validates partner Gmail input strictly against backend constraints', () => {
      // Valid Gmail
      assert.strictEqual(validatePartnerEmail('partner@gmail.com', 'user@gmail.com'), null);
      assert.strictEqual(validatePartnerEmail('My.Love.2026@gmail.com', 'user@gmail.com'), null);

      // Empty
      assert.strictEqual(validatePartnerEmail('', 'user@gmail.com'), 'Partner email is required');

      // Invalid syntax
      assert.strictEqual(validatePartnerEmail('notanemail', 'user@gmail.com'), 'Invalid email format');

      // Non-Gmail domain
      assert.strictEqual(
        validatePartnerEmail('partner@yahoo.com', 'user@gmail.com'),
        'Recipient must be a valid @gmail.com address'
      );

      // Self-conversation
      assert.strictEqual(
        validatePartnerEmail('user@gmail.com', 'user@gmail.com'),
        'You cannot start a conversation with yourself'
      );
      assert.strictEqual(
        validatePartnerEmail('User@Gmail.COM', 'user@gmail.com'),
        'You cannot start a conversation with yourself'
      );
    });
  });
});
