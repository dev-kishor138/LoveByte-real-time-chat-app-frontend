import { authApi, type SafeUser, type LoginPayload, type LoginResponse } from '../api/auth.ts';
import { secureStorage } from '../storage/secureStore.ts';
import { ApiError } from '../api/types.ts';

export type SessionEventType =
  | 'AUTHENTICATED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_REFRESHED'
  | 'PROFILE_UNVERIFIED';

export interface SessionEvent {
  type: SessionEventType;
  user?: SafeUser | null;
  error?: string;
}

type SessionListener = (event: SessionEvent) => void;

interface QueuedRequest {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}

/**
 * Headless Session Manager Singleton
 * Coordinates in-memory JWT access tokens, hardware-backed refresh tokens,
 * concurrency-locked token rotation, request replay queues, and generational race guards.
 *
 * Implements LoveByte Stage 2B Approved Architecture (Version 3.4.0).
 * Has zero imports from apiClient or React Context.
 */
export class SessionManager {
  private inMemoryAccessToken: string | null = null;
  private currentUser: SafeUser | null = null;
  private isRefreshing: boolean = false;
  private refreshPromise: Promise<string> | null = null;
  private failedQueue: QueuedRequest[] = [];
  private sessionGenerationId: number = 0;
  private listeners: Set<SessionListener> = new Set();
  private bootstrapPromise: Promise<void> | null = null;

  /**
   * Returns the current in-memory access token.
   * Access tokens are never written to disk or SecureStore.
   */
  getAccessToken(): string | null {
    return this.inMemoryAccessToken;
  }

  /**
   * Returns the cached safe user profile.
   */
  getUser(): SafeUser | null {
    return this.currentUser;
  }

  /**
   * Returns the current monotonic session generation counter.
   */
  getGenerationId(): number {
    return this.sessionGenerationId;
  }

  /**
   * Checks whether the session is currently authenticated with both token and profile.
   */
  isAuthenticated(): boolean {
    return Boolean(this.inMemoryAccessToken && this.currentUser);
  }

