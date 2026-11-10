import { secureStorage } from '../storage/secureStore.ts';
import type { MessageDeliveryStatus } from '../../context/chatTypes.ts';

export interface QueuedMessage {
  id: string; // tempId / clientMutationId
  clientMutationId: string;
  conversationId: string;
  senderId: string; // Authenticated user ID
  type: 'TEXT';
  content: string;
  createdAt: string; // ISO 8601 string
  localStatus: MessageDeliveryStatus;
  retryCount: number;
  lastError?: string;
  lastAttemptAt?: string;
}

function getIndexKey(userId: string): string {
  return `lovebyte_queue_index_${userId}`;
}

function getMessageKey(userId: string, clientMutationId: string): string {
  return `lovebyte_queue_msg_${userId}_${clientMutationId}`;
}

/**
 * MessageQueue
 * Persistent, hardware-backed offline outgoing message queue.
 * Guarantees:
 * 1. AES-256 hardware encryption at rest via SecureStore.
 * 2. Strict account isolation: records are partitioned per authenticated userId.
 * 3. Atomicity: user-scoped mutex serializes queue index and record mutations.
 * 4. Deterministic ordering: messages ordered by [createdAt ASC, id ASC].
 * 5. Stable mutation ID: preserves original Stage 5 clientMutationId.
 */
export class MessageQueue {
  private userLocks = new Map<string, Promise<any>>();

  private async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prevLock = this.userLocks.get(userId) || Promise.resolve();
    let resolveLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.userLocks.set(userId, currentLock);

