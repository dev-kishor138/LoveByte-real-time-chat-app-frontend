import { sessionManager, type SessionEvent } from '../auth/sessionManager.ts';
import { socketClient, type SocketConnectionState } from '../socket/socketClient.ts';
import { chatApi } from '../api/chat.ts';
import type { Message } from '../api/types.ts';
import { messageQueue, type QueuedMessage } from './messageQueue.ts';
import { classifySendError } from '../../context/chatReducers.ts';
import type { MessageDeliveryStatus } from '../../context/chatTypes.ts';

export type QueueProcessorEventType =
  | 'MESSAGE_SENT'
  | 'MESSAGE_FAILED'
  | 'MESSAGE_RECONCILED'
  | 'MESSAGE_STATUS_CHANGED';

export interface QueueProcessorEvent {
  type: QueueProcessorEventType;
  clientMutationId: string;
  conversationId: string;
  serverMessage?: Message;
  status?: MessageDeliveryStatus;
  error?: string;
}

export type QueueProcessorListener = (event: QueueProcessorEvent) => void;

/**
 * Maximum automatic retry attempts for uncertain messages during reconnect/background sync.
 * Prevents indefinite head-of-line blocking in conversation queues.
 */
export const MAX_AUTOMATIC_RETRIES = 5;

/**
 * QueueProcessor
 * Coordinates persistent message sending, offline queuing, and reconnect reconciliation.
 *
 * Guarantees:
 * 1. Account Isolation: strictly binds to current authenticated userId; halts on logout.
 * 2. Deterministic Order: processes messages sequentially per conversation [createdAt ASC].
 * 3. Concurrency Protection: inFlightMutations prevents duplicate network requests for the same mutation.
 * 4. Idempotency Preservation: strictly reuses clientMutationId without regenerating.
 * 5. Safe Reconciliation: reconciles uncertain messages against server history before re-sending.
 * 6. Bounded Backoff: respects 429 rate limits and halts auto-retry on 4xx client errors.
 */
export class QueueProcessor {
  private inFlightMutations = new Set<string>();
  private conversationLocks = new Map<string, Promise<void>>();
  private listeners = new Set<QueueProcessorListener>();
  private unsubscribeSession: (() => void) | null = null;
  private unsubscribeSocket: (() => void) | null = null;
  private isStarted: boolean = false;
  private rateLimitBackoffUntil = new Map<string, number>(); // conversationId -> timestamp ms

  constructor() {
    this.start();
  }

  /**
   * Initializes listeners to SessionManager and SocketClient.
   */
  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    this.unsubscribeSession = sessionManager.subscribe((event: SessionEvent) => {
      if (event.type === 'UNAUTHENTICATED') {
        this.handleLogout();
      } else if (event.type === 'AUTHENTICATED' || event.type === 'TOKEN_REFRESHED') {
        this.processAllQueues().catch(() => {});
      }
    });

