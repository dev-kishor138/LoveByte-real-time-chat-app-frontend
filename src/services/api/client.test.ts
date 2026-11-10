import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { type AxiosResponse } from 'axios';
import {
  apiClient,
  setRetryConfigForTesting,
  getRetryConfig,
  isSafeIdempotentMethod,
  isRetryableError,
} from './client.ts';
import { BASE_HTTP_CONFIG, rawAuthTransport } from './transport.ts';
import { sessionManager } from '../auth/sessionManager.ts';
import { authApi } from './auth.ts';
import { secureStorage } from '../storage/secureStore.ts';
import { ApiError } from './types.ts';

describe('Authenticated API Client & Safe Request Retry (Stage 3)', () => {
  const originalRawAdapter = rawAuthTransport.defaults.adapter;

  beforeEach(() => {
    sessionManager._resetForTesting();
    secureStorage._resetForTesting();
    setRetryConfigForTesting({
      sleepFn: async () => {}, // Zero-delay by default in tests for speed
    });
    delete apiClient.defaults.adapter;
    rawAuthTransport.defaults.adapter = originalRawAdapter;
  });

  afterEach(() => {
    sessionManager._resetForTesting();
    secureStorage._resetForTesting();
    setRetryConfigForTesting(null);
    delete apiClient.defaults.adapter;
    rawAuthTransport.defaults.adapter = originalRawAdapter;
  });

  // --- Baseline Authenticated Client Tests (Preserved) ---

  it('1. Injects Bearer access token into outgoing request headers when present', async () => {
    let capturedHeaders: any = null;

    // Stub session manager access token
    (sessionManager as any).inMemoryAccessToken = 'test-bearer-token-123';

    // Intercept with an adapter stub
    apiClient.defaults.adapter = async (config) => {
      capturedHeaders = config.headers;
      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } as AxiosResponse;
    };

    const response = await apiClient.get('/api/test-protected');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(capturedHeaders?.Authorization, 'Bearer test-bearer-token-123');
  });

  it('2. Automatically refreshes token and replays request on 401 response', async () => {
    let callCount = 0;
    let refreshCalled = false;

    // Stub initial token
    (sessionManager as any).inMemoryAccessToken = 'expired-token';

    // Mock acquireFreshAccessToken
    sessionManager.acquireFreshAccessToken = async () => {
      refreshCalled = true;
      (sessionManager as any).inMemoryAccessToken = 'fresh-new-token-456';
      return 'fresh-new-token-456';
    };

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      if (callCount === 1) {
        // First call returns 401
        const error: any = new Error('Request failed with status code 401');
        error.config = config;
        error.response = {
          status: 401,
          data: { error: 'Access token expired' },
          headers: {},
        };
        throw error;
      }

      // Replayed call succeeds with new token
      return {
        data: { replayed: true, authHeader: config.headers?.Authorization },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } as AxiosResponse;
    };

    const response = await apiClient.get('/api/chat/messages');

    assert.strictEqual(callCount, 2, 'Request should have been executed twice (initial + replay)');
    assert.strictEqual(refreshCalled, true, 'acquireFreshAccessToken should have been called');
    assert.strictEqual(response.data.replayed, true);
    assert.strictEqual(response.data.authHeader, 'Bearer fresh-new-token-456');
  });

  it('3. Does not retry infinitely if replayed request returns 401 again', async () => {
    let callCount = 0;

    sessionManager.acquireFreshAccessToken = async () => 'new-token';

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      const error: any = new Error('Unauthorized');
      error.config = config;
      error.response = {
        status: 401,
        data: { error: 'Unauthorized' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await apiClient.get('/api/forbidden-resource');
      },
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );

    // Call count must not exceed 2 (initial request + 1 replay attempt)
    assert.strictEqual(callCount, 2);
  });

  it('4. Passes through non-401 non-retryable errors without triggering token refresh', async () => {
    let refreshTriggered = false;
    sessionManager.acquireFreshAccessToken = async () => {
      refreshTriggered = true;
      return 'should-not-be-called';
    };

    apiClient.defaults.adapter = async (config) => {
      const error: any = new Error('Bad Request');
      error.config = config;
      error.response = {
        status: 400,
        data: { error: 'Validation failed' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await apiClient.post('/api/invalid-data', {});
      },
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );

    assert.strictEqual(refreshTriggered, false, 'Non-401 error must not trigger refresh');
  });

  // --- Stage 3: Request Timeout Configuration ---

  it('5. Request Timeout Configuration: BASE_HTTP_CONFIG and apiClient default timeout is 30000ms', () => {
    assert.strictEqual(
      BASE_HTTP_CONFIG.timeout,
      30000,
      'BASE_HTTP_CONFIG timeout must be 30000ms (30s) for Render cold start resilience'
    );
    assert.strictEqual(
      apiClient.defaults.timeout,
      30000,
      'apiClient timeout must inherit 30000ms'
    );
    assert.strictEqual(
      rawAuthTransport.defaults.timeout,
      30000,
      'rawAuthTransport timeout must inherit 30000ms'
    );
  });

  // --- Stage 3: Safe Idempotent GET Request Retries ---

  it('6. GET Network-Error Retry: Transient network error (no response) is retried and succeeds on attempt 2', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      if (callCount === 1) {
        // Network failure without HTTP response
        const error: any = new Error('Network Error');
        error.config = config;
        error.request = {}; // request initiated but no response received
        throw error;
      }

      return {
        data: { items: ['msg1', 'msg2'] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } as AxiosResponse;
    };

    const response = await apiClient.get('/api/chat/conversations');

    assert.strictEqual(callCount, 2, 'Must retry once after network error and succeed on attempt 2');
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.data, { items: ['msg1', 'msg2'] });
  });

  it('7. GET 502 Bad Gateway Retry: HTTP 502 on GET is retried and succeeds on attempt 2', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      if (callCount === 1) {
        const error: any = new Error('Bad Gateway');
        error.config = config;
        error.response = {
          status: 502,
          data: { error: 'Bad Gateway' },
          headers: {},
        };
        throw error;
      }

      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } as AxiosResponse;
    };

    const response = await apiClient.get('/api/chat/conversations');

    assert.strictEqual(callCount, 2, 'Must retry 502 and succeed on attempt 2');
    assert.strictEqual(response.status, 200);
  });

  it('8. GET 503 Service Unavailable Retry: HTTP 503 on GET is retried and succeeds on attempt 2', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      if (callCount === 1) {
        const error: any = new Error('Service Unavailable');
        error.config = config;
        error.response = {
          status: 503,
          data: { error: 'Service Unavailable' },
          headers: {},
        };
        throw error;
      }

      return {
        data: { status: 'healthy' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } as AxiosResponse;
    };

    const response = await apiClient.get('/api/health');

    assert.strictEqual(callCount, 2, 'Must retry 503 and succeed on attempt 2');
    assert.strictEqual(response.status, 200);
  });

  it('9. GET 504 Gateway Timeout Retry: HTTP 504 on GET is retried and succeeds on attempt 2', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      if (callCount === 1) {
        const error: any = new Error('Gateway Timeout');
        error.config = config;
        error.response = {
          status: 504,
          data: { error: 'Gateway Timeout' },
          headers: {},
        };
        throw error;
      }

      return {
        data: { recovered: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } as AxiosResponse;
    };

    const response = await apiClient.get('/api/chat/conversations/123/messages');

    assert.strictEqual(callCount, 2, 'Must retry 504 and succeed on attempt 2');
    assert.strictEqual(response.status, 200);
  });

  it('10. Maximum Retry-Attempt Enforcement: GET failing 502 is attempted exactly 3 times and then rejects', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      const error: any = new Error('Bad Gateway');
      error.config = config;
      error.response = {
        status: 502,
        data: { error: 'Bad Gateway' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await apiClient.get('/api/chat/conversations');
      },
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 502);
        return true;
      }
    );

    assert.strictEqual(
      callCount,
      3,
      'Must execute exactly 3 attempts in total (1 initial + 2 retries) before giving up'
    );
  });

  it('11. Correct Backoff Timing: Verifies [2000, 4000] ms backoff schedule is passed sequentially', async () => {
    const sleepCalls: number[] = [];

    setRetryConfigForTesting({
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    let callCount = 0;
    apiClient.defaults.adapter = async (config) => {
      callCount++;
      const error: any = new Error('Bad Gateway');
      error.config = config;
      error.response = {
        status: 502,
        data: { error: 'Bad Gateway' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(async () => {
      await apiClient.get('/api/test-timing');
    });

    assert.strictEqual(callCount, 3);
    assert.deepStrictEqual(
      sleepCalls,
      [2000, 4000],
      'Must follow exponential backoff schedule of approximately 2s then 4s'
    );
  });

  it('12. Cancelled Requests Are Not Retried: AbortSignal cancellation prevents retry and rejects immediately', async () => {
    const controller = new AbortController();
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      // Abort during execution
      controller.abort();
      const error: any = new Error('Request canceled');
      error.name = 'CanceledError';
      error.code = 'ERR_CANCELED';
      error.config = config;
      throw error;
    };

    await assert.rejects(
      async () => {
        await apiClient.get('/api/chat/messages', { signal: controller.signal });
      },
      (err: any) => {
        assert.ok(err.name === 'CanceledError' || err.code === 'ERR_CANCELED');
        return true;
      }
    );

    assert.strictEqual(callCount, 1, 'Cancelled request must not be retried');
  });

  // --- Stage 3: Mutation Safety Rules (POST, PUT, PATCH, DELETE are NEVER retried) ---

  it('13. POST Requests Are Never Automatically Retried: POST failure rejects immediately on attempt 1', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      const error: any = new Error('Bad Gateway');
      error.config = config;
      error.response = {
        status: 502,
        data: { error: 'Bad Gateway' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await apiClient.post('/api/chat/messages', { content: 'Hello' });
      },
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 502);
        return true;
      }
    );

    assert.strictEqual(callCount, 1, 'POST mutation must NEVER be automatically retried');
  });

  it('14. PUT Requests Are Never Automatically Retried: PUT failure rejects immediately on attempt 1', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      const error: any = new Error('Service Unavailable');
      error.config = config;
      error.response = {
        status: 503,
        data: { error: 'Service Unavailable' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await apiClient.put('/api/resource/1', { data: 'test' });
      },
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 503);
        return true;
      }
    );

    assert.strictEqual(callCount, 1, 'PUT mutation must NEVER be automatically retried');
  });

  it('15. PATCH Requests Are Never Automatically Retried: PATCH failure rejects immediately on attempt 1', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      const error: any = new Error('Gateway Timeout');
      error.config = config;
      error.response = {
        status: 504,
        data: { error: 'Gateway Timeout' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await apiClient.patch('/api/chat/messages/msg-1', { content: 'Updated' });
      },
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 504);
        return true;
      }
    );

    assert.strictEqual(callCount, 1, 'PATCH mutation must NEVER be automatically retried');
  });

  it('16. DELETE Requests Are Never Automatically Retried: DELETE failure rejects immediately on attempt 1', async () => {
    let callCount = 0;

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      const error: any = new Error('Gateway Timeout');
      error.config = config;
      error.response = {
        status: 504,
        data: { error: 'Gateway Timeout' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await apiClient.delete('/api/chat/messages/msg-1');
      },
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 504);
        return true;
      }
    );

    assert.strictEqual(callCount, 1, 'DELETE mutation must NEVER be automatically retried');
  });

  it('17. Refresh-Token Requests Are Never Automatically Retried: POST /api/auth/refresh failure is not retried', async () => {
    let refreshCalls = 0;

    rawAuthTransport.defaults.adapter = async (config) => {
      refreshCalls++;
      const error: any = new Error('Bad Gateway on Refresh');
      error.config = config;
      error.response = {
        status: 502,
        data: { error: 'Bad Gateway' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(
      async () => {
        await authApi.refresh('dummy-rotating-token');
      },
      (err: ApiError) => {
        assert.strictEqual(err.statusCode, 502);
        return true;
      }
    );

    assert.strictEqual(
      refreshCalls,
      1,
      'POST /api/auth/refresh must NEVER be automatically retried by transport'
    );
  });

  // --- Stage 3: Auth & SecureStore Interoperability ---

  it('18. Replayed 401 GET Request Followed by 502 Is Retried Safely: Full auth + retry pipeline interoperability', async () => {
    let callCount = 0;
    let refreshCount = 0;

    (sessionManager as any).inMemoryAccessToken = 'expired-token';

    sessionManager.acquireFreshAccessToken = async () => {
      refreshCount++;
      (sessionManager as any).inMemoryAccessToken = 'fresh-token-xyz';
      return 'fresh-token-xyz';
    };

    apiClient.defaults.adapter = async (config) => {
      callCount++;
      if (callCount === 1) {
        // Initial call returns 401
        const error: any = new Error('Unauthorized');
        error.config = config;
        error.response = {
          status: 401,
          data: { error: 'Token expired' },
          headers: {},
        };
        throw error;
      }

      if (callCount === 2) {
        // Replayed call with fresh token encounters a 502 (Render waking up)
        assert.strictEqual(config.headers?.Authorization, 'Bearer fresh-token-xyz');
        const error: any = new Error('Bad Gateway');
        error.config = config;
        error.response = {
          status: 502,
          data: { error: 'Bad Gateway' },
          headers: {},
        };
        throw error;
      }

      // Retry of replayed call succeeds
      assert.strictEqual(config.headers?.Authorization, 'Bearer fresh-token-xyz');
      return {
        data: { messages: ['hello'] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } as AxiosResponse;
    };

    const response = await apiClient.get('/api/chat/conversations/conv-1/messages');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(refreshCount, 1, 'Token refresh must occur exactly once');
    assert.strictEqual(callCount, 3, 'Must execute: 1 (initial 401) + 2 (replayed 502) + 3 (retry 200)');
  });

  it('19. SecureStore Credentials Remain Preserved After Transient GET Retries Fail: Does not log user out', async () => {
    await secureStorage.setRefreshToken('secure-persisted-token');
    (sessionManager as any).inMemoryAccessToken = 'valid-access-token';
    (sessionManager as any).currentUser = {
      id: 'u1',
      email: 'user@gmail.com',
      createdAt: '2026-11-10',
    };

    apiClient.defaults.adapter = async (config) => {
      const error: any = new Error('Gateway Timeout');
      error.config = config;
      error.response = {
        status: 504,
        data: { error: 'Gateway Timeout' },
        headers: {},
      };
      throw error;
    };

    await assert.rejects(async () => {
      await apiClient.get('/api/chat/conversations');
    });

    // Verify SecureStore was NOT cleared by GET failures
    assert.strictEqual(
      await secureStorage.getRefreshToken(),
      'secure-persisted-token',
      'SecureStore token must remain intact after GET retries exhaust'
    );
    // Verify user remains authenticated in memory
    assert.strictEqual(sessionManager.isAuthenticated(), true);
  });

  it('20. Helper Functions: isSafeIdempotentMethod and isRetryableError validate correctly', () => {
    assert.strictEqual(isSafeIdempotentMethod('GET'), true);
    assert.strictEqual(isSafeIdempotentMethod('get'), true);
    assert.strictEqual(isSafeIdempotentMethod('POST'), false);
    assert.strictEqual(isSafeIdempotentMethod('PUT'), false);
    assert.strictEqual(isSafeIdempotentMethod('PATCH'), false);
    assert.strictEqual(isSafeIdempotentMethod('DELETE'), false);
    assert.strictEqual(isSafeIdempotentMethod(undefined), false);

    // isRetryableError
    assert.strictEqual(isRetryableError({} as any), true, 'No response is retryable');
    assert.strictEqual(isRetryableError({ response: { status: 502 } } as any), true);
    assert.strictEqual(isRetryableError({ response: { status: 503 } } as any), true);
    assert.strictEqual(isRetryableError({ response: { status: 504 } } as any), true);
    assert.strictEqual(isRetryableError({ response: { status: 500 } } as any), false);
    assert.strictEqual(isRetryableError({ response: { status: 400 } } as any), false);
    assert.strictEqual(isRetryableError({ response: { status: 401 } } as any), false);
    assert.strictEqual(isRetryableError({ response: { status: 403 } } as any), false);
    assert.strictEqual(isRetryableError({ response: { status: 404 } } as any), false);
    assert.strictEqual(isRetryableError({ response: { status: 429 } } as any), false);
    assert.strictEqual(
      isRetryableError({ config: { signal: { aborted: true } } } as any),
      false,
      'Aborted signal is not retryable'
    );
  });
});