  /**
   * Subscribes a listener to session lifecycle transitions.
   * Returns an unsubscribe callback.
   */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(event: SessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[SessionManager] Listener error:', err);
      }
    }
  }

  private drainFailedQueue(error: unknown | null, newToken?: string): void {
    const queue = [...this.failedQueue];
    this.failedQueue = [];

    for (const queued of queue) {
      if (error) {
        queued.reject(error);
      } else if (newToken) {
        queued.resolve(newToken);
      }
    }
  }

  /**
   * Identifies definitive authentication failures where credentials are known to be permanently invalid.
   * HTTP 401: Invalid token, expired token (>30 days), revoked session family via replay detection.
   */
  private isDefinitiveAuthFailure(error: unknown): boolean {
    return error instanceof ApiError && error.statusCode === 401;
  }

  /**
   * Categorizes a failure as transient or indeterminate.
   * Status 0: transport timeout, network offline, connection reset, DNS failure.
   * Status 500-504: server or reverse proxy cold start, database wake-up timeout, bad gateway.
   * Non-ApiError: unexpected network or transport runtime exceptions.
   */
  private isTransientOrIndeterminateFailure(error: unknown): boolean {
    if (error instanceof ApiError) {
      return error.statusCode === 0 || (error.statusCode >= 500 && error.statusCode <= 504);
    }
    return true;
  }

  /**
   * Checks whether a persisted refresh token exists in SecureStore.
   */
  async hasPersistedSession(): Promise<boolean> {
    const token = await secureStorage.getRefreshToken().catch(() => null);
    return Boolean(token);
  }

  /**
   * Application Cold-Boot Session Restoration.
   * Deduplicated by a singleton bootstrapPromise so concurrent mounts or re-renders
   * run the initialization sequence exactly once.
   */
  async bootstrap(): Promise<void> {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    const opGen = this.sessionGenerationId;
    const promise = (async () => {
      // Step 1: Read existing refresh token from SecureStore
      const existingRefreshToken = await secureStorage.getRefreshToken().catch(() => null);

      if (opGen !== this.sessionGenerationId) {
        return;
      }

      if (!existingRefreshToken) {
        this.inMemoryAccessToken = null;
        this.currentUser = null;
        this.notifyListeners({ type: 'UNAUTHENTICATED' });
        return;
      }

      // Step 2 & 3: Attempt token rotation
      let newAccessToken: string;
      try {
        newAccessToken = await this.acquireFreshAccessToken();
      } catch (refreshErr: unknown) {
        if (opGen !== this.sessionGenerationId) {
          return;
        }

        if (this.isDefinitiveAuthFailure(refreshErr)) {
          // acquireFreshAccessToken already wiped SecureStore, cleared memory, and emitted UNAUTHENTICATED
          return;
        }

        // Transient / indeterminate failure during bootstrap refresh (cold start timeout, 5xx, offline, 429):
        // SecureStore token was preserved by acquireFreshAccessToken.
        // Emit PROFILE_UNVERIFIED so UI knows a persisted session exists but could not be verified yet.
        this.notifyListeners({
          type: 'PROFILE_UNVERIFIED',
          error: refreshErr instanceof Error ? refreshErr.message : 'Unable to refresh session',
        });
        return;
      }

      if (opGen !== this.sessionGenerationId) {
        return;
      }

      // Step 5: Verify profile with new access token
      try {
        const user = await authApi.getProfile(newAccessToken);

        if (opGen !== this.sessionGenerationId) {
          return;
        }

        // Step 6: Publish authenticated state
        this.currentUser = user;
        this.notifyListeners({ type: 'AUTHENTICATED', user });
      } catch (profileErr: unknown) {
        if (opGen !== this.sessionGenerationId) {
          return;
        }

        if (profileErr instanceof ApiError && (profileErr.statusCode === 401 || profileErr.statusCode === 403 || profileErr.statusCode === 404)) {
          // Terminal profile rejection: wipe SecureStore and fail closed
          await secureStorage.clearRefreshToken();
          this.inMemoryAccessToken = null;
          this.currentUser = null;
          this.notifyListeners({ type: 'UNAUTHENTICATED', error: 'Session expired' });
        } else {
          // Transient failure (429, 5xx, or network offline): preserve refresh token in SecureStore!
          // Do NOT publish authenticated state; user profile remains unverified
          this.notifyListeners({
            type: 'PROFILE_UNVERIFIED',
            error: profileErr instanceof Error ? profileErr.message : 'Unable to verify user profile',
          });
        }
      }
    })();

    this.bootstrapPromise = promise;

    try {
      await promise;
    } finally {
      // If session is unauthenticated or unverified, clear bootstrapPromise so future calls can re-attempt
      if (this.sessionGenerationId === opGen && !this.isAuthenticated()) {
        this.bootstrapPromise = null;
      }
    }
  }

  /**
   * Single-flight token refresh mutex.
   * If a refresh is already in-flight, returns the existing Promise.
   * Queues concurrent callers and replays them upon successful rotation.
   */
  acquireFreshAccessToken(): Promise<string> {
    // If a refresh is already in progress, return the existing promise
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    const opGen = this.sessionGenerationId;
    this.isRefreshing = true;

    let currentRefreshPromise: Promise<string> | null = null;
    currentRefreshPromise = (async (): Promise<string> => {
      try {
        // Step 1: Read existing refresh token
        const existingRefreshToken = await secureStorage.getRefreshToken().catch(() => null);

        if (opGen !== this.sessionGenerationId) {
          throw new ApiError(401, 'Session logged out during refresh');
        }

        if (!existingRefreshToken) {
          throw new ApiError(401, 'No refresh token available');
        }

        // Step 2 & 3: Dispatch refresh request and receive replacement tokens
        const response = await authApi.refresh(existingRefreshToken);

        // Generation guard immediately after network return
        if (opGen !== this.sessionGenerationId) {
          // Best-effort revocation of orphaned replacement tokens issued by backend
          authApi
            .logout({
              refreshToken: response.refreshToken,
              accessToken: response.accessToken,
            })
            .catch(() => {});
          throw new ApiError(401, 'Session logged out during refresh');
        }

        // Step 4: Persist replacement refresh token FIRST
        await secureStorage.setRefreshToken(response.refreshToken);

        // Generation guard immediately after storage write
        if (opGen !== this.sessionGenerationId) {
          authApi
            .logout({
              refreshToken: response.refreshToken,
              accessToken: response.accessToken,
            })
            .catch(() => {});
          throw new ApiError(401, 'Session logged out during refresh');
        }

        // Update in-memory access token
        this.inMemoryAccessToken = response.accessToken;

        // Drain queued requests successfully
        this.drainFailedQueue(null, response.accessToken);
        this.notifyListeners({ type: 'TOKEN_REFRESHED' });

        return response.accessToken;
      } catch (error: unknown) {
        // STALE OPERATION GUARD: If generation changed, do NOT mutate state, storage, or queues!
        if (opGen !== this.sessionGenerationId) {
          throw error;
        }

        // Error Classification Protocol (Stage 2 Resilience)
        if (this.isDefinitiveAuthFailure(error)) {
          // Confirmed 401 rejection: token expired or revoked -> delete from SecureStore
          await secureStorage.clearRefreshToken();
          this.inMemoryAccessToken = null;
          this.currentUser = null;
          this.drainFailedQueue(error);
          this.notifyListeners({ type: 'UNAUTHENTICATED', error: (error as ApiError).message });
        } else if (error instanceof ApiError && error.statusCode === 429) {
          // Confirmed 429 rate limit: preserve token in SecureStore, do not retry immediately
          this.drainFailedQueue(error);
        } else if (this.isTransientOrIndeterminateFailure(error)) {
          // TRANSIENT OR INDETERMINATE FAILURE: Timeout (status 0), 500, 502, 503, 504, or network drop
          // PRESERVE the refresh token in SecureStore! Do NOT clear credentials.
          // Do NOT mark user permanently unauthenticated (no UNAUTHENTICATED event).
          // Drain queued requests with the transient error so in-flight callers receive the failure.
          this.drainFailedQueue(error);
        } else {
          // General failure: preserve SecureStore, drain queue
          this.drainFailedQueue(error);
        }

        throw error;
      } finally {
        // ONLY clear refresh lock if it still belongs to THIS exact operation & generation
        if (this.sessionGenerationId === opGen && this.refreshPromise === currentRefreshPromise) {
          this.isRefreshing = false;
          this.refreshPromise = null;
        }
      }
    })();

    this.refreshPromise = currentRefreshPromise;
    return currentRefreshPromise;
  }

  /**
   * Safely retries profile verification using the existing in-memory access token.
   * Does NOT call POST /api/auth/refresh, conserving refresh tokens.
   */
  async retryProfileVerification(): Promise<SafeUser> {
    if (!this.inMemoryAccessToken) {
      throw new ApiError(401, 'No active access token to verify profile');
    }

    const opGen = this.sessionGenerationId;
    try {
      const user = await authApi.getProfile(this.inMemoryAccessToken);

      if (opGen !== this.sessionGenerationId) {
        throw new ApiError(401, 'Session logged out');
      }

      this.currentUser = user;
      this.notifyListeners({ type: 'AUTHENTICATED', user });
      return user;
    } catch (err: unknown) {
      // Stale operation guard: If generation changed, do NOT mutate state, storage, or notify!
      if (opGen !== this.sessionGenerationId) {
        throw err;
      }

      if (err instanceof ApiError && (err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 404)) {
        await secureStorage.clearRefreshToken();
        this.inMemoryAccessToken = null;
        this.currentUser = null;
        this.notifyListeners({ type: 'UNAUTHENTICATED', error: 'Session expired' });
      }
      throw err;
    }
  }

  /**
   * Enqueues a request waiting for an in-flight token refresh.
   */
  enqueueRequest(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.failedQueue.push({ resolve, reject });
    });
  }

  /**
   * Authenticates user with credentials and initializes session persistence.
   * Handles late response discard and best-effort backend session revocation.
   */
  async login(payload: LoginPayload): Promise<LoginResponse> {
    const opGen = this.sessionGenerationId;

    const response = await authApi.login(payload);

    // Stale response check: user logged out or navigated away during in-flight login
    if (opGen !== this.sessionGenerationId) {
      // Best-effort backend revocation of orphaned session
      authApi
        .logout({
          refreshToken: response.refreshToken,
          accessToken: response.accessToken,
        })
        .catch(() => {});

      throw new ApiError(401, 'Login aborted: Session logged out');
    }

    // Persist refresh token to SecureStore
    try {
      await secureStorage.setRefreshToken(response.refreshToken);
    } catch (storageErr) {
      // Roll back on storage persistence failure
      this.inMemoryAccessToken = null;
      this.currentUser = null;
      throw new ApiError(0, 'Failed to securely store session credentials on device.');
    }

    // Re-verify generation after asynchronous storage write
    if (opGen !== this.sessionGenerationId) {
      authApi
        .logout({
          refreshToken: response.refreshToken,
          accessToken: response.accessToken,
        })
        .catch(() => {});

      throw new ApiError(401, 'Login aborted: Session logged out');
    }

    // Commit in-memory state
    this.inMemoryAccessToken = response.accessToken;
    this.currentUser = response.user;

    this.notifyListeners({ type: 'AUTHENTICATED', user: response.user });
    return response;
  }

  /**
   * Synchronous Zero-Yield Logout with Full Invariant Guarantees (Version 3.4.0)
   * Steps 1-4 execute synchronously in the exact same microtask tick before ANY await.
   */
  async logout(): Promise<void> {
    // Step 1: Capture in-memory access token synchronously before clearing
    const accessTokenToRevoke = this.inMemoryAccessToken;

    // Step 2: IMMEDIATELY and synchronously increment sessionGenerationId BEFORE ANY AWAIT
    this.sessionGenerationId++;

    // Step 3: Synchronously clear in-memory credentials and active session state
    this.inMemoryAccessToken = null;
    this.currentUser = null;
    this.isRefreshing = false;
    this.refreshPromise = null;
    this.bootstrapPromise = null;

    // Step 4: Synchronously drain and reject all requests waiting in the refresh queue
    const logoutError = new ApiError(401, 'Session logged out');
    this.drainFailedQueue(logoutError);

    // Step 5: Read existing refresh token from SecureStore for best-effort backend revocation
    const tokenToRevoke = await secureStorage.getRefreshToken().catch(() => null);

    // Step 6: AWAIT serialized SecureStore cleanup (storageEpoch increment + deleteItemAsync)
    await secureStorage.clearRefreshToken();

    // Step 7: Notify UI subscribers of unauthenticated state
    this.notifyListeners({ type: 'UNAUTHENTICATED' });

    // Step 8: Send best-effort backend logout using captured credentials
    if (accessTokenToRevoke) {
      authApi
        .logout({
          refreshToken: tokenToRevoke || undefined,
          accessToken: accessTokenToRevoke,
        })
        .catch(() => {
          // Backend network drop or failure must never delay or restore local logout
        });
    }
  }

  /**
   * Internal test helper to reset singleton state between unit tests.
   */
  _resetForTesting(): void {
    this.inMemoryAccessToken = null;
    this.currentUser = null;
    this.isRefreshing = false;
    this.refreshPromise = null;
    this.failedQueue = [];
    this.sessionGenerationId = 0;
    this.listeners.clear();
    this.bootstrapPromise = null;
  }
}

/**
 * Singleton instance of SessionManager.
 */
export const sessionManager = new SessionManager();

