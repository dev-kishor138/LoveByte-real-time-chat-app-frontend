import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { sessionManager } from './sessionManager.ts';
import { authApi, type SafeUser } from '../api/auth.ts';
import { secureStorage } from '../storage/secureStore.ts';
import { ApiError } from '../api/types.ts';

describe('SessionManager (Stage 2B)', () => {
  const originalRefresh = authApi.refresh;
  const originalLogin = authApi.login;
  const originalLogout = authApi.logout;
  const originalGetProfile = authApi.getProfile;

  beforeEach(() => {
    sessionManager._resetForTesting();
    secureStorage._resetForTesting();
  });

  afterEach(() => {
    authApi.refresh = originalRefresh;
    authApi.login = originalLogin;
    authApi.logout = originalLogout;
    authApi.getProfile = originalGetProfile;
    sessionManager._resetForTesting();
    secureStorage._resetForTesting();
  });

  it('1. Single-Flight Refresh Mutex: 5 concurrent calls trigger exactly 1 network refresh call', async () => {
    let networkCallCount = 0;
    await secureStorage.setRefreshToken('initial-refresh-token');

    authApi.refresh = async (token: string) => {
      networkCallCount++;
      return {
        accessToken: `new-access-token-from-${token}`,
        refreshToken: 'rotated-refresh-token-123',
      };
    };

    // Dispatch 5 simultaneous calls to acquireFreshAccessToken
    const promises = [
      sessionManager.acquireFreshAccessToken(),
      sessionManager.acquireFreshAccessToken(),
      sessionManager.acquireFreshAccessToken(),
      sessionManager.acquireFreshAccessToken(),
      sessionManager.acquireFreshAccessToken(),
    ];

    const results = await Promise.all(promises);

    assert.strictEqual(networkCallCount, 1, 'Only 1 network call must be dispatched');
    for (const token of results) {
      assert.strictEqual(token, 'new-access-token-from-initial-refresh-token');
    }
    assert.strictEqual(sessionManager.getAccessToken(), 'new-access-token-from-initial-refresh-token');
    assert.strictEqual(await secureStorage.getRefreshToken(), 'rotated-refresh-token-123');
  });

  it('2. Replay Queue Rejection on 401: When refresh fails with 401, all queued callers reject and SecureStore is wiped', async () => {
    await secureStorage.setRefreshToken('revoked-token');

    authApi.refresh = async () => {
      throw new ApiError(401, 'Invalid or expired refresh token');
    };

    const results = await Promise.allSettled([
      sessionManager.acquireFreshAccessToken(),
      sessionManager.acquireFreshAccessToken(),
      sessionManager.acquireFreshAccessToken(),
    ]);

    for (const res of results) {
      assert.strictEqual(res.status, 'rejected');
      if (res.status === 'rejected') {
        assert.strictEqual((res.reason as ApiError).statusCode, 401);
      }
    }

    assert.strictEqual(await secureStorage.getRefreshToken(), null, 'SecureStore must be cleared on 401');
    assert.strictEqual(sessionManager.getAccessToken(), null);
    assert.strictEqual(sessionManager.isAuthenticated(), false);
  });

  it('3. Recursion Guard: An in-flight refresh failure rejects without triggering another refresh', async () => {
    await secureStorage.setRefreshToken('bad-token');

    let refreshCallCount = 0;
    authApi.refresh = async () => {
      refreshCallCount++;
      throw new ApiError(401, 'Invalid refresh token');
    };

    await assert.rejects(
      sessionManager.acquireFreshAccessToken(),
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );

    assert.strictEqual(refreshCallCount, 1, 'Must not recursively retry refresh');
  });

  it('4. Logout Generation Race Guard (Basic): Calling logout() while refresh is in-flight discards tokens', async () => {
    await secureStorage.setRefreshToken('token-before-logout');

    let notifyRefreshEntered: () => void = () => {};
    const refreshEnteredPromise = new Promise<void>((resolve) => {
      notifyRefreshEntered = resolve;
    });

    let resolveRefresh: (val: any) => void = () => {};
    const refreshDelay = new Promise<any>((resolve) => {
      resolveRefresh = resolve;
    });

    authApi.refresh = async () => {
      notifyRefreshEntered();
      return refreshDelay;
    };

    // Start refresh
    const refreshPromise = sessionManager.acquireFreshAccessToken();
    await refreshEnteredPromise;

    // User logs out while refresh is in flight
    await sessionManager.logout();

    // Now let the refresh resolve late
    resolveRefresh({
      accessToken: 'late-access-token',
      refreshToken: 'late-refresh-token',
    });

    await assert.rejects(
      refreshPromise,
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );

    assert.strictEqual(sessionManager.getAccessToken(), null, 'Late access token must be discarded');
    assert.strictEqual(await secureStorage.getRefreshToken(), null, 'Late refresh token must not be persisted');
  });

  it('5. Storage Failure Rollback on Login: Storage error rolls back memory and keeps session unauthenticated', async () => {
    authApi.login = async () => ({
      user: { id: 'u1', email: 'user@gmail.com', createdAt: '2026-11-08' },
      accessToken: 'acc-1',
      refreshToken: 'ref-1',
    });

    // Mock driver to throw on setItemAsync
    secureStorage._setDriverForTesting({
      setItemAsync: async () => {
        throw new Error('KeyStore hardware unavailable');
      },
      getItemAsync: async () => null,
      deleteItemAsync: async () => {},
      isAvailableAsync: async () => true,
    });

    await assert.rejects(
      async () => {
        await sessionManager.login({ email: 'user@gmail.com', password: 'Password123!' });
      },
      (err: ApiError) => {
        assert.strictEqual(err.message, 'Failed to securely store session credentials on device.');
        return true;
      }
    );

    assert.strictEqual(sessionManager.getAccessToken(), null, 'Memory must roll back');
    assert.strictEqual(sessionManager.getUser(), null);
    assert.strictEqual(sessionManager.isAuthenticated(), false);
  });

  it('6. Rate Limit (429) Response Preservation: Rate limit preserves refresh token in SecureStore without clearing', async () => {
    await secureStorage.setRefreshToken('valid-ratelimit-token');

    authApi.refresh = async () => {
      throw new ApiError(429, 'Too many requests, try again later');
    };

    await assert.rejects(
      sessionManager.acquireFreshAccessToken(),
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 429);
        return true;
      }
    );

    // 429 is a confirmed server rejection before rotation -> preserve token
    assert.strictEqual(
      await secureStorage.getRefreshToken(),
      'valid-ratelimit-token',
      'Token must be preserved on 429'
    );
  });

  it('7. Network Timeout (Status 0) Token Preservation: In-flight timeout preserves SecureStore token and does NOT emit UNAUTHENTICATED', async () => {
    await secureStorage.setRefreshToken('token-that-timed-out');

    const emittedEvents: string[] = [];
    const unsubscribe = sessionManager.subscribe((event) => {
      emittedEvents.push(event.type);
    });

    authApi.refresh = async () => {
      // Simulate status 0 timeout
      throw new ApiError(0, 'Request timed out');
    };

    await assert.rejects(
      sessionManager.acquireFreshAccessToken(),
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 0);
        return true;
      }
    );

    unsubscribe();

    assert.strictEqual(
      await secureStorage.getRefreshToken(),
      'token-that-timed-out',
      'Timeout must preserve refresh token in SecureStore'
    );
    assert.strictEqual(
      emittedEvents.includes('UNAUTHENTICATED'),
      false,
      'Must NOT emit UNAUTHENTICATED on timeout'
    );
  });

  it('8. Gateway Error (502 Bad Gateway) Token Preservation: Ambiguous gateway errors preserve SecureStore token and do NOT emit UNAUTHENTICATED', async () => {
    await secureStorage.setRefreshToken('token-gateway-error');

    const emittedEvents: string[] = [];
    const unsubscribe = sessionManager.subscribe((event) => {
      emittedEvents.push(event.type);
    });

    authApi.refresh = async () => {
      // Simulate status 502 Bad Gateway (e.g. Render spinning up)
      throw new ApiError(502, 'Bad Gateway');
    };

    await assert.rejects(
      sessionManager.acquireFreshAccessToken(),
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 502);
        return true;
      }
    );

    unsubscribe();

    assert.strictEqual(
      await secureStorage.getRefreshToken(),
      'token-gateway-error',
      '502 Bad Gateway must preserve refresh token in SecureStore'
    );
    assert.strictEqual(
      emittedEvents.includes('UNAUTHENTICATED'),
      false,
      'Must NOT emit UNAUTHENTICATED on 502 Bad Gateway'
    );
  });

  it('8b. Server Error (503 Service Unavailable / 504 Gateway Timeout) Token Preservation: 503 and 504 errors preserve SecureStore token', async () => {
    // Part 1: 503 Service Unavailable
    await secureStorage.setRefreshToken('token-503-test');

    const emittedEvents: string[] = [];
    const unsubscribe = sessionManager.subscribe((event) => {
      emittedEvents.push(event.type);
    });

    authApi.refresh = async () => {
      throw new ApiError(503, 'Service Unavailable');
    };

    await assert.rejects(
      sessionManager.acquireFreshAccessToken(),
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 503);
        return true;
      }
    );

    assert.strictEqual(
      await secureStorage.getRefreshToken(),
      'token-503-test',
      '503 Service Unavailable must preserve token'
    );
    assert.strictEqual(emittedEvents.includes('UNAUTHENTICATED'), false);

    // Part 2: 504 Gateway Timeout
    await secureStorage.setRefreshToken('token-504-test');

    authApi.refresh = async () => {
      throw new ApiError(504, 'Gateway Timeout');
    };

    await assert.rejects(
      sessionManager.acquireFreshAccessToken(),
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 504);
        return true;
      }
    );

    unsubscribe();

    assert.strictEqual(
      await secureStorage.getRefreshToken(),
      'token-504-test',
      '504 Gateway Timeout must preserve token'
    );
    assert.strictEqual(emittedEvents.includes('UNAUTHENTICATED'), false);
  });

  it('8c. Bootstrap Transient Failure Protection: Bootstrap with network timeout / 5xx error preserves SecureStore token, emits PROFILE_UNVERIFIED, and does NOT emit UNAUTHENTICATED', async () => {
    await secureStorage.setRefreshToken('bootstrap-cold-start-token');

    const emittedEvents: string[] = [];
    const unsubscribe = sessionManager.subscribe((event) => {
      emittedEvents.push(event.type);
    });

    authApi.refresh = async () => {
      throw new ApiError(502, 'Bad Gateway - Render Cold Start');
    };

    await sessionManager.bootstrap();

    unsubscribe();

    assert.strictEqual(
      await secureStorage.getRefreshToken(),
      'bootstrap-cold-start-token',
      'SecureStore token must be preserved when bootstrap encounters 502'
    );
    assert.strictEqual(
      emittedEvents.includes('UNAUTHENTICATED'),
      false,
      'Must NOT emit UNAUTHENTICATED during transient bootstrap failure'
    );
    assert.strictEqual(
      emittedEvents.includes('PROFILE_UNVERIFIED'),
      true,
      'Must emit PROFILE_UNVERIFIED during transient bootstrap failure'
    );
    assert.strictEqual(sessionManager.isAuthenticated(), false);
    assert.strictEqual(await sessionManager.hasPersistedSession(), true);
  });

  it('8d. Rotating Token Safety: Transient refresh failure does NOT trigger automatic unsafe retry loop (exactly 1 network call made)', async () => {
    await secureStorage.setRefreshToken('single-attempt-token');

    let refreshCallCount = 0;
    authApi.refresh = async () => {
      refreshCallCount++;
      throw new ApiError(0, 'Cold start timeout');
    };

    await assert.rejects(
      sessionManager.acquireFreshAccessToken(),
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 0);
        return true;
      }
    );

    assert.strictEqual(
      refreshCallCount,
      1,
      'SessionManager must make at most 1 attempt and never automatically loop-retry with the same rotating token'
    );
    assert.strictEqual(await secureStorage.getRefreshToken(), 'single-attempt-token');
  });

  it('8e. Bootstrap Retry Recovery: Clearing failed bootstrap allows subsequent bootstrap attempt when backend wakes up', async () => {
    await secureStorage.setRefreshToken('recovering-token');

    let attempt = 0;
    authApi.refresh = async () => {
      attempt++;
      if (attempt === 1) {
        throw new ApiError(0, 'Network offline');
      }
      return {
        accessToken: 'recovered-access-token',
        refreshToken: 'recovered-refresh-token',
      };
    };

    authApi.getProfile = async () => ({
      id: 'u-rec',
      email: 'user@gmail.com',
      createdAt: '2026-11-10',
    });

    // Attempt 1: Offline / cold start
    await sessionManager.bootstrap();
    assert.strictEqual(sessionManager.isAuthenticated(), false);
    assert.strictEqual(await secureStorage.getRefreshToken(), 'recovering-token');

    // Attempt 2: Server recovered / online
    await sessionManager.bootstrap();
    assert.strictEqual(sessionManager.isAuthenticated(), true);
    assert.strictEqual(sessionManager.getAccessToken(), 'recovered-access-token');
    assert.strictEqual(await secureStorage.getRefreshToken(), 'recovered-refresh-token');
    assert.strictEqual(sessionManager.getUser()?.email, 'user@gmail.com');
  });

  it('9. Profile Verification 401 Terminal Rejection: 401 on /me wipes SecureStore and clears memory', async () => {
    await secureStorage.setRefreshToken('token-before-bootstrap');

    authApi.refresh = async () => ({
      accessToken: 'brand-new-acc-token',
      refreshToken: 'brand-new-ref-token',
    });

    authApi.getProfile = async () => {
      throw new ApiError(401, 'Session revoked');
    };

    await sessionManager.bootstrap();

    assert.strictEqual(await secureStorage.getRefreshToken(), null, 'SecureStore must be wiped on /me 401');
    assert.strictEqual(sessionManager.getAccessToken(), null);
    assert.strictEqual(sessionManager.getUser(), null);
    assert.strictEqual(sessionManager.isAuthenticated(), false);
  });

  it('10. Profile Verification Transient Failure & Safe Retry: 500 on /me preserves refresh token and allows direct retry', async () => {
    await secureStorage.setRefreshToken('persisted-token');

    authApi.refresh = async () => ({
      accessToken: 'acc-500',
      refreshToken: 'ref-persisted-500',
    });

    let profileCalls = 0;
    authApi.getProfile = async () => {
      profileCalls++;
      if (profileCalls === 1) {
        throw new ApiError(500, 'Database connection error');
      }
      return {
        id: 'u1',
        email: 'user@gmail.com',
        createdAt: '2026-11-08',
      };
    };

    await sessionManager.bootstrap();

    // Token must remain safely saved in SecureStore!
    assert.strictEqual(
      await secureStorage.getRefreshToken(),
      'ref-persisted-500',
      'Refresh token must be preserved on transient 500'
    );
    // Authenticated state is NOT published yet because profile failed
    assert.strictEqual(sessionManager.isAuthenticated(), false);

    let refreshCalledOnRetry = false;
    authApi.refresh = async () => {
      refreshCalledOnRetry = true;
      return { accessToken: 'should-not-be-called', refreshToken: 'nope' };
    };

    // Safe retry: calls /me using existing access token without rotating refresh token
    const user = await sessionManager.retryProfileVerification();

    assert.strictEqual(user.email, 'user@gmail.com');
    assert.strictEqual(refreshCalledOnRetry, false, 'Retry must not rotate refresh token again');
    assert.strictEqual(sessionManager.isAuthenticated(), true);
  });

  it('11. Late Login Response Discard & Revocation: Login resolving after logout is discarded and revoked', async () => {
    let resolveLogin: (res: any) => void = () => {};
    const loginDelay = new Promise<any>((resolve) => {
      resolveLogin = resolve;
    });

    authApi.login = async () => loginDelay;

    let revokedAccessToken = '';
    let revokedRefreshToken = '';
    authApi.logout = async (options) => {
      revokedAccessToken = options?.accessToken || '';
      revokedRefreshToken = options?.refreshToken || '';
      return { message: 'Logged out' };
    };

    // 1. Dispatch login
    const loginPromise = sessionManager.login({ email: 'user@gmail.com', password: 'Password123!' });

    // 2. User logs out before login finishes
    await sessionManager.logout();

    // 3. Login returns late with tokens
    resolveLogin({
      user: { id: 'u1', email: 'user@gmail.com', createdAt: '2026-11-08' },
      accessToken: 'stale-login-acc',
      refreshToken: 'stale-login-ref',
    });

    await assert.rejects(
      loginPromise,
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );

    assert.strictEqual(sessionManager.getAccessToken(), null, 'Stale token must not be stored');
    assert.strictEqual(await secureStorage.getRefreshToken(), null);
    assert.strictEqual(sessionManager.isAuthenticated(), false);
    assert.strictEqual(revokedAccessToken, 'stale-login-acc', 'Best-effort revocation must send access token');
    assert.strictEqual(revokedRefreshToken, 'stale-login-ref', 'Best-effort revocation must send refresh token');
  });

  it('12. Logout Completion Guarantee Invariant: Delayed write queued before logout settles to null', async () => {
    let resolveSlowWrite: () => void = () => {};
    const slowWriteGate = new Promise<void>((resolve) => {
      resolveSlowWrite = resolve;
    });

    const mockStorageMap = new Map<string, string>();
    secureStorage._setDriverForTesting({
      setItemAsync: async (key, val) => {
        await slowWriteGate;
        mockStorageMap.set(key, val);
      },
      getItemAsync: async (key) => mockStorageMap.get(key) ?? null,
      deleteItemAsync: async (key) => {
        mockStorageMap.delete(key);
      },
      isAvailableAsync: async () => true,
    });

    // Start slow write
    const pendingWrite = secureStorage.setRefreshToken('stale-token-will-be-overwritten');

    // Concurrently trigger logout
    const logoutPromise = sessionManager.logout();

    // Release slow write
    resolveSlowWrite();

    await logoutPromise;
    await pendingWrite;

    // After logout resolves, storage MUST be strictly null
    assert.strictEqual(await secureStorage.getRefreshToken(), null);
    assert.strictEqual(sessionManager.getAccessToken(), null);
    assert.strictEqual(sessionManager.getUser(), null);
  });

  it('13. Double Logout Idempotency: Rapid multiple logouts complete safely', async () => {
    (sessionManager as any).inMemoryAccessToken = 'active-token';
    await secureStorage.setRefreshToken('active-refresh');

    await Promise.all([
      sessionManager.logout(),
      sessionManager.logout(),
      sessionManager.logout(),
    ]);

    assert.strictEqual(sessionManager.getAccessToken(), null);
    assert.strictEqual(await secureStorage.getRefreshToken(), null);
    assert.strictEqual(sessionManager.isAuthenticated(), false);
  });

  it('14. Cross-Session Race: Stale Refresh Success: User A refresh returning after User B login does not overwrite User B', async () => {
    // 1. User A authenticated (generation 0)
    (sessionManager as any).inMemoryAccessToken = 'tokenA-access-1';
    (sessionManager as any).currentUser = { id: 'uA', email: 'userA@gmail.com', createdAt: '2026-11-01' };
    await secureStorage.setRefreshToken('tokenA-refresh-1');

    let notifyRefreshEntered: () => void = () => {};
    const refreshEnteredPromise = new Promise<void>((resolve) => {
      notifyRefreshEntered = resolve;
    });

    let resolveRefreshA: (res: any) => void = () => {};
    const refreshGateA = new Promise<any>((resolve) => {
      resolveRefreshA = resolve;
    });

    authApi.refresh = async () => {
      notifyRefreshEntered();
      return refreshGateA;
    };

    const logoutCalls: any[] = [];
    authApi.logout = async (options) => {
      logoutCalls.push(options);
      return { message: 'Logged out' };
    };

    // User A starts refresh
    const refreshPromiseA = sessionManager.acquireFreshAccessToken();

    // Ensure refresh HTTP call is actively in flight
    await refreshEnteredPromise;

    // User A logs out -> generation becomes 1, storage cleared, memory wiped
    await sessionManager.logout();

    // User B logs in -> generation 1
    authApi.login = async () => ({
      user: { id: 'uB', email: 'userB@gmail.com', createdAt: '2026-11-09' },
      accessToken: 'tokenB-access-1',
      refreshToken: 'tokenB-refresh-1',
    });

    await sessionManager.login({ email: 'userB@gmail.com', password: 'Password123!' });

    // Verify User B is active
    assert.strictEqual(sessionManager.getAccessToken(), 'tokenB-access-1');
    assert.strictEqual(sessionManager.getUser()?.email, 'userB@gmail.com');
    assert.strictEqual(await secureStorage.getRefreshToken(), 'tokenB-refresh-1');
    assert.strictEqual(sessionManager.isAuthenticated(), true);

    // Stale User A refresh returns late with replacement tokens
    resolveRefreshA({
      accessToken: 'tokenA-access-2-stale',
      refreshToken: 'tokenA-refresh-2-stale',
    });

    await assert.rejects(
      refreshPromiseA,
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );

    // CRITICAL ASSERTIONS: User B's state MUST REMAIN STRICTLY UNTOUCHED!
    assert.strictEqual(sessionManager.getAccessToken(), 'tokenB-access-1', 'User B access token must not be overwritten');
    assert.strictEqual(sessionManager.getUser()?.email, 'userB@gmail.com', 'User B profile must not be overwritten');
    assert.strictEqual(await secureStorage.getRefreshToken(), 'tokenB-refresh-1', 'User B refresh token must not be wiped');
    assert.strictEqual(sessionManager.isAuthenticated(), true, 'User B must remain authenticated');

    // Revocation of orphaned User A tokens must have occurred with User A's credentials only
    const staleRevocation = logoutCalls.find(
      (c) => c?.accessToken === 'tokenA-access-2-stale'
    );
    assert.ok(staleRevocation, 'Orphaned User A replacement tokens must be revoked');
    assert.strictEqual(staleRevocation.refreshToken, 'tokenA-refresh-2-stale');
  });

  it('15. Cross-Session Race: Stale Refresh 401 Rejection: User A refresh 401 does not wipe User B credentials', async () => {
    (sessionManager as any).inMemoryAccessToken = 'tokenA-access-1';
    await secureStorage.setRefreshToken('tokenA-refresh-1');

    let notifyRefreshEntered: () => void = () => {};
    const refreshEnteredPromise = new Promise<void>((resolve) => {
      notifyRefreshEntered = resolve;
    });

    let rejectRefreshA: (err: any) => void = () => {};
    const refreshGateA = new Promise<any>((_, reject) => {
      rejectRefreshA = reject;
    });

    authApi.refresh = async () => {
      notifyRefreshEntered();
      return refreshGateA;
    };

    // User A starts refresh
    const refreshPromiseA = sessionManager.acquireFreshAccessToken();
    await refreshEnteredPromise;

    // User A logs out
    await sessionManager.logout();

    // User B logs in
    authApi.login = async () => ({
      user: { id: 'uB', email: 'userB@gmail.com', createdAt: '2026-11-09' },
      accessToken: 'tokenB-access-active',
      refreshToken: 'tokenB-refresh-active',
    });
    await sessionManager.login({ email: 'userB@gmail.com', password: 'Password123!' });

    // User A refresh rejects with 401
    rejectRefreshA(new ApiError(401, 'Invalid or expired token for User A'));

    await assert.rejects(
      refreshPromiseA,
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );

    // User B state must remain intact
    assert.strictEqual(sessionManager.getAccessToken(), 'tokenB-access-active', 'User B access token must not be wiped');
    assert.strictEqual(await secureStorage.getRefreshToken(), 'tokenB-refresh-active', 'User B refresh token must not be wiped');
    assert.strictEqual(sessionManager.isAuthenticated(), true);
  });

  it('16. Cross-Session Race: Stale Refresh Indeterminate Failure: User A refresh timeout does not wipe User B credentials', async () => {
    (sessionManager as any).inMemoryAccessToken = 'tokenA-access-1';
    await secureStorage.setRefreshToken('tokenA-refresh-1');

    let notifyRefreshEntered: () => void = () => {};
    const refreshEnteredPromise = new Promise<void>((resolve) => {
      notifyRefreshEntered = resolve;
    });

    let rejectRefreshA: (err: any) => void = () => {};
    const refreshGateA = new Promise<any>((_, reject) => {
      rejectRefreshA = reject;
    });

    authApi.refresh = async () => {
      notifyRefreshEntered();
      return refreshGateA;
    };

    const refreshPromiseA = sessionManager.acquireFreshAccessToken();
    await refreshEnteredPromise;

    await sessionManager.logout();

    authApi.login = async () => ({
      user: { id: 'uB', email: 'userB@gmail.com', createdAt: '2026-11-09' },
      accessToken: 'tokenB-access-timeout-test',
      refreshToken: 'tokenB-refresh-timeout-test',
    });
    await sessionManager.login({ email: 'userB@gmail.com', password: 'Password123!' });

    // User A refresh times out (status 0)
    rejectRefreshA(new ApiError(0, 'Network timeout during User A refresh'));

    await assert.rejects(
      refreshPromiseA,
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 0);
        return true;
      }
    );

    // User B state must remain intact
    assert.strictEqual(sessionManager.getAccessToken(), 'tokenB-access-timeout-test');
    assert.strictEqual(await secureStorage.getRefreshToken(), 'tokenB-refresh-timeout-test', 'Indeterminate User A failure must not wipe User B');
    assert.strictEqual(sessionManager.isAuthenticated(), true);
  });

  it('17. Cross-Session Race: Stale Refresh Finally Mutex Guard: Stale refresh finally does not unlock new refresh mutex', async () => {
    await secureStorage.setRefreshToken('tokenA-ref-initial');

    let notifyRefreshEnteredA: () => void = () => {};
    const refreshEnteredPromiseA = new Promise<void>((resolve) => {
      notifyRefreshEnteredA = resolve;
    });

    let resolveRefreshA: (res: any) => void = () => {};
    const refreshGateA = new Promise<any>((resolve) => {
      resolveRefreshA = resolve;
    });

    authApi.refresh = async () => {
      notifyRefreshEnteredA();
      return refreshGateA;
    };

    // 1. User A starts refresh
    const refreshPromiseA = sessionManager.acquireFreshAccessToken();
    await refreshEnteredPromiseA;

    // 2. User A logs out
    await sessionManager.logout();

    // 3. User B logs in
    authApi.login = async () => ({
      user: { id: 'uB', email: 'userB@gmail.com', createdAt: '2026-11-09' },
      accessToken: 'tokenB-acc',
      refreshToken: 'tokenB-ref',
    });
    await sessionManager.login({ email: 'userB@gmail.com', password: 'Password123!' });

    // 4. User B starts a new refresh
    let resolveRefreshB: (res: any) => void = () => {};
    const refreshGateB = new Promise<any>((resolve) => {
      resolveRefreshB = resolve;
    });
    authApi.refresh = async () => refreshGateB;

    const refreshPromiseB = sessionManager.acquireFreshAccessToken();

    // Verify User B currently owns the refresh lock
    assert.strictEqual((sessionManager as any).isRefreshing, true);
    assert.strictEqual((sessionManager as any).refreshPromise, refreshPromiseB);

    // 5. User A's slow refresh settles
    resolveRefreshA({ accessToken: 'tokenA-late', refreshToken: 'tokenA-late' });
    await assert.rejects(refreshPromiseA);

    // CRITICAL: User B's mutex must NOT be unlocked by User A's finally!
    assert.strictEqual(
      (sessionManager as any).isRefreshing,
      true,
      'isRefreshing must remain true while User B refresh is pending'
    );
    assert.strictEqual(
      (sessionManager as any).refreshPromise,
      refreshPromiseB,
      'refreshPromise must remain User B promise'
    );

    // 6. User B's refresh completes
    resolveRefreshB({ accessToken: 'tokenB-acc-2', refreshToken: 'tokenB-ref-2' });
    const resultB = await refreshPromiseB;
    assert.strictEqual(resultB, 'tokenB-acc-2');
    assert.strictEqual((sessionManager as any).isRefreshing, false, 'Mutex cleanly released after User B settles');
  });

  it('18. Cross-Session Race: Stale Profile Verification 401 Rejection: User A profile 401 does not wipe User B session', async () => {
    // 1. User A authenticated with token and cached user
    (sessionManager as any).inMemoryAccessToken = 'tokenA-access-profile-test';
    (sessionManager as any).currentUser = { id: 'uA', email: 'userA@gmail.com', createdAt: '2026-11-01' };
    await secureStorage.setRefreshToken('tokenA-refresh-profile-test');

    let notifyProfileEntered: () => void = () => {};
    const profileEnteredPromise = new Promise<void>((resolve) => {
      notifyProfileEntered = resolve;
    });

    let rejectProfileA: (err: any) => void = () => {};
    const profileGateA = new Promise<SafeUser>((_, reject) => {
      rejectProfileA = reject;
    });

    authApi.getProfile = async () => {
      notifyProfileEntered();
      return profileGateA;
    };

    // Track listener events
    const sessionEvents: string[] = [];
    sessionManager.subscribe((ev) => {
      sessionEvents.push(ev.type);
    });

    // User A triggers profile verification retry
    const profilePromiseA = sessionManager.retryProfileVerification();
    await profileEnteredPromise;

    // User A logs out
    await sessionManager.logout();

    // User B logs in
    authApi.login = async () => ({
      user: { id: 'uB', email: 'userB@gmail.com', createdAt: '2026-11-09' },
      accessToken: 'tokenB-access-profile-test',
      refreshToken: 'tokenB-refresh-profile-test',
    });
    await sessionManager.login({ email: 'userB@gmail.com', password: 'Password123!' });

    const eventsAfterLogin = [...sessionEvents];

    // User A's profile verification returns 401 from server
    rejectProfileA(new ApiError(401, 'User A session revoked'));

    await assert.rejects(
      profilePromiseA,
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );

    // CRITICAL ASSERTIONS: User B must not be wiped by User A's 401!
    assert.strictEqual(sessionManager.getAccessToken(), 'tokenB-access-profile-test', 'User B token must remain');
    assert.strictEqual(sessionManager.getUser()?.email, 'userB@gmail.com', 'User B user must remain');
    assert.strictEqual(await secureStorage.getRefreshToken(), 'tokenB-refresh-profile-test', 'User B storage must remain');
    assert.strictEqual(sessionManager.isAuthenticated(), true);

    // Verify zero UNAUTHENTICATED events emitted after User B login
    const eventsAfterOldProfileReject = sessionEvents.slice(eventsAfterLogin.length);
    assert.strictEqual(
      eventsAfterOldProfileReject.includes('UNAUTHENTICATED'),
      false,
      'No UNAUTHENTICATED event must be emitted for User B'
    );
  });

  it('19. Synchronous Logout Invariant (Login & Refresh Races): Synchronous generation increment and zero stale writes', async () => {
    // === PART A: Login Race ===
    let resolveReadDelayA: () => void = () => {};
    const readDelayA = new Promise<void>((resolve) => {
      resolveReadDelayA = resolve;
    });

    let storageSetCalledA = false;
    let delayReadsA = false;
    const testMapA = new Map<string, string>();
    testMapA.set('lovebyte_refresh_token', 'initial-token');

    secureStorage._setDriverForTesting({
      setItemAsync: async (k, v) => {
        storageSetCalledA = true;
        testMapA.set(k, v);
      },
      getItemAsync: async (k) => {
        if (delayReadsA) {
          await readDelayA;
        }
        return testMapA.get(k) ?? null;
      },
      deleteItemAsync: async (k) => {
        testMapA.delete(k);
      },
      isAvailableAsync: async () => true,
    });

    let resolveLogin: (res: any) => void = () => {};
    const loginDelay = new Promise<any>((resolve) => {
      resolveLogin = resolve;
    });
    authApi.login = async () => loginDelay;

    // Start login
    const loginPromise = sessionManager.login({ email: 'user@gmail.com', password: 'Password123!' });

    const genBeforeLogoutA = sessionManager.getGenerationId();

    // Enable read delay for logout's getItemAsync
    delayReadsA = true;

    // Start logout
    const logoutPromiseA = sessionManager.logout();

    // STEP 4 SYNCHRONOUS ASSERTIONS BEFORE ANY ASYNC YIELD:
    assert.strictEqual(
      sessionManager.getGenerationId(),
      genBeforeLogoutA + 1,
      'Step 4 Invariant: sessionGenerationId must increment synchronously in the exact same microtask tick'
    );
    assert.strictEqual(
      sessionManager.getAccessToken(),
      null,
      'Step 3 Invariant: inMemoryAccessToken must be cleared synchronously before any await'
    );

    // Resolve login network call while logout storage read is still deferred
    resolveLogin({
      user: { id: 'u1', email: 'user@gmail.com', createdAt: '2026-11-08' },
      accessToken: 'stale-login-acc',
      refreshToken: 'stale-login-ref',
    });

    await assert.rejects(loginPromise);

    // Release storage read delay so logout finishes
    resolveReadDelayA();
    await logoutPromiseA;

    assert.strictEqual(storageSetCalledA, false, 'Stale login must not initiate storage write');
    assert.strictEqual(await secureStorage.getRefreshToken(), null);

    // === PART B: Refresh Race ===
    sessionManager._resetForTesting();
    secureStorage._resetForTesting();

    let resolveReadDelayB: () => void = () => {};
    const readDelayB = new Promise<void>((resolve) => {
      resolveReadDelayB = resolve;
    });

    let storageSetCalledB = false;
    let delayReadsB = false;
    const testMapB = new Map<string, string>();
    testMapB.set('lovebyte_refresh_token', 'token-before-refresh');

    secureStorage._setDriverForTesting({
      setItemAsync: async (k, v) => {
        storageSetCalledB = true;
        testMapB.set(k, v);
      },
      getItemAsync: async (k) => {
        if (delayReadsB) {
          await readDelayB;
        }
        return testMapB.get(k) ?? null;
      },
      deleteItemAsync: async (k) => {
        testMapB.delete(k);
      },
      isAvailableAsync: async () => true,
    });

    let notifyRefreshEnteredB: () => void = () => {};
    const refreshEnteredPromiseB = new Promise<void>((resolve) => {
      notifyRefreshEnteredB = resolve;
    });

    let resolveRefresh: (res: any) => void = () => {};
    const refreshDelay = new Promise<any>((resolve) => {
      resolveRefresh = resolve;
    });

    authApi.refresh = async () => {
      notifyRefreshEnteredB();
      return refreshDelay;
    };

    // 1. acquireFreshAccessToken reads initial token without delay (delayReadsB is false)
    const refreshPromise = sessionManager.acquireFreshAccessToken();

    // 2. Wait until refresh network call is actively in flight
    await refreshEnteredPromiseB;

    const genBeforeLogoutB = sessionManager.getGenerationId();

    // 3. Enable read delay for logout's getItemAsync
    delayReadsB = true;

    // 4. Start logout
    const logoutPromiseB = sessionManager.logout();

    // STEP 4 SYNCHRONOUS ASSERTION:
    assert.strictEqual(
      sessionManager.getGenerationId(),
      genBeforeLogoutB + 1,
      'Step 4 Invariant: sessionGenerationId must increment synchronously before any await for refresh'
    );

    // 5. While logout's storage read is paused on readDelayB, resolve refresh network call
    resolveRefresh({
      accessToken: 'stale-refresh-acc',
      refreshToken: 'stale-refresh-ref',
    });

    await assert.rejects(refreshPromise);

    // 6. Release read delay so logout finishes
    resolveReadDelayB();
    await logoutPromiseB;

    assert.strictEqual(storageSetCalledB, false, 'Stale refresh must not initiate storage write');
    assert.strictEqual(await secureStorage.getRefreshToken(), null);
  });
});
