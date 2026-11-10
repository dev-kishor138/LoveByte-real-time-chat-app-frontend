import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { queueProcessor, QueueProcessor, type QueueProcessorEvent } from './queueProcessor.ts';
import { messageQueue, type QueuedMessage } from './messageQueue.ts';
import { secureStorage } from '../storage/secureStore.ts';
import { sessionManager } from '../auth/sessionManager.ts';
import { authApi } from '../api/auth.ts';
import { chatApi } from '../api/chat.ts';
import type { Message } from '../api/types.ts';

describe('QueueProcessor - Controlled Processing & Reconciliation (Stage 6)', () => {
  const userA = 'user-uuid-1111';
  const userB = 'user-uuid-2222';
  const conv1 = 'conv-uuid-aaaa';

  const originalSendMessage = chatApi.sendMessage;
  const originalGetMessages = chatApi.getMessages;
  const originalLogout = authApi.logout;

  beforeEach(() => {
    secureStorage._resetForTesting();
    messageQueue._resetForTesting();
    queueProcessor._resetForTesting();
    sessionManager._resetForTesting();
    authApi.logout = async () => ({ message: 'Logged out successfully' });

    // Authenticate userA in sessionManager
    (sessionManager as any).inMemoryAccessToken = 'valid-token';
    (sessionManager as any).currentUser = {
      id: userA,
      email: 'usera@gmail.com',
      createdAt: '2026-11-10T00:00:00Z',
    };
  });

  afterEach(() => {
    chatApi.sendMessage = originalSendMessage;
    chatApi.getMessages = originalGetMessages;
    authApi.logout = originalLogout;
    secureStorage._resetForTesting();
    messageQueue._resetForTesting();
    queueProcessor._resetForTesting();
    sessionManager._resetForTesting();
  });

  it('1. Does not process queue when unauthenticated', async () => {
    (sessionManager as any).inMemoryAccessToken = null;
    (sessionManager as any).currentUser = null;

    let sendCalled = false;
    chatApi.sendMessage = async () => {
      sendCalled = true;
      throw new Error('Should not be called');
    };

    const msg: QueuedMessage = {
      id: 'mut-unauth',
      clientMutationId: 'mut-unauth',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Hello unauthenticated',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };
    await messageQueue.enqueue(msg);

    await queueProcessor.processAllQueues();
    assert.strictEqual(sendCalled, false, 'Send must not be called when unauthenticated');
  });

  it('2. Processes conversation messages in deterministic sequential order [createdAt ASC]', async () => {
    const callOrder: string[] = [];

    const msg1: QueuedMessage = {
      id: 'mut-seq-1',
      clientMutationId: 'mut-seq-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'First in sequence',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    const msg2: QueuedMessage = {
      id: 'mut-seq-2',
      clientMutationId: 'mut-seq-2',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Second in sequence',
      createdAt: '2026-11-10T10:01:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    await messageQueue.enqueue(msg2); // Enqueue msg2 first
    await messageQueue.enqueue(msg1); // Enqueue msg1 second

    chatApi.sendMessage = async (payload) => {
      callOrder.push(payload.clientMutationId!);
      return {
        id: `canonical-${payload.clientMutationId}`,
        conversationId: payload.conversationId,
        senderId: userA,
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    };

    await queueProcessor.processConversationQueue(conv1);

    assert.deepStrictEqual(
      callOrder,
      ['mut-seq-1', 'mut-seq-2'],
      'Messages must be sent in strict ascending chronological order'
    );

    // Both dequeued from storage
    const remaining = await messageQueue.getQueue(userA);
    assert.strictEqual(remaining.length, 0);
  });

  it('3. Halts subsequent sends in conversation if first message fails (prevents out-of-order delivery)', async () => {
    const callOrder: string[] = [];

    const msg1: QueuedMessage = {
      id: 'mut-fail-1',
      clientMutationId: 'mut-fail-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Failing first message',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    const msg2: QueuedMessage = {
      id: 'mut-after-1',
      clientMutationId: 'mut-after-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Should wait behind first message',
      createdAt: '2026-11-10T10:01:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    await messageQueue.enqueue(msg1);
    await messageQueue.enqueue(msg2);

    chatApi.sendMessage = async (payload) => {
      callOrder.push(payload.clientMutationId!);
      if (payload.clientMutationId === 'mut-fail-1') {
        const err: any = new Error('Gateway Timeout');
        err.statusCode = 504;
        throw err;
      }
      return {} as any;
    };

    await queueProcessor.processConversationQueue(conv1);

    assert.deepStrictEqual(callOrder, ['mut-fail-1']);
    // msg1 marked as uncertain, msg2 remains pending
    const remaining = await messageQueue.getQueue(userA);
    assert.strictEqual(remaining.length, 2);
    assert.strictEqual(remaining[0].clientMutationId, 'mut-fail-1');
    assert.strictEqual(remaining[0].localStatus, 'uncertain');
    assert.strictEqual(remaining[1].clientMutationId, 'mut-after-1');
    assert.strictEqual(remaining[1].localStatus, 'pending');
  });

  it('4. Reconciles uncertain message with server history before sending (avoids duplicate POST)', async () => {
    let postCalled = false;
    let getMessagesCalled = false;

    const msg: QueuedMessage = {
      id: 'mut-uncertain-1',
      clientMutationId: 'mut-uncertain-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Uncertain message',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'uncertain',
      retryCount: 1,
    };

    await messageQueue.enqueue(msg);

    // Mock getMessages to return the message as already existing on the server
    chatApi.getMessages = async () => {
      getMessagesCalled = true;
      return [
        {
          id: 'canonical-msg-id-123',
          conversationId: conv1,
          senderId: userA,
          type: 'TEXT',
          content: 'Uncertain message',
          clientMutationId: 'mut-uncertain-1',
          fileKey: null,
          fileMime: null,
          fileSize: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          readAt: null,
          createdAt: '2026-11-10T10:00:05Z',
          updatedAt: '2026-11-10T10:00:05Z',
        },
      ];
    };

    chatApi.sendMessage = async () => {
      postCalled = true;
      throw new Error('Should not post when server already has message');
    };

    const events: QueueProcessorEvent[] = [];
    queueProcessor.subscribe((e) => events.push(e));

    await queueProcessor.processConversationQueue(conv1);

    assert.strictEqual(getMessagesCalled, true, 'getMessages must be called to check history');
    assert.strictEqual(postCalled, false, 'POST must NOT be called because message was already committed');

    // Dequeued and event emitted
    const remaining = await messageQueue.getQueue(userA);
    assert.strictEqual(remaining.length, 0);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'MESSAGE_RECONCILED');
    assert.strictEqual(events[0].serverMessage?.id, 'canonical-msg-id-123');
  });

  it('5. Concurrency protection: inFlightMutations prevents overlapping sends of same mutation', async () => {
    let resolveSlowSend!: (msg: Message) => void;
    const slowSendGate = new Promise<Message>((resolve) => {
      resolveSlowSend = resolve;
    });

    let sendCallCount = 0;
    chatApi.sendMessage = async (payload) => {
      sendCallCount++;
      return slowSendGate;
    };

    const msg: QueuedMessage = {
      id: 'mut-concurrent-1',
      clientMutationId: 'mut-concurrent-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Slow send message',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };
    await messageQueue.enqueue(msg);

    // Call processMessage twice simultaneously
    const p1 = queueProcessor.processMessage(msg);
    const p2 = queueProcessor.processMessage(msg);

    // Yield to event loop to allow messageQueue.updateStatus to settle
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(sendCallCount, 1, 'Only 1 network call must be initiated');

    resolveSlowSend({
      id: 'canonical-concurrent',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Slow send message',
      clientMutationId: 'mut-concurrent-1',
      fileKey: null,
      fileMime: null,
      fileSize: null,
      isEdited: false,
      editedAt: null,
      isDeleted: false,
      readAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const [res1, res2] = await Promise.all([p1, p2]);
    assert.ok(res1);
    assert.strictEqual(res2, null, 'Second concurrent call must be safely ignored');
  });

  it('6. Account Isolation: Reject processing a message belonging to another user', async () => {
    const msgAnotherUser: QueuedMessage = {
      id: 'mut-b-1',
      clientMutationId: 'mut-b-1',
      conversationId: conv1,
      senderId: userB, // belongs to userB, while session is userA
      type: 'TEXT',
      content: 'Malicious spoof attempt',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    await assert.rejects(
      queueProcessor.processMessage(msgAnotherUser),
      /Security violation/
    );
  });

  it('7. Discards response if session changed/logged out during network flight', async () => {
    let resolveSend!: (msg: Message) => void;
    const sendGate = new Promise<Message>((resolve) => {
      resolveSend = resolve;
    });

    chatApi.sendMessage = async () => sendGate;

    const msg: QueuedMessage = {
      id: 'mut-session-switch',
      clientMutationId: 'mut-session-switch',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Sent before logout',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };
    await messageQueue.enqueue(msg);

    const pSend = queueProcessor.processMessage(msg);

    // User logs out while send is in flight: increments sessionGenerationId
    sessionManager.logout();

    // Network finishes late
    resolveSend({
      id: 'canonical-late',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Sent before logout',
      clientMutationId: 'mut-session-switch',
      fileKey: null,
      fileMime: null,
      fileSize: null,
      isEdited: false,
      editedAt: null,
      isDeleted: false,
      readAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await pSend;
    assert.strictEqual(result, null, 'Late response from previous session must be discarded');
  });

  it('8. Definitive 4xx client errors mark as failed without auto-retrying', async () => {
    const msg: QueuedMessage = {
      id: 'mut-400-bad',
      clientMutationId: 'mut-400-bad',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Malformed',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };
    await messageQueue.enqueue(msg);

    chatApi.sendMessage = async () => {
      const err: any = new Error('Bad Request: Invalid format');
      err.statusCode = 400;
      throw err;
    };

    await assert.rejects(queueProcessor.processMessage(msg), /Bad Request/);

    const queued = await messageQueue.getMessage(userA, 'mut-400-bad');
    assert.ok(queued);
    assert.strictEqual(queued.localStatus, 'failed');
    assert.strictEqual(queued.lastError, 'Bad Request: Invalid format');
  });

  it('9. Bounded automatic retry threshold (FINDING-02): Exhausted uncertain message transitions to failed and unblocks subsequent conversation messages', async () => {
    const events: QueueProcessorEvent[] = [];
    const unsub = queueProcessor.subscribe((e) => events.push(e));

    // Message 1: Previously failed 5 times (uncertain timeout)
    const msg1: QueuedMessage = {
      id: 'mut-unblock-1',
      clientMutationId: 'mut-unblock-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Stuck uncertain message',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'uncertain',
      retryCount: 5,
      lastError: 'Request timed out',
    };

    // Message 2: Pending new message in same conversation
    const msg2: QueuedMessage = {
      id: 'mut-unblock-2',
      clientMutationId: 'mut-unblock-2',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Subsequent message waiting in queue',
      createdAt: '2026-11-10T10:01:00Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    await messageQueue.enqueue(msg1);
    await messageQueue.enqueue(msg2);

    // Mock chatApi.sendMessage: only msg2 should be sent
    const sentMutations: string[] = [];
    chatApi.sendMessage = async (payload) => {
      sentMutations.push(payload.clientMutationId!);
      return {
        id: 'canonical-' + payload.clientMutationId,
        conversationId: payload.conversationId,
        senderId: userA,
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    };

    // Trigger sequential queue processing
    await queueProcessor.processConversationQueue(conv1);

    // 1. Verify msg1 was transitioned to 'failed' in storage
    const stored1 = await messageQueue.getMessage(userA, 'mut-unblock-1');
    assert.ok(stored1);
    assert.strictEqual(stored1.localStatus, 'failed');
    assert.ok(stored1.lastError?.includes('Delivery unconfirmed after multiple attempts'));

    // 2. Verify msg1 emitted MESSAGE_FAILED event
    const failedEvent = events.find((e) => e.clientMutationId === 'mut-unblock-1');
    assert.ok(failedEvent);
    assert.strictEqual(failedEvent.type, 'MESSAGE_FAILED');
    assert.strictEqual(failedEvent.status, 'failed');

    // 3. Verify msg2 was UNBLOCKED and successfully sent
    assert.deepStrictEqual(sentMutations, ['mut-unblock-2'], 'msg2 must be sent after msg1 transitions to failed');
    const stored2 = await messageQueue.getMessage(userA, 'mut-unblock-2');
    assert.strictEqual(stored2, null, 'msg2 must be dequeued upon successful send');

    const sentEvent = events.find((e) => e.clientMutationId === 'mut-unblock-2' && e.type === 'MESSAGE_SENT');
    assert.ok(sentEvent, 'msg2 must emit MESSAGE_SENT event');

    unsub();
  });

  it('10. Manual retry of exhausted message reuses original clientMutationId and reconciles safely', async () => {
    // Message that transitioned to failed after exhausting auto-retries
    const msg: QueuedMessage = {
      id: 'mut-manual-retry-1',
      clientMutationId: 'mut-manual-retry-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Manually retried content',
      createdAt: '2026-11-10T10:00:00Z',
      localStatus: 'failed',
      retryCount: 5,
      lastError: 'Delivery unconfirmed after multiple attempts. Manual retry required.',
    };
    await messageQueue.enqueue(msg);

    let sentMutationId: string | null = null;
    chatApi.sendMessage = async (payload) => {
      sentMutationId = payload.clientMutationId!;
      return {
        id: 'canonical-manual',
        conversationId: payload.conversationId,
        senderId: userA,
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    };

    // ChatApi.getMessages returns empty (not yet on server)
    chatApi.getMessages = async () => [];

    // User explicitly retries via processMessage
    const result = await queueProcessor.processMessage(msg);

    assert.ok(result);
    assert.strictEqual(result.id, 'canonical-manual');
    assert.strictEqual(sentMutationId, 'mut-manual-retry-1', 'Must strictly reuse original clientMutationId');

    // Verify it is now dequeued from storage
    const stored = await messageQueue.getMessage(userA, 'mut-manual-retry-1');
    assert.strictEqual(stored, null, 'Must be dequeued after successful manual retry');
  });
});
