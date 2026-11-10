import { io, Socket } from 'socket.io-client';
import { ENV } from '../../config/env.ts';
import { sessionManager, type SessionEvent } from '../auth/sessionManager.ts';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ServerToClientEventName,
  JoinConversationPayload,
  LeaveConversationPayload,
  SocketSendMessagePayload,
  SocketEditMessagePayload,
  SocketDeleteMessagePayload,
  SocketMarkReadPayload,
  SocketTypingPayload,
  RoomAckResponse,
  SendMessageAckResponse,
  EditMessageAckResponse,
  DeleteMessageAckResponse,
  MarkReadAckResponse,
  TypingAckResponse,
} from './socketEvents.ts';

export type SocketConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'authentication_failure';

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface AppStateSubscription {
  remove: () => void;
}

export interface AppStateDriver {
  currentState: AppStateStatus;
  addEventListener: (
    type: 'change',
    listener: (state: AppStateStatus) => void
  ) => AppStateSubscription;
}

function resolveAppState(): AppStateDriver | null {
  try {
    // Dynamic require avoids Flow syntax parsing errors in Node test environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = typeof require !== 'undefined' ? require('react-native') : null;
    return rn?.AppState || null;
  } catch {
    return null;
  }
}

type StateListener = (state: SocketConnectionState) => void;

/**
 * Real-Time Socket.IO Client Manager
 * Strictly coordinates socket lifecycle with the central SessionManager singleton.
 * Uses verified backend handshake contract (auth: { token: accessToken }).
 * Implements token expiration detection, concurrency-locked reconnection,
 * generational race guards, room subscription management, and mobile lifecycle integration.
 */
