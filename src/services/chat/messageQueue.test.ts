import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { secureStorage } from '../storage/secureStore.ts';
import { messageQueue, MessageQueue, type QueuedMessage } from './messageQueue.ts';

describe('MessageQueue - Offline Persistence & Storage Isolation (Stage 6)', () => {
  const userA = 'user-uuid-1111';
  const userB = 'user-uuid-2222';
  const conv1 = 'conv-uuid-aaaa';
  const conv2 = 'conv-uuid-bbbb';

  beforeEach(() => {
    secureStorage._resetForTesting();
    messageQueue._resetForTesting();
  });

  afterEach(() => {
    secureStorage._resetForTesting();
    messageQueue._resetForTesting();
  });

  it('1. Pending message is saved successfully and retrieved in order', async () => {
    const msg1: QueuedMessage = {
      id: 'mut-1',
      clientMutationId: 'mut-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'First message',
      createdAt: '2026-11-10T10:00:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    const msg2: QueuedMessage = {
      id: 'mut-2',
      clientMutationId: 'mut-2',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Second message',
      createdAt: '2026-11-10T10:01:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    await messageQueue.enqueue(msg1);
    await messageQueue.enqueue(msg2);

    const queue = await messageQueue.getQueue(userA);
    assert.strictEqual(queue.length, 2);
    assert.strictEqual(queue[0].clientMutationId, 'mut-1');
    assert.strictEqual(queue[0].content, 'First message');
    assert.strictEqual(queue[1].clientMutationId, 'mut-2');
    assert.strictEqual(queue[1].content, 'Second message');
  });

  it('2. Pending message is restored after simulated app restart (new queue instance)', async () => {
    const msg: QueuedMessage = {
      id: 'mut-restart-1',
      clientMutationId: 'mut-restart-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Message across restart',
      createdAt: '2026-11-10T12:00:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    // Save with primary queue
    await messageQueue.enqueue(msg);

    // Simulate app restart: create a brand new MessageQueue instance with clean memory
    const restartedQueue = new MessageQueue();
    const restored = await restartedQueue.getQueue(userA);

    assert.strictEqual(restored.length, 1);
    assert.strictEqual(restored[0].clientMutationId, 'mut-restart-1');
    assert.strictEqual(restored[0].content, 'Message across restart');
    assert.strictEqual(restored[0].localStatus, 'pending');
  });

  it('3. Duplicate queue insertion is prevented (updates existing record without duplicate index)', async () => {
    const msg1: QueuedMessage = {
      id: 'mut-dup-1',
      clientMutationId: 'mut-dup-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Original content',
      createdAt: '2026-11-10T10:00:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    const msgUpdated: QueuedMessage = {
      ...msg1,
      content: 'Updated content',
      localStatus: 'sending',
    };

    await messageQueue.enqueue(msg1);
    await messageQueue.enqueue(msgUpdated);

    const queue = await messageQueue.getQueue(userA);
    assert.strictEqual(queue.length, 1, 'Index must contain exactly 1 entry for mut-dup-1');
    assert.strictEqual(queue[0].content, 'Updated content');
    assert.strictEqual(queue[0].localStatus, 'sending');
  });

  it('4. Dequeue removes message from index and deletes storage record', async () => {
    const msg: QueuedMessage = {
      id: 'mut-del-1',
      clientMutationId: 'mut-del-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'To be dequeued',
      createdAt: '2026-11-10T10:00:00.000Z',
      localStatus: 'sent',
      retryCount: 0,
    };

    await messageQueue.enqueue(msg);
    let queue = await messageQueue.getQueue(userA);
    assert.strictEqual(queue.length, 1);

    await messageQueue.dequeue(userA, 'mut-del-1');
    queue = await messageQueue.getQueue(userA);
    assert.strictEqual(queue.length, 0);

    const fetched = await messageQueue.getMessage(userA, 'mut-del-1');
    assert.strictEqual(fetched, null);
  });

  it('5. updateStatus updates status, error, and increments retryCount on failure', async () => {
    const msg: QueuedMessage = {
      id: 'mut-fail-1',
      clientMutationId: 'mut-fail-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Message failing',
      createdAt: '2026-11-10T10:00:00.000Z',
      localStatus: 'sending',
      retryCount: 0,
    };

    await messageQueue.enqueue(msg);
    await messageQueue.updateStatus(userA, 'mut-fail-1', 'failed', 'Network timeout');

    const updated = await messageQueue.getMessage(userA, 'mut-fail-1');
    assert.ok(updated);
    assert.strictEqual(updated.localStatus, 'failed');
    assert.strictEqual(updated.lastError, 'Network timeout');
    assert.strictEqual(updated.retryCount, 1);
    assert.ok(updated.lastAttemptAt);
  });

  it('6. Strict Account Isolation: User A and User B queues are completely partitioned', async () => {
    const msgA: QueuedMessage = {
      id: 'mut-A-1',
      clientMutationId: 'mut-A-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Private A message',
      createdAt: '2026-11-10T10:00:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    const msgB: QueuedMessage = {
      id: 'mut-B-1',
      clientMutationId: 'mut-B-1',
      conversationId: conv2,
      senderId: userB,
      type: 'TEXT',
      content: 'Private B message',
      createdAt: '2026-11-10T10:05:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    await messageQueue.enqueue(msgA);
    await messageQueue.enqueue(msgB);

    // Verify User A only sees A
    const queueA = await messageQueue.getQueue(userA);
    assert.strictEqual(queueA.length, 1);
    assert.strictEqual(queueA[0].clientMutationId, 'mut-A-1');
    assert.strictEqual(queueA[0].senderId, userA);

    // Verify User B only sees B
    const queueB = await messageQueue.getQueue(userB);
    assert.strictEqual(queueB.length, 1);
    assert.strictEqual(queueB[0].clientMutationId, 'mut-B-1');
    assert.strictEqual(queueB[0].senderId, userB);

    // Clearing User A leaves User B intact
    await messageQueue.clearQueueForUser(userA);
    const afterClearA = await messageQueue.getQueue(userA);
    const afterClearB = await messageQueue.getQueue(userB);

    assert.strictEqual(afterClearA.length, 0);
    assert.strictEqual(afterClearB.length, 1);
    assert.strictEqual(afterClearB[0].clientMutationId, 'mut-B-1');
  });

  it('7. getQueueForConversation filters by conversationId', async () => {
    const msgConv1: QueuedMessage = {
      id: 'mut-c1',
      clientMutationId: 'mut-c1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'In Conv 1',
      createdAt: '2026-11-10T10:00:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    const msgConv2: QueuedMessage = {
      id: 'mut-c2',
      clientMutationId: 'mut-c2',
      conversationId: conv2,
      senderId: userA,
      type: 'TEXT',
      content: 'In Conv 2',
      createdAt: '2026-11-10T10:01:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };

    await messageQueue.enqueue(msgConv1);
    await messageQueue.enqueue(msgConv2);

    const filtered = await messageQueue.getQueueForConversation(userA, conv1);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].conversationId, conv1);
    assert.strictEqual(filtered[0].clientMutationId, 'mut-c1');
  });

  it('8. Concurrent queue operations execute safely via user-scoped mutex', async () => {
    // Concurrently enqueue 5 messages for userA
    const promises = Array.from({ length: 5 }, (_, i) => {
      const msg: QueuedMessage = {
        id: `mut-concurrent-${i}`,
        clientMutationId: `mut-concurrent-${i}`,
        conversationId: conv1,
        senderId: userA,
        type: 'TEXT',
        content: `Concurrent ${i}`,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
        localStatus: 'pending',
        retryCount: 0,
      };
      return messageQueue.enqueue(msg);
    });

    await Promise.all(promises);

    const queue = await messageQueue.getQueue(userA);
    assert.strictEqual(queue.length, 5, 'All 5 concurrent enqueues must be preserved without index corruption');
  });

  it('9. Storage failure handling: handles corrupt index JSON without crashing', async () => {
    // Write corrupt non-JSON to index key directly
    await secureStorage.setItem(`lovebyte_queue_index_${userA}`, 'invalid-json-content{');

    const queue = await messageQueue.getQueue(userA);
    assert.deepStrictEqual(queue, [], 'Corrupt index must safely return empty queue');

    // Subsequent enqueue should overwrite corrupt index cleanly
    const msg: QueuedMessage = {
      id: 'mut-recovery',
      clientMutationId: 'mut-recovery',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'Recovered message',
      createdAt: '2026-11-10T10:00:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };
    await messageQueue.enqueue(msg);

    const recoveredQueue = await messageQueue.getQueue(userA);
    assert.strictEqual(recoveredQueue.length, 1);
    assert.strictEqual(recoveredQueue[0].clientMutationId, 'mut-recovery');
  });

  it('10. Validation error on missing required fields', async () => {
    await assert.rejects(
      messageQueue.enqueue({
        id: '1',
        clientMutationId: '',
        conversationId: conv1,
        senderId: userA,
        type: 'TEXT',
        content: 'content',
        createdAt: '2026-11-10T10:00:00.000Z',
        localStatus: 'pending',
        retryCount: 0,
      }),
      /clientMutationId/
    );

    await assert.rejects(
      messageQueue.enqueue({
        id: '1',
        clientMutationId: 'mut-1',
        conversationId: '',
        senderId: userA,
        type: 'TEXT',
        content: 'content',
        createdAt: '2026-11-10T10:00:00.000Z',
        localStatus: 'pending',
        retryCount: 0,
      }),
      /conversationId/
    );

    await assert.rejects(
      messageQueue.enqueue({
        id: '1',
        clientMutationId: 'mut-1',
        conversationId: conv1,
        senderId: '',
        type: 'TEXT',
        content: 'content',
        createdAt: '2026-11-10T10:00:00.000Z',
        localStatus: 'pending',
        retryCount: 0,
      }),
      /senderId/
    );

    await assert.rejects(
      messageQueue.enqueue({
        id: '1',
        clientMutationId: 'mut-1',
        conversationId: conv1,
        senderId: userA,
        type: 'TEXT',
        content: '   ',
        createdAt: '2026-11-10T10:00:00.000Z',
        localStatus: 'pending',
        retryCount: 0,
      }),
      /content/
    );
  });

  it('11. Opportunistic index compaction (FINDING-03): Stale orphaned index entries are pruned and compacted on getQueue', async () => {
    const msg: QueuedMessage = {
      id: 'mut-valid-1',
      clientMutationId: 'mut-valid-1',
      conversationId: conv1,
      senderId: userA,
      type: 'TEXT',
      content: 'I have a real record',
      createdAt: '2026-11-10T10:00:00.000Z',
      localStatus: 'pending',
      retryCount: 0,
    };
    await messageQueue.enqueue(msg);

    // Manually inject an orphaned mutation ID into the user's index key
    const indexKey = `lovebyte_queue_index_${userA}`;
    const rawIndex = await secureStorage.getItem(indexKey);
    const index = JSON.parse(rawIndex!);
    index.push('mut-orphaned-ghost');
    await secureStorage.setItem(indexKey, JSON.stringify(index));

    // Verify index has 2 entries before getQueue
    const rawBefore = JSON.parse((await secureStorage.getItem(indexKey))!);
    assert.strictEqual(rawBefore.length, 2);
    assert.ok(rawBefore.includes('mut-orphaned-ghost'));

    // Call getQueue: should return 1 message AND rewrite compacted index
    const queue = await messageQueue.getQueue(userA);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].clientMutationId, 'mut-valid-1');

    // Verify the index was pruned/compacted in storage
    const rawAfter = JSON.parse((await secureStorage.getItem(indexKey))!);
    assert.strictEqual(rawAfter.length, 1);
    assert.strictEqual(rawAfter[0], 'mut-valid-1');
    assert.strictEqual(rawAfter.includes('mut-orphaned-ghost'), false, 'Orphaned entry must be pruned');
  });
});