    this.unsubscribeSocket = socketClient.subscribeState((state: SocketConnectionState) => {
      if (state === 'connected') {
        this.processAllQueues().catch(() => {});
      }
    });
  }

  /**
   * Stops listeners and halts in-flight processing on shutdown.
   */
  stop(): void {
    if (!this.isStarted) return;
    this.isStarted = false;
    if (this.unsubscribeSession) {
      this.unsubscribeSession();
      this.unsubscribeSession = null;
    }
    if (this.unsubscribeSocket) {
      this.unsubscribeSocket();
      this.unsubscribeSocket = null;
    }
    this.inFlightMutations.clear();
    this.conversationLocks.clear();
    this.rateLimitBackoffUntil.clear();
  }

  /**
   * Subscribes to queue processing events.
   */
  subscribe(listener: QueueProcessorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(event: QueueProcessorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[QueueProcessor] Listener error:', err);
      }
    }
  }

  private handleLogout(): void {
    this.inFlightMutations.clear();
    this.conversationLocks.clear();
    this.rateLimitBackoffUntil.clear();
  }

  /**
   * Triggers processing of all queued messages across all conversations for the authenticated user.
   */
  async processAllQueues(): Promise<void> {
    const user = sessionManager.getUser();
    if (!user || !sessionManager.isAuthenticated()) {
      return;
    }

    const userId = user.id;
    const allMessages = await messageQueue.getQueue(userId);
    if (allMessages.length === 0) return;

    // Group by conversation
    const byConversation = new Map<string, QueuedMessage[]>();
    for (const msg of allMessages) {
      const list = byConversation.get(msg.conversationId) || [];
      list.push(msg);
      byConversation.set(msg.conversationId, list);
    }

    // Process conversations in parallel, but messages within each conversation sequentially
    const promises: Promise<void>[] = [];
    for (const [convId] of byConversation) {
      promises.push(this.processConversationQueue(convId));
    }
    await Promise.all(promises);
  }

  /**
   * Processes queued messages for a specific conversation sequentially.
   */
  async processConversationQueue(conversationId: string): Promise<void> {
    const user = sessionManager.getUser();
    if (!user || !sessionManager.isAuthenticated()) {
      return;
    }

    const userId = user.id;

    // Sequential conversation lock: queue behind existing in-progress processing for this conversation
    const prevLock = this.conversationLocks.get(conversationId) || Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.conversationLocks.set(conversationId, currentLock);

    try {
      await prevLock;
      await this.runSequentialConversationProcess(userId, conversationId);
    } finally {
      releaseLock();
      if (this.conversationLocks.get(conversationId) === currentLock) {
        this.conversationLocks.delete(conversationId);
      }
    }
  }

  private async runSequentialConversationProcess(userId: string, conversationId: string): Promise<void> {
    // Check rate limit backoff
    const backoffUntil = this.rateLimitBackoffUntil.get(conversationId) || 0;
    if (Date.now() < backoffUntil) {
      return;
    }

    const messages = await messageQueue.getQueueForConversation(userId, conversationId);
    if (messages.length === 0) return;

    for (const msg of messages) {
      // Re-verify authentication state and active user before each message
      const currentUser = sessionManager.getUser();
      if (!currentUser || currentUser.id !== userId || !sessionManager.isAuthenticated()) {
        break;
      }

      // Skip non-retryable definitive failures (4xx) unless manually retried
      if (msg.localStatus === 'failed') {
        continue;
      }

      // Bounded automatic retry threshold (FINDING-02):
      // If an uncertain message has exhausted automatic retries, transition it to 'failed'
      // so subsequent messages in this conversation are unblocked from head-of-line blocking.
      // The user can still manually retry this message using the original clientMutationId.
      if (msg.localStatus === 'uncertain' && (msg.retryCount || 0) >= MAX_AUTOMATIC_RETRIES) {
        const errorMsg = 'Delivery unconfirmed after multiple attempts. Manual retry required.';
        await messageQueue.updateStatus(userId, msg.clientMutationId, 'failed', errorMsg);
        this.notify({
          type: 'MESSAGE_FAILED',
          clientMutationId: msg.clientMutationId,
          conversationId: msg.conversationId,
          status: 'failed',
          error: errorMsg,
        });
        continue;
      }

      // Attempt sending the message
      const result = await this.sendSingleQueuedMessage(userId, msg);
      if (!result.success) {
        // Stop processing subsequent messages in this conversation if an error occurred
        // (preserves chronological FIFO ordering)
        break;
      }
    }
  }

  /**
   * Sends or retries a single queued message with idempotency and reconciliation.
   */
  async processMessage(msg: QueuedMessage): Promise<Message | null> {
    const user = sessionManager.getUser();
    if (!user || !sessionManager.isAuthenticated()) {
      throw new Error('[QueueProcessor] Cannot process message without authenticated session');
    }

    if (user.id !== msg.senderId) {
      throw new Error('[QueueProcessor] Security violation: cannot process message belonging to another user');
    }

    const result = await this.sendSingleQueuedMessage(user.id, msg);
    if (result.success && result.serverMessage) {
      return result.serverMessage;
    }
    if (result.error) {
      throw result.error;
    }
    return null;
  }

  private async sendSingleQueuedMessage(
    userId: string,
    msg: QueuedMessage
  ): Promise<{ success: boolean; serverMessage?: Message; error?: any }> {
    const mutationId = msg.clientMutationId;

    // Concurrency guard: if mutation is already in-flight, skip
    if (this.inFlightMutations.has(mutationId)) {
      return { success: false };
    }

    this.inFlightMutations.add(mutationId);
    const opGen = sessionManager.getGenerationId();

    try {
      // 1. Reconciliation step for 'uncertain' status or unconfirmed retries:
      // Check if message is already committed on server before attempting re-send
      if (msg.localStatus === 'uncertain' || (msg.retryCount && msg.retryCount > 0)) {
        try {
          const recent = await chatApi.getMessages(msg.conversationId, { limit: 50 });
          if (opGen !== sessionManager.getGenerationId()) {
            return { success: false };
          }

          const existingMatch = recent.find((m) => m.clientMutationId === mutationId);
          if (existingMatch) {
            // Already persisted on server! Dequeue and notify
            await messageQueue.dequeue(userId, mutationId);
            this.notify({
              type: 'MESSAGE_RECONCILED',
              clientMutationId: mutationId,
              conversationId: msg.conversationId,
              serverMessage: existingMatch,
            });
            return { success: true, serverMessage: existingMatch };
          }
        } catch {
          // If checking history fails (e.g. offline), continue with send attempt below
        }
      }

      // 2. Mark status as 'sending' in queue and notify listeners
      await messageQueue.updateStatus(userId, mutationId, 'sending');
      this.notify({
        type: 'MESSAGE_STATUS_CHANGED',
        clientMutationId: mutationId,
        conversationId: msg.conversationId,
        status: 'sending',
      });

      // 3. Perform network send reusing stable clientMutationId
      const serverMessage = await chatApi.sendMessage({
        conversationId: msg.conversationId,
        content: msg.content,
        clientMutationId: mutationId,
      });

      // Session generation guard: discard if session changed during I/O
      if (opGen !== sessionManager.getGenerationId()) {
        return { success: false };
      }

      // 4. Success: Dequeue from storage and notify listeners
      await messageQueue.dequeue(userId, mutationId);
      this.notify({
        type: 'MESSAGE_SENT',
        clientMutationId: mutationId,
        conversationId: msg.conversationId,
        serverMessage,
      });

      return { success: true, serverMessage };
    } catch (err: any) {
      if (opGen !== sessionManager.getGenerationId()) {
        return { success: false, error: err };
      }

      const classified = classifySendError(err);
      const statusCode = err?.statusCode ?? err?.response?.status;

      if (statusCode === 429) {
        // Bounded backoff: back off 5 seconds for this conversation
        this.rateLimitBackoffUntil.set(msg.conversationId, Date.now() + 5000);
      }

      await messageQueue.updateStatus(userId, mutationId, classified.status, classified.errorMessage);
      this.notify({
        type: 'MESSAGE_FAILED',
        clientMutationId: mutationId,
        conversationId: msg.conversationId,
        status: classified.status,
        error: classified.errorMessage,
      });

      return { success: false, error: err };
    } finally {
      this.inFlightMutations.delete(mutationId);
    }
  }

  /**
   * Resets internal state for testing.
   */
  _resetForTesting(): void {
    this.inFlightMutations.clear();
    this.conversationLocks.clear();
    this.rateLimitBackoffUntil.clear();
    this.listeners.clear();
  }
}

export const queueProcessor = new QueueProcessor();