export class SocketClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private state: SocketConnectionState = 'disconnected';
  private stateListeners: Set<StateListener> = new Set();
  private sessionGenerationId: number = -1;
  private unsubscribeSession: (() => void) | null = null;
  private isReconnecting: boolean = false;
  private reconnectPromise: Promise<void> | null = null;
  private activeRooms: Set<string> = new Set();
  private eventListeners: Map<string, Set<Function>> = new Map();
  private socketFactory: (url: string, opts: any) => any = io;
  private appStateDriver: AppStateDriver | null = null;
  private appStateSubscription: AppStateSubscription | null = null;
  private currentAppState: AppStateStatus = 'active';

  constructor() {
    this.unsubscribeSession = sessionManager.subscribe((event: SessionEvent) => {
      this.handleSessionEvent(event);
    });
    this.appStateDriver = resolveAppState();
    this.initAppStateListener();
  }

  private initAppStateListener(): void {
    if (this.appStateDriver && typeof this.appStateDriver.addEventListener === 'function') {
      try {
        this.currentAppState = this.appStateDriver.currentState || 'active';
        this.appStateSubscription = this.appStateDriver.addEventListener(
          'change',
          (nextState: AppStateStatus) => {
            this.handleAppStateChange(nextState);
          }
        );
      } catch (err) {
        console.warn('[SocketClient] Failed to initialize AppState listener:', err);
      }
    }
  }

  /**
   * For testing only: Injects a custom AppState driver stub.
   */
  _setAppStateDriverForTesting(driver: AppStateDriver | null): void {
    if (this.appStateSubscription) {
      try {
        this.appStateSubscription.remove();
      } catch {
        // Safe disposal
      }
      this.appStateSubscription = null;
    }
    this.appStateDriver = driver;
    this.initAppStateListener();
  }

  /**
   * Handles mobile app lifecycle transitions between active, background, and inactive.
   * Safe against reconnect storms, duplicate socket instances, and unauthenticated states.
   */
  handleAppStateChange(nextState: AppStateStatus): void {
    const prevState = this.currentAppState;
    this.currentAppState = nextState;

    if (prevState === nextState) {
      return;
    }

    if (nextState === 'background' || nextState === 'inactive') {
      // In background: do not trigger new connection attempts.
      // If currently connecting or reconnecting, allow backoff to pause naturally.
      return;
    }

    if (nextState === 'active') {
      // Foreground: if authenticated and not connected, resume connection cleanly
      if (!sessionManager.isAuthenticated()) {
        return;
      }

      if (this.isConnected()) {
        // Already connected: do nothing! Strictly prevents reconnect storms and duplicate sockets.
        return;
      }

      if (this.state === 'connecting') {
        // Connection handshake is already in flight.
        return;
      }

      // Re-evaluate auth token from SessionManager
      const token = sessionManager.getAccessToken();
      if (token && this.socket) {
        (this.socket as any).auth = { token };
      }

      // Safely resume connection using single shared socket instance
      this.connect();
    }
  }

  /**
   * For testing only: Injects a custom socket factory stub.
   */
  _setSocketFactoryForTesting(factory: (url: string, opts: any) => any): void {
    this.socketFactory = factory;
  }

  /**
   * For testing only: Resets client state and unsubscribes.
   */
  _resetForTesting(): void {
    this.disconnect();
    this.activeRooms.clear();
    this.eventListeners.clear();
    this.sessionGenerationId = -1;
    this.isReconnecting = false;
    this.reconnectPromise = null;
    this.currentAppState = 'active';
  }

  /**
   * Returns the current connection state.
   */
  getState(): SocketConnectionState {
    return this.state;
  }

  /**
   * Checks whether the underlying socket is currently connected.
   */
  isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  /**
   * Returns the socket ID assigned by the server, or null if disconnected.
   */
  getSocketId(): string | null {
    return this.socket?.id ?? null;
  }

  /**
   * Subscribes a listener to connection state transitions.
   * Returns an unsubscribe callback.
   */
  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private setState(newState: SocketConnectionState): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(newState);
      } catch (err) {
        console.warn('[SocketClient] State listener error:', err);
      }
    }
  }

  /**
   * Handles lifecycle notifications from the SessionManager singleton.
   */
  private handleSessionEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'AUTHENTICATED': {
        const currentGen = sessionManager.getGenerationId();
        if (this.sessionGenerationId !== currentGen || !this.isConnected()) {
          this.sessionGenerationId = currentGen;
          // If a socket exists from an old session, disconnect it first
          if (this.socket) {
            this.disconnectInternal();
          }
          this.connect();
        }
        break;
      }
      case 'TOKEN_REFRESHED': {
        const token = sessionManager.getAccessToken();
        if (this.socket && token) {
          (this.socket as any).auth = { token };
        }
        // If disconnected or in reconnect state, trigger connection
        if (!this.isConnected() && sessionManager.isAuthenticated()) {
          this.connect();
        }
        break;
      }
      case 'UNAUTHENTICATED': {
        // Set intended terminal state FIRST to prevent synchronous Socket.IO disconnect
        // callbacks from producing an incorrect intermediate state notification
        if (event.error) {
          this.setState('authentication_failure');
        } else {
          this.setState('disconnected');
        }
        this.disconnectInternal();
        this.activeRooms.clear();
        this.sessionGenerationId = -1;
        break;
      }
      case 'PROFILE_UNVERIFIED': {
        this.disconnect();
        this.activeRooms.clear();
        this.sessionGenerationId = -1;
        break;
      }
    }
  }

  /**
   * Initiates socket connection using current access token from SessionManager.
   * Safe against duplicate connect calls and unauthenticated states.
   */
  connect(): void {
    if (this.isConnected()) {
      return;
    }

    if (this.state === 'connecting') {
      return;
    }

    const token = sessionManager.getAccessToken();
    if (!token || !sessionManager.isAuthenticated()) {
      this.setState('disconnected');
      return;
    }

    this.sessionGenerationId = sessionManager.getGenerationId();
    this.setState('connecting');

    if (!this.socket) {
      // Socket.IO Reconnection & Heartbeat Strategy:
      // - Heartbeats (Engine.IO pingInterval 25s, pingTimeout 20s) maintain an active WebSocket connection
      //   while the app is actively running in the foreground and network connectivity permits it.
      // - Mobile OS background suspension may terminate or freeze background WebSockets within seconds of sleep.
      // - Heartbeat frames do NOT guarantee Render Free will never spin down; once the client backgrounds or
      //   disconnects, Render's 15-minute idle countdown begins.
      // - The LoveByte resilience architecture strictly relies on graceful reconnection recovery with bounded
      //   exponential backoff (1s to 10s with 0.5 jitter) whenever the app resumes foreground or server wakes.
      this.socket = this.socketFactory(ENV.SOCKET_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        randomizationFactor: 0.5,
        timeout: 20000,
      });

      this.attachSocketListeners(this.socket);
    } else {
      (this.socket as any).auth = { token };
    }

    this.socket?.connect();
  }

  /**
   * Explicitly disconnects the socket and resets connection state to 'disconnected'.
   */
  disconnect(): void {
    this.disconnectInternal();
    this.setState('disconnected');
  }

  private disconnectInternal(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
    this.isReconnecting = false;
    this.reconnectPromise = null;
  }

  /**
   * Attaches low-level Socket.IO lifecycle listeners.
   */
  private attachSocketListeners(socket: any): void {
    socket.on('connect', () => {
      // Stale session check: verify this connection belongs to the active session generation
      if (sessionManager.getGenerationId() !== this.sessionGenerationId) {
        socket.disconnect();
        this.setState('disconnected');
        return;
      }

      this.setState('connected');

      // Re-join active conversation rooms upon connection/reconnection
      for (const conversationId of this.activeRooms) {
        socket.emit('join_conversation', { conversationId });
      }
    });

    socket.on('disconnect', (reason: string) => {
      if (this.state === 'disconnected' || this.state === 'authentication_failure') {
        return;
      }

      // If the server forced disconnect (e.g. token expired), handle transparent refresh
      if (reason === 'io server disconnect') {
        this.handleTokenExpiredOrDisconnect().catch(() => {});
      } else if (sessionManager.isAuthenticated()) {
        this.setState('reconnecting');
      } else {
        this.setState('disconnected');
      }
    });

    socket.on('connect_error', (error: any) => {
      // Defensive terminal-state guard: once in authentication_failure, drop in-flight connection errors
      // and do not trigger refresh or overwrite terminal failure state
      if (this.state === 'authentication_failure') {
        return;
      }

      const errorMsg = error?.message || '';
      // Backend handshake returns "Authentication failed" or "Authentication token required" on expired JWT
      if (
        errorMsg.includes('Authentication failed') ||
        errorMsg.includes('Authentication token required')
      ) {
        this.handleTokenExpiredOrDisconnect().catch(() => {});
      } else if (sessionManager.isAuthenticated()) {
        this.setState('reconnecting');
      } else {
        this.setState('disconnected');
      }
    });

    socket.on('reconnect_attempt', () => {
      if (this.state === 'authentication_failure') {
        this.disconnectInternal();
        return;
      }
      if (!sessionManager.isAuthenticated()) {
        this.disconnect();
        return;
      }
      const currentToken = sessionManager.getAccessToken();
      if (currentToken) {
        (socket as any).auth = { token: currentToken };
      }
      this.setState('reconnecting');
    });

    if (socket.io && typeof socket.io.on === 'function') {
      socket.io.on('reconnect_attempt', () => {
        if (this.state === 'authentication_failure') {
          this.disconnectInternal();
          return;
        }
        if (!sessionManager.isAuthenticated()) {
          this.disconnect();
          return;
        }
        const currentToken = sessionManager.getAccessToken();
        if (currentToken) {
          (socket as any).auth = { token: currentToken };
        }
        this.setState('reconnecting');
      });
    }

    socket.on('error', (payload: any) => {
      if (payload?.error === 'Token expired') {
        this.handleTokenExpiredOrDisconnect().catch(() => {});
      } else if (payload?.error === 'Session revoked') {
        this.disconnectInternal();
        this.activeRooms.clear();
        this.sessionGenerationId = -1;
        this.setState('authentication_failure');
      }
      this.forwardInboundEvent('error', payload);
    });

    // Wire up all known server-to-client events from socket to registered handlers
    const forwardEvents: ServerToClientEventName[] = [
      'new_message',
      'message_sent',
      'message_edited',
      'message_deleted',
      'messages_read',
      'user_presence',
      'user_typing',
      'conversation_joined',
      'conversation_left',
    ];

    for (const eventName of forwardEvents) {
      socket.on(eventName, (payload: any) => {
        this.forwardInboundEvent(eventName, payload);
      });
    }
  }

  /**
   * Forwards inbound server event to all registered listeners.
   * Enforces generational validation to prevent stale callbacks from firing after logout.
   */
  private forwardInboundEvent(eventName: string, payload: any): void {
    if (sessionManager.getGenerationId() !== this.sessionGenerationId) {
      return;
    }

    const listeners = this.eventListeners.get(eventName);
    if (!listeners || listeners.size === 0) return;

    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.warn(`[SocketClient] Error in listener for '${eventName}':`, err);
      }
    }
  }

  /**
   * Mutex-guarded handler for token expiration disconnections.
   * Acquires a fresh access token through SessionManager and reconnects with it.
   */
  async handleTokenExpiredOrDisconnect(): Promise<void> {
    if (this.isReconnecting) {
      return this.reconnectPromise || Promise.resolve();
    }

    if (!sessionManager.isAuthenticated()) {
      this.disconnect();
      return;
    }

    this.isReconnecting = true;
    const capturedGen = sessionManager.getGenerationId();
    this.setState('reconnecting');

    this.reconnectPromise = (async () => {
      try {
        const freshToken = await sessionManager.acquireFreshAccessToken();

        // Stale guard: if generation changed during async refresh, abort and disconnect
        if (sessionManager.getGenerationId() !== capturedGen) {
          this.disconnect();
          return;
        }

        if (this.socket) {
          (this.socket as any).auth = { token: freshToken };
          this.socket?.connect();
        } else {
          this.connect();
        }
      } catch (err: unknown) {
        if (sessionManager.getGenerationId() === capturedGen) {
          if (!sessionManager.isAuthenticated()) {
            this.setState('authentication_failure');
            this.disconnectInternal();
          } else {
            // Transient failure (Render cold start timeout, 502/503/504)
            // SessionManager preserved SecureStore credentials. User is still authenticated.
            // Remain in 'reconnecting' state without destroying valid credentials or active session.
            this.setState('reconnecting');
          }
        }
      } finally {
        this.isReconnecting = false;
        this.reconnectPromise = null;
      }
    })();

    return this.reconnectPromise;
  }

  /**
   * Registers a listener for an inbound server event.
   * Persistent across socket reconnects. Returns an unsubscribe callback.
   */
  on<E extends ServerToClientEventName>(
    event: E,
    listener: ServerToClientEvents[E]
  ): () => void {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(listener);

    return () => {
      this.off(event, listener);
    };
  }

  /**
   * Removes a registered listener for an inbound server event.
   */
  off<E extends ServerToClientEventName>(
    event: E,
    listener: ServerToClientEvents[E]
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * Generic emit wrapper with timeout and session generational protection.
   */
  private emitWithAck<Payload, Response>(
    event: string,
    payload: Payload,
    timeoutMs: number = 5000
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected()) {
        return reject(new Error(`Socket not connected (cannot emit '${event}')`));
      }

      const capturedGen = this.sessionGenerationId;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Socket event '${event}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.socket.emit(event as any, payload as any, (response: Response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        // Stale session guard: reject if session changed during in-flight acknowledgment
        if (
          this.sessionGenerationId !== capturedGen ||
          sessionManager.getGenerationId() !== capturedGen
        ) {
          return reject(
            new Error(`Session invalidated while awaiting '${event}' acknowledgment`)
          );
        }

        resolve(response);
      });
    });
  }

  /**
   * Joins a conversation room on the server and tracks it for auto-reconnect.
   */
  async joinConversation(
    conversationId: string,
    timeoutMs: number = 5000
  ): Promise<RoomAckResponse> {
    this.activeRooms.add(conversationId);
    return this.emitWithAck<JoinConversationPayload, RoomAckResponse>(
      'join_conversation',
      { conversationId },
      timeoutMs
    );
  }

  /**
   * Leaves a conversation room on the server and untracks it.
   */
  async leaveConversation(
    conversationId: string,
    timeoutMs: number = 5000
  ): Promise<RoomAckResponse> {
    this.activeRooms.delete(conversationId);
    return this.emitWithAck<LeaveConversationPayload, RoomAckResponse>(
      'leave_conversation',
      { conversationId },
      timeoutMs
    );
  }

  /**
   * Sends a text message to a conversation via Socket.IO.
   */
  async sendMessage(
    payload: SocketSendMessagePayload,
    timeoutMs: number = 5000
  ): Promise<SendMessageAckResponse> {
    const normalizedPayload: SocketSendMessagePayload = {
      conversationId: payload.conversationId,
      content: payload.content.trim(),
      type: payload.type || 'TEXT',
    };
    return this.emitWithAck<SocketSendMessagePayload, SendMessageAckResponse>(
      'send_message',
      normalizedPayload,
      timeoutMs
    );
  }

  /**
   * Edits an existing text message via Socket.IO.
   */
  async editMessage(
    payload: SocketEditMessagePayload,
    timeoutMs: number = 5000
  ): Promise<EditMessageAckResponse> {
    const normalizedPayload: SocketEditMessagePayload = {
      messageId: payload.messageId,
      content: payload.content.trim(),
    };
    return this.emitWithAck<SocketEditMessagePayload, EditMessageAckResponse>(
      'edit_message',
      normalizedPayload,
      timeoutMs
    );
  }

  /**
   * Soft-deletes a message via Socket.IO.
   */
  async deleteMessage(
    payload: SocketDeleteMessagePayload,
    timeoutMs: number = 5000
  ): Promise<DeleteMessageAckResponse> {
    return this.emitWithAck<SocketDeleteMessagePayload, DeleteMessageAckResponse>(
      'delete_message',
      payload,
      timeoutMs
    );
  }

  /**
   * Marks messages as read in a conversation via Socket.IO.
   */
  async markRead(
    payload: SocketMarkReadPayload,
    timeoutMs: number = 5000
  ): Promise<MarkReadAckResponse> {
    return this.emitWithAck<SocketMarkReadPayload, MarkReadAckResponse>(
      'mark_read',
      payload,
      timeoutMs
    );
  }

  /**
   * Emits typing_start event to conversation room.
   */
  async typingStart(
    conversationId: string,
    timeoutMs: number = 3000
  ): Promise<TypingAckResponse> {
    return this.emitWithAck<SocketTypingPayload, TypingAckResponse>(
      'typing_start',
      { conversationId },
      timeoutMs
    );
  }

  /**
   * Emits typing_stop event to conversation room.
   */
  async typingStop(
    conversationId: string,
    timeoutMs: number = 3000
  ): Promise<TypingAckResponse> {
    return this.emitWithAck<SocketTypingPayload, TypingAckResponse>(
      'typing_stop',
      { conversationId },
      timeoutMs
    );
  }

  /**
   * Clean destruction of the socket client instance.
   */
  destroy(): void {
    if (this.appStateSubscription) {
      try {
        this.appStateSubscription.remove();
      } catch {
        // Safe disposal
      }
      this.appStateSubscription = null;
    }
    if (this.unsubscribeSession) {
      this.unsubscribeSession();
      this.unsubscribeSession = null;
    }
    this.disconnect();
    this.stateListeners.clear();
    this.eventListeners.clear();
    this.activeRooms.clear();
  }
}

export const socketClient = new SocketClient();
