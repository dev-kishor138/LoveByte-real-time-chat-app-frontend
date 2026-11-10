import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  SocketClient,
  socketClient,
  type AppStateDriver,
  type AppStateStatus,
  type AppStateSubscription,
} from './socketClient.ts';
import { sessionManager } from '../auth/sessionManager.ts';
import { ENV } from '../../config/env.ts';
import { ApiError } from '../api/types.ts';
import type { Message } from '../api/types.ts';

class MockAppStateDriver implements AppStateDriver {
  public currentState: AppStateStatus = 'active';
  public listeners: Set<(state: AppStateStatus) => void> = new Set();

  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): AppStateSubscription {
    this.listeners.add(listener);
    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }

  setAppState(state: AppStateStatus): void {
    this.currentState = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

class MockSocket {
  public id: string = 'mock-socket-id-123';
  public connected: boolean = false;
  public auth: any;
  public url: string;
  public options: any;
  public listeners: Map<string, Function[]> = new Map();
  public emittedEvents: Array<{ event: string; payload: any; callback?: Function }> = [];
  public connectCallCount: number = 0;
  public disconnectCallCount: number = 0;
  public io: {
    listeners: Map<string, Function[]>;
    on: (event: string, fn: Function) => void;
    trigger: (event: string, ...args: any[]) => void;
  };

  constructor(url: string, options: any) {
    this.url = url;
    this.options = options;
    this.auth = options.auth;
    const ioListeners = new Map<string, Function[]>();
    this.io = {
      listeners: ioListeners,
      on: (event: string, fn: Function) => {
        let list = ioListeners.get(event);
        if (!list) {
          list = [];
          ioListeners.set(event, list);
        }
        list.push(fn);
      },
      trigger: (event: string, ...args: any[]) => {
        const list = ioListeners.get(event);
        if (list) {
          for (const fn of [...list]) {
            fn(...args);
          }
        }
      },
    };
  }

  on(event: string, fn: Function) {
    let list = this.listeners.get(event);
    if (!list) {
      list = [];
      this.listeners.set(event, list);
    }
    list.push(fn);
    return this;
  }

  emit(event: string, payload?: any, callback?: Function) {
    this.emittedEvents.push({ event, payload, callback });
    return this;
  }

  connect() {
    this.connectCallCount++;
    this.connected = true;
    this.trigger('connect');
    return this;
  }

  disconnect() {
    this.disconnectCallCount++;
    this.connected = false;
    this.trigger('disconnect', 'client disconnect');
    return this;
  }

  trigger(event: string, ...args: any[]) {
    if (event === 'disconnect') {
      this.connected = false;
    } else if (event === 'connect') {
      this.connected = true;
    }
    const list = this.listeners.get(event);
    if (list) {
      for (const fn of [...list]) {
        fn(...args);
      }
    }
  }
}

describe('Socket Client Architecture (Stage 3.2)', () => {
  let client: SocketClient;
  let activeMockSocket: MockSocket | null = null;

  beforeEach(() => {
    sessionManager._resetForTesting();
    client = new SocketClient();
    client._setSocketFactoryForTesting((url, opts) => {
      activeMockSocket = new MockSocket(url, opts);
      return activeMockSocket as any;
    });
  });

  afterEach(() => {
    client.destroy();
    sessionManager._resetForTesting();
    activeMockSocket = null;
  });

  describe('Connection Lifecycle', () => {
    it('connects with correct URL and auth handshake when authenticated', () => {
      (sessionManager as any).inMemoryAccessToken = 'test-token-jwt-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();

      assert.strictEqual(client.isConnected(), true);
      assert.strictEqual(client.getState(), 'connected');
      assert.ok(activeMockSocket);
      assert.strictEqual(activeMockSocket!.url, ENV.SOCKET_URL);
      assert.strictEqual(activeMockSocket!.auth?.token, 'test-token-jwt-1');
    });

    it('does not connect when user is unauthenticated', () => {
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;

      client.connect();

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getState(), 'disconnected');
      assert.strictEqual(activeMockSocket, null);
    });

    it('prevents duplicate connect operations if already connected', () => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();
      const firstSocket = activeMockSocket;

      client.connect();
      assert.strictEqual(activeMockSocket, firstSocket);
      assert.strictEqual(client.isConnected(), true);
    });

    it('disconnects cleanly and resets state to disconnected', () => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();
      assert.strictEqual(client.isConnected(), true);

      client.disconnect();
      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getState(), 'disconnected');
    });
  });

  describe('SessionManager Lifecycle Integration', () => {
    it('automatically updates socket auth token when TOKEN_REFRESHED is emitted', () => {
      (sessionManager as any).inMemoryAccessToken = 'old-token';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();
      assert.strictEqual(activeMockSocket!.auth?.token, 'old-token');

      // Simulate refresh token rotation
      (sessionManager as any).inMemoryAccessToken = 'new-fresh-token';
      (sessionManager as any).notifyListeners({ type: 'TOKEN_REFRESHED' });

      assert.strictEqual(activeMockSocket!.auth?.token, 'new-fresh-token');
    });

    it('disconnects socket when UNAUTHENTICATED is emitted', () => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();
      assert.strictEqual(client.isConnected(), true);

      // Simulate logout
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;
      (sessionManager as any).notifyListeners({ type: 'UNAUTHENTICATED' });

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getState(), 'disconnected');
    });

    it('re-establishes connection for new session after logout and subsequent login', () => {
      // Session A
      (sessionManager as any).inMemoryAccessToken = 'token-session-A';
      (sessionManager as any).currentUser = { id: 'user-a', email: 'a@gmail.com', createdAt: '...' };
      (sessionManager as any).sessionGenerationId = 1;

      client.connect();
      assert.strictEqual(activeMockSocket!.auth?.token, 'token-session-A');

      // Logout
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;
      (sessionManager as any).sessionGenerationId = 2;
      (sessionManager as any).notifyListeners({ type: 'UNAUTHENTICATED' });
      assert.strictEqual(client.isConnected(), false);

      // Login Session B
      (sessionManager as any).inMemoryAccessToken = 'token-session-B';
      (sessionManager as any).currentUser = { id: 'user-b', email: 'b@gmail.com', createdAt: '...' };
      (sessionManager as any).sessionGenerationId = 3;
      (sessionManager as any).notifyListeners({
        type: 'AUTHENTICATED',
        user: (sessionManager as any).currentUser,
      });

      assert.strictEqual(client.isConnected(), true);
      assert.strictEqual(activeMockSocket!.auth?.token, 'token-session-B');
    });

    it('discards inbound server events if session generation has changed', () => {
      (sessionManager as any).inMemoryAccessToken = 'token-A';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };
      (sessionManager as any).sessionGenerationId = 1;

      client.connect();

      let receivedMessage: any = null;
      client.on('new_message', (msg) => {
        receivedMessage = msg;
      });

      // Generation changes (e.g. user logged out)
      (sessionManager as any).sessionGenerationId = 2;

      // Event arrives on old socket
      activeMockSocket!.trigger('new_message', { id: 'msg-stale', content: 'Stale' });

      assert.strictEqual(receivedMessage, null, 'Stale event must be discarded');
    });
  });

  describe('Token Expiration & Transparent Reconnection', () => {
    it('reconnects with fresh token when server emits Token expired error', async () => {
      (sessionManager as any).inMemoryAccessToken = 'expired-token';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };
      (sessionManager as any).sessionGenerationId = 1;

      client.connect();

      let refreshCalled = false;
      sessionManager.acquireFreshAccessToken = async () => {
        refreshCalled = true;
        (sessionManager as any).inMemoryAccessToken = 'fresh-refreshed-token';
        return 'fresh-refreshed-token';
      };

      // Server emits Token expired error
      activeMockSocket!.trigger('error', { error: 'Token expired' });

      // Await pending reconnection
      await client.handleTokenExpiredOrDisconnect();

      assert.strictEqual(refreshCalled, true);
      assert.strictEqual(activeMockSocket!.auth?.token, 'fresh-refreshed-token');
      assert.strictEqual(client.isConnected(), true);
    });

    it('reconnects with fresh token when server disconnects socket with io server disconnect', async () => {
      (sessionManager as any).inMemoryAccessToken = 'expiring-token';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();

      let refreshCalled = false;
      sessionManager.acquireFreshAccessToken = async () => {
        refreshCalled = true;
        (sessionManager as any).inMemoryAccessToken = 'new-token-after-disconnect';
        return 'new-token-after-disconnect';
      };

      // Server triggers disconnect
      activeMockSocket!.trigger('disconnect', 'io server disconnect');

      await client.handleTokenExpiredOrDisconnect();

      assert.strictEqual(refreshCalled, true);
      assert.strictEqual(activeMockSocket!.auth?.token, 'new-token-after-disconnect');
    });

    it('reconnects with fresh token when connect_error occurs with Authentication failed', async () => {
      (sessionManager as any).inMemoryAccessToken = 'rejected-token';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();

      let refreshCalled = false;
      sessionManager.acquireFreshAccessToken = async () => {
        refreshCalled = true;
        (sessionManager as any).inMemoryAccessToken = 'valid-replacement-token';
        return 'valid-replacement-token';
      };

      // Trigger handshake failure
      activeMockSocket!.trigger('connect_error', new Error('Authentication failed'));

      await client.handleTokenExpiredOrDisconnect();

      assert.strictEqual(refreshCalled, true);
      assert.strictEqual(activeMockSocket!.auth?.token, 'valid-replacement-token');
    });

    it('prevents multiple simultaneous reconnect flights', async () => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();

      let callCount = 0;
      sessionManager.acquireFreshAccessToken = async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return 'token-2';
      };

      // Trigger multiple reconnects simultaneously
      const p1 = client.handleTokenExpiredOrDisconnect();
      const p2 = client.handleTokenExpiredOrDisconnect();
      const p3 = client.handleTokenExpiredOrDisconnect();

      await Promise.all([p1, p2, p3]);

      assert.strictEqual(callCount, 1, 'Only one refresh operation must execute concurrently');
    });

    it('aborts reconnection if session is logged out while refresh is in flight', async () => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };
      (sessionManager as any).sessionGenerationId = 10;

      client.connect();

      sessionManager.acquireFreshAccessToken = async () => {
        // User logs out in the middle of the async refresh
        (sessionManager as any).sessionGenerationId = 11;
        (sessionManager as any).inMemoryAccessToken = null;
        (sessionManager as any).currentUser = null;
        return 'orphaned-token';
      };

      await client.handleTokenExpiredOrDisconnect();

      // Client must not be connected to the orphaned session
      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getState(), 'disconnected');
    });
  });

  describe('Room Subscriptions & Auto-Rejoin', () => {
    it('tracks joined rooms and re-emits join_conversation upon reconnection', async () => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();

      // Join room
      const joinPromise = client.joinConversation('conv-room-123');
      const emitRecord = activeMockSocket!.emittedEvents.find((e) => e.event === 'join_conversation');
      assert.ok(emitRecord);
      assert.strictEqual(emitRecord!.payload.conversationId, 'conv-room-123');

      // Server acknowledges join
      emitRecord!.callback!({ success: true, conversationId: 'conv-room-123' });
      const joinRes = await joinPromise;
      assert.strictEqual(joinRes.success, true);

      // Now simulate reconnect
      activeMockSocket!.emittedEvents = [];
      activeMockSocket!.trigger('connect');

      // Verify join_conversation was re-emitted for conv-room-123
      const rejoinRecord = activeMockSocket!.emittedEvents.find((e) => e.event === 'join_conversation');
      assert.ok(rejoinRecord);
      assert.strictEqual(rejoinRecord!.payload.conversationId, 'conv-room-123');
    });

    it('untracks room when leaveConversation is called', async () => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();

      // Join room
      const joinPromise = client.joinConversation('conv-room-456');
      activeMockSocket!.emittedEvents[0].callback!({ success: true });
      await joinPromise;

      // Leave room
      const leavePromise = client.leaveConversation('conv-room-456');
      const leaveRecord = activeMockSocket!.emittedEvents.find((e) => e.event === 'leave_conversation');
      leaveRecord!.callback!({ success: true });
      await leavePromise;

      // Reconnect
      activeMockSocket!.emittedEvents = [];
      activeMockSocket!.trigger('connect');

      // Verify no rejoin happened
      const rejoinRecord = activeMockSocket!.emittedEvents.find((e) => e.event === 'join_conversation');
      assert.strictEqual(rejoinRecord, undefined);
    });
  });

  describe('Client-to-Server Outbound Events with Acknowledgment', () => {
    beforeEach(() => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };
      client.connect();
    });

    it('sendMessage emits send_message and handles acknowledgment callback', async () => {
      const mockMsg: Message = {
        id: 'msg-new',
        conversationId: 'c1',
        senderId: 'u1',
        type: 'TEXT',
        content: 'Hello!',
        fileKey: null,
        fileMime: null,
        fileSize: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        readAt: null,
        createdAt: '2026-11-09T05:00:00.000Z',
        updatedAt: '2026-11-09T05:00:00.000Z',
      };

      const sendPromise = client.sendMessage({ conversationId: 'c1', content: '  Hello!  ' });
      const record = activeMockSocket!.emittedEvents.find((e) => e.event === 'send_message');
      assert.ok(record);
      assert.strictEqual(record!.payload.content, 'Hello!');

      record!.callback!({ success: true, message: mockMsg });
      const res = await sendPromise;
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.message?.id, 'msg-new');
    });

    it('editMessage emits edit_message and handles acknowledgment callback', async () => {
      const editPromise = client.editMessage({ messageId: 'm1', content: '  Updated!  ' });
      const record = activeMockSocket!.emittedEvents.find((e) => e.event === 'edit_message');
      assert.ok(record);
      assert.strictEqual(record!.payload.content, 'Updated!');

      record!.callback!({ success: true });
      const res = await editPromise;
      assert.strictEqual(res.success, true);
    });

    it('deleteMessage emits delete_message and handles acknowledgment callback', async () => {
      const deletePromise = client.deleteMessage({ messageId: 'm1' });
      const record = activeMockSocket!.emittedEvents.find((e) => e.event === 'delete_message');
      assert.ok(record);

      record!.callback!({ success: true, messageId: 'm1' });
      const res = await deletePromise;
      assert.strictEqual(res.success, true);
    });

    it('markRead emits mark_read and handles acknowledgment callback', async () => {
      const markPromise = client.markRead({ conversationId: 'c1', lastMessageId: 'm1' });
      const record = activeMockSocket!.emittedEvents.find((e) => e.event === 'mark_read');
      assert.ok(record);

      record!.callback!({ success: true, count: 3 });
      const res = await markPromise;
      assert.strictEqual(res.count, 3);
    });

    it('typingStart and typingStop emit typing events with callbacks', async () => {
      const startPromise = client.typingStart('c1');
      const startRecord = activeMockSocket!.emittedEvents.find((e) => e.event === 'typing_start');
      startRecord!.callback!({ success: true });
      assert.strictEqual((await startPromise).success, true);

      const stopPromise = client.typingStop('c1');
      const stopRecord = activeMockSocket!.emittedEvents.find((e) => e.event === 'typing_stop');
      stopRecord!.callback!({ success: true });
      assert.strictEqual((await stopPromise).success, true);
    });

    it('rejects emit when socket is not connected', async () => {
      client.disconnect();

      await assert.rejects(
        async () => client.sendMessage({ conversationId: 'c1', content: 'test' }),
        /Socket not connected/
      );
    });

    it('rejects emit if timeout expires before server acknowledgment', async () => {
      const sendPromise = client.sendMessage({ conversationId: 'c1', content: 'test' }, 50);

      await assert.rejects(
        async () => sendPromise,
        /timed out/
      );
    });

    it('rejects emit if session generation changes while acknowledgment is in flight', async () => {
      (sessionManager as any).sessionGenerationId = 1;
      const sendPromise = client.sendMessage({ conversationId: 'c1', content: 'test' }, 5000);

      // Session changes before callback fires
      (sessionManager as any).sessionGenerationId = 2;

      const record = activeMockSocket!.emittedEvents.find((e) => e.event === 'send_message');
      record!.callback!({ success: true });

      await assert.rejects(
        async () => sendPromise,
        /Session invalidated/
      );
    });
  });

  describe('Inbound Event Subscriptions', () => {
    beforeEach(() => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };
      client.connect();
    });

    it('registers and triggers user_presence listener', () => {
      let received: any = null;
      const unsub = client.on('user_presence', (payload) => {
        received = payload;
      });

      activeMockSocket!.trigger('user_presence', {
        userId: 'partner-1',
        status: 'online',
        lastSeenAt: null,
      });

      assert.strictEqual(received?.userId, 'partner-1');
      assert.strictEqual(received?.status, 'online');

      // Unsubscribe
      unsub();
      activeMockSocket!.trigger('user_presence', {
        userId: 'partner-1',
        status: 'offline',
        lastSeenAt: '2026-11-09T05:30:00.000Z',
      });

      // Still 'online' because unsubscribed
      assert.strictEqual(received?.status, 'online');
    });

    it('registers and triggers user_typing listener', () => {
      let received: any = null;
      client.on('user_typing', (payload) => {
        received = payload;
      });

      activeMockSocket!.trigger('user_typing', {
        conversationId: 'c1',
        userId: 'partner-1',
        isTyping: true,
      });

      assert.strictEqual(received?.isTyping, true);
    });

    it('registers and triggers messages_read listener', () => {
      let received: any = null;
      client.on('messages_read', (payload) => {
        received = payload;
      });

      activeMockSocket!.trigger('messages_read', {
        conversationId: 'c1',
        readerId: 'partner-1',
        readAt: '2026-11-09T05:30:00.000Z',
        count: 4,
        lastReadMessageId: 'm1',
      });

      assert.strictEqual(received?.count, 4);
    });
  });

  describe('Race Conditions & Edge Cases', () => {
    it('handles rapid connect and disconnect gracefully', () => {
      (sessionManager as any).inMemoryAccessToken = 'token-1';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };

      client.connect();
      client.disconnect();
      client.connect();
      client.disconnect();

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getState(), 'disconnected');
    });

    it('cleans up state listeners on unsubscribe', () => {
      let callCount = 0;
      const unsub = client.subscribeState(() => {
        callCount++;
      });

      assert.strictEqual(callCount, 1); // Initial invocation

      unsub();
      client.connect();
      assert.strictEqual(callCount, 1); // No further invocations
    });
  });

  describe('Stage 4: Socket.IO Reconnection & Heartbeat Resilience', () => {
    let mockAppState: MockAppStateDriver;

    beforeEach(() => {
      mockAppState = new MockAppStateDriver();
      client._setAppStateDriverForTesting(mockAppState);
      (sessionManager as any).inMemoryAccessToken = 'valid-token-stage-4';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };
      (sessionManager as any).sessionGenerationId = 100;
    });

    it('Requirement 1: Maintains a single shared socket instance across multiple connect calls', () => {
      client.connect();
      const firstSocket = activeMockSocket;
      assert.ok(firstSocket);

      // Subsequent connect call
      client.connect();
      assert.strictEqual(activeMockSocket, firstSocket, 'Must reuse the exact same socket instance');
      assert.strictEqual(client.isConnected(), true);
    });

    it('Requirement 2: Reconnection occurs after temporary transport disconnection', () => {
      client.connect();
      assert.strictEqual(client.getState(), 'connected');

      // Transport drops (e.g. Wi-Fi / cellular switch or Render sleep)
      activeMockSocket!.trigger('disconnect', 'transport close');
      assert.strictEqual(client.getState(), 'reconnecting');
      assert.strictEqual(client.isConnected(), false);

      // Reconnection establishes
      activeMockSocket!.trigger('connect');
      assert.strictEqual(client.getState(), 'connected');
      assert.strictEqual(client.isConnected(), true);
    });

    it('Requirement 2: Reconnection occurs after ping timeout', () => {
      client.connect();
      assert.strictEqual(client.getState(), 'connected');

      // Server misses ping
      activeMockSocket!.trigger('disconnect', 'ping timeout');
      assert.strictEqual(client.getState(), 'reconnecting');

      // Server connection restored
      activeMockSocket!.trigger('connect');
      assert.strictEqual(client.getState(), 'connected');
    });

    it('Requirement 3: Reconnection uses bounded exponential backoff options', () => {
      client.connect();
      assert.ok(activeMockSocket);
      const opts = activeMockSocket!.options;

      assert.strictEqual(opts.reconnection, true, 'reconnection must be true');
      assert.strictEqual(opts.reconnectionAttempts, Infinity, 'reconnectionAttempts must be Infinity while authenticated');
      assert.strictEqual(opts.reconnectionDelay, 1000, 'reconnectionDelay must be 1000ms');
      assert.strictEqual(opts.reconnectionDelayMax, 10000, 'reconnectionDelayMax must be bounded to 10000ms');
      assert.strictEqual(opts.randomizationFactor, 0.5, 'randomizationFactor must be 0.5 for jitter');
      assert.strictEqual(opts.timeout, 20000, 'connect timeout must be 20000ms');
    });

    it('Requirement 4: Duplicate listeners are not registered on repeated connections or reconnects', () => {
      client.connect();
      const initialConnectListeners = activeMockSocket!.listeners.get('connect')?.length || 0;
      const initialMessageListeners = activeMockSocket!.listeners.get('new_message')?.length || 0;

      assert.strictEqual(initialConnectListeners, 1);
      assert.strictEqual(initialMessageListeners, 1);

      // Disconnect and reconnect multiple times
      activeMockSocket!.trigger('disconnect', 'transport close');
      activeMockSocket!.trigger('connect');
      client.connect(); // Redundant connect call

      const postConnectListeners = activeMockSocket!.listeners.get('connect')?.length || 0;
      const postMessageListeners = activeMockSocket!.listeners.get('new_message')?.length || 0;

      assert.strictEqual(postConnectListeners, 1, 'connect listeners must not duplicate');
      assert.strictEqual(postMessageListeners, 1, 'new_message listeners must not duplicate');
    });

    it('Requirement 5: Logout disconnects socket and stops reconnection', () => {
      client.connect();
      assert.strictEqual(client.isConnected(), true);

      // Simulate explicit user logout (UNAUTHENTICATED without error)
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;
      (sessionManager as any).notifyListeners({ type: 'UNAUTHENTICATED' });

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getState(), 'disconnected');

      // Subsequent disconnect or error events must not transition to reconnecting
      activeMockSocket!.trigger('disconnect', 'transport close');
      assert.strictEqual(client.getState(), 'disconnected');

      activeMockSocket!.trigger('connect_error', new Error('xhr poll error'));
      assert.strictEqual(client.getState(), 'disconnected');
    });

    it('Requirement 6: Reconnection uses the latest access token after refresh', () => {
      client.connect();
      assert.strictEqual(activeMockSocket!.auth?.token, 'valid-token-stage-4');

      // Token refreshed in SessionManager
      (sessionManager as any).inMemoryAccessToken = 'newly-rotated-access-token';
      (sessionManager as any).notifyListeners({ type: 'TOKEN_REFRESHED' });

      assert.strictEqual(activeMockSocket!.auth?.token, 'newly-rotated-access-token');

      // Reconnect attempt on manager
      activeMockSocket!.io.trigger('reconnect_attempt');
      assert.strictEqual(activeMockSocket!.auth?.token, 'newly-rotated-access-token');
    });

    it('Requirement 7: Transient token refresh failure preserves valid credentials and keeps reconnecting', async () => {
      client.connect();

      // Configure acquireFreshAccessToken to fail with transient 503 (Render cold start)
      let acquireCalled = false;
      sessionManager.acquireFreshAccessToken = async () => {
        acquireCalled = true;
        throw new ApiError(503, 'Service Unavailable - Render starting');
      };

      // Server disconnects with io server disconnect (token expired)
      activeMockSocket!.trigger('disconnect', 'io server disconnect');

      await client.handleTokenExpiredOrDisconnect();

      assert.strictEqual(acquireCalled, true);
      // Valid credentials in sessionManager are preserved
      assert.strictEqual(sessionManager.isAuthenticated(), true);
      // SocketClient must NOT be marked permanently disconnected or auth failed
      assert.strictEqual(client.getState(), 'reconnecting');
    });

    it('Requirement 8: Definitive authentication failure transitions state to authentication_failure and disconnects', async () => {
      client.connect();

      // Configure acquireFreshAccessToken to fail with definitive 401
      sessionManager.acquireFreshAccessToken = async () => {
        (sessionManager as any).inMemoryAccessToken = null;
        (sessionManager as any).currentUser = null;
        (sessionManager as any).notifyListeners({
          type: 'UNAUTHENTICATED',
          error: 'Refresh token revoked',
        });
        throw new ApiError(401, 'Refresh token revoked');
      };

      activeMockSocket!.trigger('connect_error', new Error('Authentication failed'));

      await client.handleTokenExpiredOrDisconnect();

      assert.strictEqual(client.getState(), 'authentication_failure');
      assert.strictEqual(client.isConnected(), false);
    });

    it('Requirement 8: Session revoked error from server transitions to authentication_failure and disconnects', () => {
      client.connect();
      assert.strictEqual(client.isConnected(), true);

      // Server revokes session (password change, token reuse detection)
      activeMockSocket!.trigger('error', { error: 'Session revoked' });

      assert.strictEqual(client.getState(), 'authentication_failure');
      assert.strictEqual(client.isConnected(), false);
    });

    it('Requirement 9: Background/foreground transitions do not create duplicate sockets', () => {
      client.connect();
      const initialSocket = activeMockSocket;

      // App transitions to background
      mockAppState.setAppState('background');
      assert.strictEqual(activeMockSocket, initialSocket);

      // App returns to foreground while still connected (no reconnect storm)
      const connectCallsBefore = initialSocket!.connectCallCount;
      mockAppState.setAppState('active');
      assert.strictEqual(activeMockSocket, initialSocket);
      assert.strictEqual(
        initialSocket!.connectCallCount,
        connectCallsBefore,
        'Must not trigger redundant connect if already connected'
      );

      // App moves to background and connection is lost
      mockAppState.setAppState('background');
      activeMockSocket!.trigger('disconnect', 'transport close');
      assert.strictEqual(client.getState(), 'reconnecting');

      // Return to foreground -> triggers reconnect using single shared instance
      mockAppState.setAppState('active');
      assert.strictEqual(activeMockSocket, initialSocket, 'Must reuse single shared socket instance');
      assert.strictEqual(initialSocket!.connectCallCount, connectCallsBefore + 1);
    });

    it('Requirement 9: Foreground transition respects unauthenticated state and does not connect', () => {
      // User is logged out
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;

      mockAppState.setAppState('background');
      mockAppState.setAppState('active');

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getState(), 'disconnected');
      assert.strictEqual(activeMockSocket, null);
    });

    it('Requirement 10: Existing chat event handling remains fully compatible with Stage 4', async () => {
      client.connect();

      let receivedTyping: any = null;
      const unsub = client.on('user_typing', (payload) => {
        receivedTyping = payload;
      });

      // Transport drops and reconnects
      activeMockSocket!.trigger('disconnect', 'transport close');
      activeMockSocket!.trigger('connect');

      // Send event on reconnected socket
      activeMockSocket!.trigger('user_typing', {
        conversationId: 'c1',
        userId: 'u2',
        isTyping: true,
      });

      assert.strictEqual(receivedTyping?.conversationId, 'c1');
      assert.strictEqual(receivedTyping?.isTyping, true);

      unsub();
    });
  });

  describe('Stage 4 Remediation: Defensive Terminal State & State Transition Ordering', () => {
    beforeEach(() => {
      (sessionManager as any).inMemoryAccessToken = 'valid-token-remediation';
      (sessionManager as any).currentUser = { id: 'u1', email: 'user@gmail.com', createdAt: '...' };
      (sessionManager as any).sessionGenerationId = 200;
    });

    it('Regression 1: authentication_failure cannot be overwritten by a later connect_error', () => {
      client.connect();
      assert.strictEqual(client.getState(), 'connected');

      // Trigger server revocation or definitive auth failure
      activeMockSocket!.trigger('error', { error: 'Session revoked' });
      assert.strictEqual(client.getState(), 'authentication_failure');

      // Subsequent in-flight connect_error fires (e.g. transport failure or generic poll error)
      activeMockSocket!.trigger('connect_error', new Error('xhr poll error'));
      assert.strictEqual(
        client.getState(),
        'authentication_failure',
        'State must remain authentication_failure and not be overwritten by disconnected or reconnecting'
      );

      // Even if connect_error carries Authentication failed
      activeMockSocket!.trigger('connect_error', new Error('Authentication failed'));
      assert.strictEqual(client.getState(), 'authentication_failure');
    });

    it('Regression 2: No additional refresh flow starts after definitive authentication failure', async () => {
      client.connect();

      // Enter terminal authentication_failure
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;
      (sessionManager as any).notifyListeners({
        type: 'UNAUTHENTICATED',
        error: 'Refresh token revoked',
      });

      assert.strictEqual(client.getState(), 'authentication_failure');

      let refreshAttemptCount = 0;
      sessionManager.acquireFreshAccessToken = async () => {
        refreshAttemptCount++;
        return 'unexpected-token';
      };

      // In-flight error events arrive
      activeMockSocket!.trigger('connect_error', new Error('Authentication failed'));
      activeMockSocket!.trigger('reconnect_attempt');
      if (activeMockSocket!.io) {
        activeMockSocket!.io.trigger('reconnect_attempt');
      }

      assert.strictEqual(refreshAttemptCount, 0, 'Must not start any token refresh flow');
      assert.strictEqual(client.getState(), 'authentication_failure');
    });

    it('Regression 3: UNAUTHENTICATED with error sets intended terminal state without intermediate disconnected notification', () => {
      client.connect();
      assert.strictEqual(client.getState(), 'connected');

      const stateHistory: string[] = [];
      const unsub = client.subscribeState((st) => {
        stateHistory.push(st);
      });

      // Clear the initial subscription callback
      stateHistory.length = 0;

      // Simulate definitive auth rejection
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;
      (sessionManager as any).notifyListeners({
        type: 'UNAUTHENTICATED',
        error: 'Session expired',
      });

      unsub();

      // State history must NOT contain an intermediate 'disconnected' flap
      assert.deepStrictEqual(
        stateHistory,
        ['authentication_failure'],
        'State transition must go directly to authentication_failure without disconnected flapper'
      );
      assert.strictEqual(client.getState(), 'authentication_failure');
    });

    it('Regression 4: Normal logout still cleanly ends in disconnected without flapping', () => {
      client.connect();
      assert.strictEqual(client.getState(), 'connected');

      const stateHistory: string[] = [];
      const unsub = client.subscribeState((st) => {
        stateHistory.push(st);
      });

      stateHistory.length = 0;

      // Simulate explicit user logout (no error field)
      (sessionManager as any).inMemoryAccessToken = null;
      (sessionManager as any).currentUser = null;
      (sessionManager as any).notifyListeners({
        type: 'UNAUTHENTICATED',
      });

      unsub();

      assert.deepStrictEqual(stateHistory, ['disconnected']);
      assert.strictEqual(client.getState(), 'disconnected');
      assert.strictEqual(client.isConnected(), false);
    });

    it('Regression 5: Transient network failures still enter reconnecting for authenticated users', () => {
      client.connect();
      assert.strictEqual(client.getState(), 'connected');

      // Network drops -> xhr poll error
      activeMockSocket!.trigger('connect_error', new Error('xhr poll error'));
      assert.strictEqual(client.getState(), 'reconnecting');

      // Gateway timeout -> timeout error
      activeMockSocket!.trigger('connect_error', new Error('timeout'));
      assert.strictEqual(client.getState(), 'reconnecting');

      // Transport close
      activeMockSocket!.trigger('disconnect', 'transport close');
      assert.strictEqual(client.getState(), 'reconnecting');
    });

    it('Regression 6: Existing reconnect and listener behavior remains intact after remediation', () => {
      client.connect();

      let messagePayload: any = null;
      const unsub = client.on('new_message', (payload) => {
        messagePayload = payload;
      });

      // Drop and recover
      activeMockSocket!.trigger('disconnect', 'transport close');
      assert.strictEqual(client.getState(), 'reconnecting');

      activeMockSocket!.trigger('connect');
      assert.strictEqual(client.getState(), 'connected');

      activeMockSocket!.trigger('new_message', {
        id: 'msg-remediation-1',
        conversationId: 'c1',
        senderId: 'u2',
        content: 'Hello remediation!',
      });

      assert.strictEqual(messagePayload?.id, 'msg-remediation-1');
      assert.strictEqual(messagePayload?.content, 'Hello remediation!');

      unsub();
    });
  });
});