    try {
      await prevLock;
      return await fn();
    } finally {
      resolveLock();
      if (this.userLocks.get(userId) === currentLock) {
        this.userLocks.delete(userId);
      }
    }
  }

  /**
   * Persists an outgoing message to the local queue.
   * If message already exists in queue, updates its content and metadata without duplicate index entry.
   */
  async enqueue(msg: QueuedMessage): Promise<void> {
    if (!msg.senderId || !msg.senderId.trim()) {
      throw new Error('[MessageQueue] Cannot enqueue message without valid senderId');
    }
    if (!msg.clientMutationId || !msg.clientMutationId.trim()) {
      throw new Error('[MessageQueue] Cannot enqueue message without valid clientMutationId');
    }
    if (!msg.conversationId || !msg.conversationId.trim()) {
      throw new Error('[MessageQueue] Cannot enqueue message without valid conversationId');
    }
    if (!msg.content || !msg.content.trim()) {
      throw new Error('[MessageQueue] Cannot enqueue message with empty content');
    }

    const userId = msg.senderId;

    return this.withUserLock(userId, async () => {
      const msgKey = getMessageKey(userId, msg.clientMutationId);
      const indexKey = getIndexKey(userId);

      // 1. Persist the individual message record
      await secureStorage.setItem(msgKey, JSON.stringify(msg));

      // 2. Read and update the user index
      let index: string[] = [];
      const rawIndex = await secureStorage.getItem(indexKey);
      if (rawIndex) {
        try {
          const parsed = JSON.parse(rawIndex);
          if (Array.isArray(parsed)) {
            index = parsed;
          }
        } catch {
          index = [];
        }
      }

      if (!index.includes(msg.clientMutationId)) {
        index.push(msg.clientMutationId);
        await secureStorage.setItem(indexKey, JSON.stringify(index));
      }
    });
  }

  /**
   * Removes a confirmed message from the queue by clientMutationId.
   */
  async dequeue(userId: string, clientMutationId: string): Promise<void> {
    if (!userId || !clientMutationId) return;

    return this.withUserLock(userId, async () => {
      const indexKey = getIndexKey(userId);
      const msgKey = getMessageKey(userId, clientMutationId);

      const rawIndex = await secureStorage.getItem(indexKey);
      if (rawIndex) {
        try {
          const parsed = JSON.parse(rawIndex);
          if (Array.isArray(parsed)) {
            const updated = parsed.filter((id) => id !== clientMutationId);
            await secureStorage.setItem(indexKey, JSON.stringify(updated));
          }
        } catch {
          // If index is corrupt, safely rewrite empty array
          await secureStorage.setItem(indexKey, JSON.stringify([]));
        }
      }

      await secureStorage.deleteItem(msgKey);
    });
  }

  /**
   * Retrieves all queued messages for a user sorted in ascending chronological order.
   */
  async getQueue(userId: string): Promise<QueuedMessage[]> {
    if (!userId || !userId.trim()) return [];

    return this.withUserLock(userId, async () => {
      const indexKey = getIndexKey(userId);
      const rawIndex = await secureStorage.getItem(indexKey);
      if (!rawIndex) return [];

      let index: string[] = [];
      try {
        const parsed = JSON.parse(rawIndex);
        if (Array.isArray(parsed)) {
          index = parsed;
        }
      } catch {
        return [];
      }

      const messages: QueuedMessage[] = [];
      const validIndex: string[] = [];
      for (const mutationId of index) {
        const msgKey = getMessageKey(userId, mutationId);
        const rawMsg = await secureStorage.getItem(msgKey);
        if (rawMsg) {
          try {
            const parsedMsg: QueuedMessage = JSON.parse(rawMsg);
            if (parsedMsg.clientMutationId && parsedMsg.conversationId) {
              messages.push(parsedMsg);
              validIndex.push(mutationId);
            }
          } catch {
            // Drop corrupted entry safely
          }
        }
      }

      // Opportunistic index compaction (FINDING-03):
      // If orphaned or corrupted index entries were detected, persist compacted index
      if (validIndex.length !== index.length) {
        try {
          await secureStorage.setItem(indexKey, JSON.stringify(validIndex));
        } catch {
          // Best effort compaction; does not block read
        }
      }

      // Sort deterministically: [createdAt ASC, id ASC]
      return messages.sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      });
    });
  }

  /**
   * Retrieves queued messages for a specific conversation of the authenticated user.
   */
  async getQueueForConversation(userId: string, conversationId: string): Promise<QueuedMessage[]> {
    if (!userId || !conversationId) return [];
    const all = await this.getQueue(userId);
    return all.filter((m) => m.conversationId === conversationId);
  }

  /**
   * Retrieves a single queued message by clientMutationId.
   */
  async getMessage(userId: string, clientMutationId: string): Promise<QueuedMessage | null> {
    if (!userId || !clientMutationId) return null;

    return this.withUserLock(userId, async () => {
      const msgKey = getMessageKey(userId, clientMutationId);
      const raw = await secureStorage.getItem(msgKey);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as QueuedMessage;
      } catch {
        return null;
      }
    });
  }

  /**
   * Updates delivery status, error, and retry metadata for a queued message.
   */
  async updateStatus(
    userId: string,
    clientMutationId: string,
    status: MessageDeliveryStatus,
    error?: string
  ): Promise<void> {
    if (!userId || !clientMutationId) return;

    return this.withUserLock(userId, async () => {
      const msgKey = getMessageKey(userId, clientMutationId);
      const raw = await secureStorage.getItem(msgKey);
      if (!raw) return;

      try {
        const msg: QueuedMessage = JSON.parse(raw);
        msg.localStatus = status;
        if (error !== undefined) {
          msg.lastError = error;
        }
        if (status === 'failed' || status === 'uncertain') {
          msg.retryCount = (msg.retryCount || 0) + 1;
        }
        msg.lastAttemptAt = new Date().toISOString();
        await secureStorage.setItem(msgKey, JSON.stringify(msg));
      } catch {
        // Drop unparseable update
      }
    });
  }

  /**
   * Clears the entire queue for a specific user (e.g. on account deletion or manual purge).
   */
  async clearQueueForUser(userId: string): Promise<void> {
    if (!userId) return;

    return this.withUserLock(userId, async () => {
      const indexKey = getIndexKey(userId);
      const rawIndex = await secureStorage.getItem(indexKey);
      if (rawIndex) {
        try {
          const parsed = JSON.parse(rawIndex);
          if (Array.isArray(parsed)) {
            for (const id of parsed) {
              await secureStorage.deleteItem(getMessageKey(userId, id));
            }
          }
        } catch {
          // Continue to delete index
        }
      }
      await secureStorage.deleteItem(indexKey);
    });
  }

  /**
   * Resets internal mutex locks for testing.
   */
  _resetForTesting(): void {
    this.userLocks.clear();
  }
}

export const messageQueue = new MessageQueue();

