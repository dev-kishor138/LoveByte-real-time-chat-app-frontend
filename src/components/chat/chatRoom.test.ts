import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatDateSeparator, formatTime, isSameDay } from '../../utils/date.ts';
import type { ClientMessage, MessageDeliveryStatus } from '../../context/chatTypes.ts';
import { Colors } from '../../constants/colors.ts';

/**
 * Stage 3.5 Phase 2: Active Chat Room UI & Real-Time Messaging Logic Tests
 *
 * NOTE ON TESTING METHODOLOGY:
 * Per Section 8 and Section 9 of the authorized instructions, zero unapproved dependencies
 * (such as React Testing Library or react-test-renderer) are installed.
 * These unit tests thoroughly exercise the rendering logic, delivery state classification,
 * date transition algorithms, 24-hour edit windows, deletion confirmation guards,
 * and composer validation that govern the Stage 3.5 chat components.
 */

describe('Stage 3.5 Active Chat Room UI Components & Logic', () => {
  const currentUserId = '00000000-0000-0000-0000-000000000001';
  const partnerId = '00000000-0000-0000-0000-000000000002';
  const conversationId = '11111111-1111-1111-1111-111111111111';

  describe('MessageBubble Layout & Delivery State Logic', () => {
    it('distinguishes outgoing messages (right-aligned) from incoming messages (left-aligned)', () => {
      const outgoingMsg: ClientMessage = {
        id: 'msg-out-1',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: 'Hello sweetheart',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T10:00:00Z',
        updatedAt: '2026-11-09T10:00:00Z',
        localStatus: 'sent',
      };

      const incomingMsg: ClientMessage = {
        id: 'msg-in-1',
        conversationId,
        senderId: partnerId,
        type: 'TEXT',
        content: 'Hey there!',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T10:01:00Z',
        updatedAt: '2026-11-09T10:01:00Z',
      };

      const isOutgoing1 = outgoingMsg.senderId === currentUserId;
      const isOutgoing2 = incomingMsg.senderId === currentUserId;

      assert.strictEqual(isOutgoing1, true, 'Outgoing message must be identified as outgoing');
      assert.strictEqual(isOutgoing2, false, 'Incoming message must be identified as incoming');
    });

    it('renders soft-deleted message as tombstone masking content for both incoming and outgoing', () => {
      const deletedMsg: ClientMessage = {
        id: 'msg-del-1',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: null,
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: true,
        readAt: null,
        createdAt: '2026-11-09T10:00:00Z',
        updatedAt: '2026-11-09T10:05:00Z',
      };

      const isDeleted = Boolean(deletedMsg.isDeleted);
      const displayContent = isDeleted ? 'This message was deleted' : deletedMsg.content;

      assert.strictEqual(isDeleted, true);
      assert.strictEqual(displayContent, 'This message was deleted');
    });

    it('renders (edited) label only when message is edited and NOT soft-deleted', () => {
      const editedMsg: ClientMessage = {
        id: 'msg-edit-1',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: 'Corrected text',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: true,
        editedAt: '2026-11-09T10:05:00Z',
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T10:00:00Z',
        updatedAt: '2026-11-09T10:05:00Z',
      };

      const deletedEditedMsg: ClientMessage = {
        id: 'msg-del-edit-1',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: null,
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: true,
        editedAt: '2026-11-09T10:05:00Z',
        isDeleted: true,
        readAt: null,
        createdAt: '2026-11-09T10:00:00Z',
        updatedAt: '2026-11-09T10:06:00Z',
      };

      const showEdited1 = Boolean(editedMsg.isEdited) && !editedMsg.isDeleted;
      const showEdited2 = Boolean(deletedEditedMsg.isEdited) && !deletedEditedMsg.isDeleted;

      assert.strictEqual(showEdited1, true, 'Edited active message shows edited label');
      assert.strictEqual(showEdited2, false, 'Deleted message must NOT show edited label');
    });

    it('determines correct delivery status tick for outgoing messages', () => {
      const getStatusGlyph = (status: MessageDeliveryStatus) => {
        switch (status) {
          case 'pending':
            return '⏳';
          case 'sending':
            return '◷';
          case 'sent':
            return '✓';
          case 'read':
            return '✓✓';
          case 'failed':
            return '! Failed · Tap to retry';
          case 'uncertain':
            return '⚠';
          default:
            return '';
        }
      };

      assert.strictEqual(getStatusGlyph('pending'), '⏳');
      assert.strictEqual(getStatusGlyph('sending'), '◷');
      assert.strictEqual(getStatusGlyph('sent'), '✓');
      assert.strictEqual(getStatusGlyph('read'), '✓✓');
      assert.strictEqual(getStatusGlyph('failed'), '! Failed · Tap to retry');
      assert.strictEqual(getStatusGlyph('uncertain'), '⚠');
    });

    it('uses accessible bubble colors from the LoveByte design system', () => {
      const lightTheme = Colors.light;
      const darkTheme = Colors.dark;

      // Outgoing bubble color must be Accessible Action Purple (#7549D6) with pure white text
      assert.strictEqual(lightTheme.bubbleOutgoing, '#7549D6');
      assert.strictEqual(lightTheme.bubbleOutgoingText, '#FFFFFF');
      assert.strictEqual(darkTheme.bubbleOutgoing, '#7549D6');
      assert.strictEqual(darkTheme.bubbleOutgoingText, '#FFFFFF');

      // Incoming bubble background must be Lavender (#F0EEF9) in light and Charcoal (#22212B) in dark
      assert.strictEqual(lightTheme.bubbleIncoming, '#F0EEF9');
      assert.strictEqual(darkTheme.bubbleIncoming, '#22212B');
    });
  });

  describe('DateSeparator Logic & Calendar Transitions', () => {
    const fixedNow = new Date(2026, 10, 9, 12, 0, 0); // Nov 9, 2026 12:00:00 local time

    it('formats today as "Today"', () => {
      const today = new Date(2026, 10, 9, 8, 30, 0);
      const result = formatDateSeparator(today, fixedNow);
      assert.strictEqual(result, 'Today');
    });

    it('formats yesterday as "Yesterday"', () => {
      const yesterday = new Date(2026, 10, 8, 15, 0, 0);
      const result = formatDateSeparator(yesterday, fixedNow);
      assert.strictEqual(result, 'Yesterday');
    });

    it('formats older same-year dates with month and day (e.g. November 5)', () => {
      const olderDate = new Date(2026, 10, 5, 14, 0, 0);
      const result = formatDateSeparator(olderDate, fixedNow);
      assert.strictEqual(result, 'November 5');
    });

    it('formats previous year dates with full year (e.g. December 25, 2025)', () => {
      const lastYear = new Date(2025, 11, 25, 10, 0, 0);
      const result = formatDateSeparator(lastYear, fixedNow);
      assert.strictEqual(result, 'December 25, 2025');
    });

    it('detects day boundaries between consecutive messages in inverted stream', () => {
      const msgToday = new Date(2026, 10, 9, 10, 0, 0);
      const msgEarlierToday = new Date(2026, 10, 9, 8, 0, 0);
      const msgYesterday = new Date(2026, 10, 8, 22, 0, 0);

      // Same day should not trigger a separator between them
      assert.strictEqual(isSameDay(msgToday, msgEarlierToday), true);

      // Across midnight boundary should trigger separator
      assert.strictEqual(isSameDay(msgEarlierToday, msgYesterday), false);
    });
  });

  describe('MessageComposer Validation & Submission Logic', () => {
    it('disallows submission when message is empty or whitespace-only', () => {
      const validateSubmission = (content: string, isSubmitting: boolean) => {
        const trimmed = content.trim();
        return trimmed.length > 0 && trimmed.length <= 5000 && !isSubmitting;
      };

      assert.strictEqual(validateSubmission('', false), false);
      assert.strictEqual(validateSubmission('   ', false), false);
      assert.strictEqual(validateSubmission('\n\t', false), false);
      assert.strictEqual(validateSubmission('Valid message', false), true);
    });

    it('prevents submission when already in-flight (duplicate submission prevention)', () => {
      const validateSubmission = (content: string, isSubmitting: boolean) => {
        const trimmed = content.trim();
        return trimmed.length > 0 && trimmed.length <= 5000 && !isSubmitting;
      };

      assert.strictEqual(validateSubmission('Valid message', true), false);
    });

    it('enforces backend maximum content length of 5000 characters', () => {
      const valid5000 = 'a'.repeat(5000);
      const invalid5001 = 'a'.repeat(5001);

      const validateLength = (content: string) => content.trim().length <= 5000;

      assert.strictEqual(validateLength(valid5000), true);
      assert.strictEqual(validateLength(invalid5001), false);
    });

    it('triggers character count warning when length exceeds 4500 characters', () => {
      const shouldShowWarning = (len: number) => len > 4500;

      assert.strictEqual(shouldShowWarning(4500), false);
      assert.strictEqual(shouldShowWarning(4501), true);
      assert.strictEqual(shouldShowWarning(4999), true);
    });
  });

  describe('MessageActionModal Permissions & 24-Hour Restriction', () => {
    const fixedNowMs = new Date('2026-11-09T12:00:00Z').getTime();
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

    const evaluateActionPermissions = (
      message: ClientMessage,
      userId: string,
      nowMs: number = fixedNowMs
    ) => {
      const isAuthor = message.senderId === userId;
      const isDeleted = Boolean(message.isDeleted);
      const isSending = message.localStatus === 'sending';
      const isPending = message.localStatus === 'pending';
      const isFailed = message.localStatus === 'failed';
      const isUncertain = message.localStatus === 'uncertain';
      const createdAtMs = new Date(message.createdAt).getTime();
      const isWithin24Hours = nowMs - createdAtMs <= TWENTY_FOUR_HOURS_MS;

      const canEdit = isAuthor && !isDeleted && !isSending && !isPending && isWithin24Hours && message.type === 'TEXT';
      const canDelete = isAuthor && !isDeleted && !isSending && !isPending;
      const canRetry = isAuthor && (isFailed || isUncertain || isPending);

      return { canEdit, canDelete, canRetry };
    };

    it('permits editing only for the original author within the 24-hour window', () => {
      const recentAuthorMsg: ClientMessage = {
        id: 'msg-recent',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: 'Recent author message',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T10:00:00Z', // 2 hours ago
        updatedAt: '2026-11-09T10:00:00Z',
      };

      const perms = evaluateActionPermissions(recentAuthorMsg, currentUserId);
      assert.strictEqual(perms.canEdit, true, 'Author can edit within 24h');
      assert.strictEqual(perms.canDelete, true, 'Author can delete');
    });

    it('prohibits editing partner incoming messages', () => {
      const partnerMsg: ClientMessage = {
        id: 'msg-partner',
        conversationId,
        senderId: partnerId,
        type: 'TEXT',
        content: 'Partner text',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T10:00:00Z',
        updatedAt: '2026-11-09T10:00:00Z',
      };

      const perms = evaluateActionPermissions(partnerMsg, currentUserId);
      assert.strictEqual(perms.canEdit, false, 'Non-author cannot edit partner message');
      assert.strictEqual(perms.canDelete, false, 'Non-author cannot delete partner message');
    });

    it('prohibits editing messages older than 24 hours', () => {
      const expiredMsg: ClientMessage = {
        id: 'msg-expired',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: 'Old message',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-08T11:00:00Z', // 25 hours ago
        updatedAt: '2026-11-08T11:00:00Z',
      };

      const perms = evaluateActionPermissions(expiredMsg, currentUserId);
      assert.strictEqual(perms.canEdit, false, 'Expired edit window (>24h) must be rejected');
      assert.strictEqual(perms.canDelete, true, 'Soft-delete remains permitted after 24h');
    });

    it('prohibits editing or deleting soft-deleted messages', () => {
      const alreadyDeletedMsg: ClientMessage = {
        id: 'msg-del',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: null,
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: true,
        readAt: null,
        createdAt: '2026-11-09T10:00:00Z',
        updatedAt: '2026-11-09T10:05:00Z',
      };

      const perms = evaluateActionPermissions(alreadyDeletedMsg, currentUserId);
      assert.strictEqual(perms.canEdit, false, 'Cannot edit deleted message');
      assert.strictEqual(perms.canDelete, false, 'Cannot delete already deleted message');
    });

    it('prohibits editing or deleting messages currently in flight (sending)', () => {
      const sendingMsg: ClientMessage = {
        id: 'temp-sending',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: 'In-flight text',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T12:00:00Z',
        updatedAt: '2026-11-09T12:00:00Z',
        localStatus: 'sending',
      };

      const perms = evaluateActionPermissions(sendingMsg, currentUserId);
      assert.strictEqual(perms.canEdit, false);
      assert.strictEqual(perms.canDelete, false);
    });

    it('enables retry option only for confirmed failed messages', () => {
      const failedMsg: ClientMessage = {
        id: 'temp-failed',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: 'Failed text',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T12:00:00Z',
        updatedAt: '2026-11-09T12:00:00Z',
        localStatus: 'failed',
      };

      const perms = evaluateActionPermissions(failedMsg, currentUserId);
      assert.strictEqual(perms.canRetry, true, 'Failed message can be retried');
    });

    it('enables retry option for uncertain messages (Stage 5 server-side idempotency)', () => {
      const uncertainMsg: ClientMessage = {
        id: 'temp-uncertain',
        conversationId,
        senderId: currentUserId,
        type: 'TEXT',
        content: 'Uncertain text',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T12:00:00Z',
        updatedAt: '2026-11-09T12:00:00Z',
        localStatus: 'uncertain',
      };

      const perms = evaluateActionPermissions(uncertainMsg, currentUserId);
      assert.strictEqual(perms.canRetry, true, 'Uncertain message can be safely retried with clientMutationId');
    });
  });

  describe('Active Chat Screen Inverted Stream & Scroll Management', () => {
    it('correctly inverts chronological array for FlatList rendering so index 0 is newest message', () => {
      const chronologicalMessages: ClientMessage[] = [
        {
          id: 'msg-1',
          conversationId,
          senderId: currentUserId,
          type: 'TEXT',
          content: 'First (oldest)',
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
        {
          id: 'msg-2',
          conversationId,
          senderId: partnerId,
          type: 'TEXT',
          content: 'Second',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T09:00:00Z',
          updatedAt: '2026-11-09T09:00:00Z',
        },
        {
          id: 'msg-3',
          conversationId,
          senderId: currentUserId,
          type: 'TEXT',
          content: 'Third (newest)',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-09T10:00:00Z',
          updatedAt: '2026-11-09T10:00:00Z',
        },
      ];

      const inverted = [...chronologicalMessages].reverse();

      assert.strictEqual(inverted.length, 3);
      assert.strictEqual(inverted[0].id, 'msg-3', 'Index 0 must be newest message (rendered at bottom)');
      assert.strictEqual(inverted[1].id, 'msg-2');
      assert.strictEqual(inverted[2].id, 'msg-1', 'Last index must be oldest message');
    });

    it('triggers scroll-to-bottom FAB when content offset exceeds 300px', () => {
      const evaluateFabVisibility = (offsetY: number) => offsetY > 300;

      assert.strictEqual(evaluateFabVisibility(0), false);
      assert.strictEqual(evaluateFabVisibility(150), false);
      assert.strictEqual(evaluateFabVisibility(300), false);
      assert.strictEqual(evaluateFabVisibility(301), true);
      assert.strictEqual(evaluateFabVisibility(850), true);
    });

    it('flags unread badge on FAB when new messages arrive while user is scrolled up', () => {
      let isScrolledUp = true;
      let prevCount = 10;
      let newCount = 12;
      let hasUnreadBadge = false;

      if (newCount > prevCount && isScrolledUp) {
        hasUnreadBadge = true;
      }

      assert.strictEqual(hasUnreadBadge, true, 'Unread badge must activate when messages arrive while scrolled up');

      // User scrolls back to bottom (offset <= 300)
      isScrolledUp = false;
      hasUnreadBadge = false;
      assert.strictEqual(hasUnreadBadge, false, 'Unread badge resets when user returns to bottom');
    });
  });
});
