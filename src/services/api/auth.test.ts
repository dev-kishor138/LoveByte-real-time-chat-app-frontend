import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { authApi } from './auth.ts';
import { rawAuthTransport } from './transport.ts';
import { sessionManager } from '../auth/sessionManager.ts';
import { ApiError } from './types.ts';

describe('Auth API Service (Stage 2B)', () => {
  const originalPost = rawAuthTransport.post;
  const originalGet = rawAuthTransport.get;

  beforeEach(() => {
    sessionManager._resetForTesting();
  });

  afterEach(() => {
    rawAuthTransport.post = originalPost;
    rawAuthTransport.get = originalGet;
    sessionManager._resetForTesting();
  });

  describe('authApi.register', () => {
    it('normalizes email and preserves password verbatim', async () => {
      let capturedUrl = '';
      let capturedPayload: any = null;

      rawAuthTransport.post = (async (url: string, data?: any) => {
        capturedUrl = url;
        capturedPayload = data;
        return {
          status: 201,
          data: {
            user: {
              id: 'c1f2e3d4-b5a6-4c7d-8e9f-0a1b2c3d4e5f',
              email: 'sweetheart@gmail.com',
              createdAt: '2026-11-08T10:00:00.000Z',
            },
          },
        };
      }) as any;

      const rawEmail = '  SweetHeart@GMAIL.COM  ';
      const rawPassword = '  P@ssw0rd123!#  '; // Should NOT be trimmed

      const result = await authApi.register({
        email: rawEmail,
        password: rawPassword,
      });

      assert.strictEqual(capturedUrl, '/api/auth/register');
      assert.strictEqual(capturedPayload.email, 'sweetheart@gmail.com');
      assert.strictEqual(capturedPayload.password, rawPassword);
      assert.strictEqual(result.user.email, 'sweetheart@gmail.com');
      assert.strictEqual(result.user.id, 'c1f2e3d4-b5a6-4c7d-8e9f-0a1b2c3d4e5f');
    });

    it('does not store or set any access token on registration', async () => {
      rawAuthTransport.post = (async () => ({
        status: 201,
        data: {
          user: {
            id: 'mock-id',
            email: 'user@gmail.com',
            createdAt: '2026-11-08T10:00:00.000Z',
          },
        },
      })) as any;

      await authApi.register({
        email: 'user@gmail.com',
        password: 'Password123!',
      });

      assert.strictEqual(sessionManager.getAccessToken(), null);
    });
  });

  describe('authApi.login', () => {
    it('sends normalized credentials and returns login response', async () => {
      const mockAccessToken = 'mock-jwt-access-token-12345';
      const mockRefreshToken = 'mock-refresh-token-67890-abcdef';

      let capturedPayload: any = null;

      rawAuthTransport.post = (async (_url: string, data?: any) => {
        capturedPayload = data;
        return {
          status: 200,
          data: {
            user: {
              id: 'user-uuid-1',
              email: 'sweetheart@gmail.com',
              createdAt: '2026-11-08T10:00:00.000Z',
            },
            accessToken: mockAccessToken,
            refreshToken: mockRefreshToken,
          },
        };
      }) as any;

      const rawEmail = '  SweetHeart@GMAIL.COM  ';
      const rawPassword = 'RawPasswordWithSpaces ';

      const result = await authApi.login({
        email: rawEmail,
        password: rawPassword,
      });

      assert.strictEqual(capturedPayload.email, 'sweetheart@gmail.com');
      assert.strictEqual(capturedPayload.password, rawPassword);
      assert.strictEqual(result.accessToken, mockAccessToken);
      assert.strictEqual(result.refreshToken, mockRefreshToken);
      assert.strictEqual(result.user.email, 'sweetheart@gmail.com');
    });
  });

  describe('authApi.refresh', () => {
    it('dispatches refresh request with exact payload schema', async () => {
      let capturedUrl = '';
      let capturedPayload: any = null;

      rawAuthTransport.post = (async (url: string, data?: any) => {
        capturedUrl = url;
        capturedPayload = data;
        return {
          status: 200,
          data: {
            accessToken: 'new-acc-token-999',
            refreshToken: 'new-ref-token-888',
          },
        };
      }) as any;

      const result = await authApi.refresh('existing-ref-token-111');

      assert.strictEqual(capturedUrl, '/api/auth/refresh');
      assert.strictEqual(capturedPayload.refreshToken, 'existing-ref-token-111');
      assert.strictEqual(result.accessToken, 'new-acc-token-999');
      assert.strictEqual(result.refreshToken, 'new-ref-token-888');
    });
  });

  describe('authApi.logout', () => {
    it('dispatches logout request with Bearer authorization and refreshToken payload', async () => {
      let capturedUrl = '';
      let capturedBody: any = null;
      let capturedConfig: any = null;

      rawAuthTransport.post = (async (url: string, data?: any, config?: any) => {
        capturedUrl = url;
        capturedBody = data;
        capturedConfig = config;
        return {
          status: 200,
          data: { message: 'Logged out successfully' },
        };
      }) as any;

      const result = await authApi.logout({
        accessToken: 'valid-access-token',
        refreshToken: 'valid-refresh-token',
      });

      assert.strictEqual(capturedUrl, '/api/auth/logout');
      assert.strictEqual(capturedBody.refreshToken, 'valid-refresh-token');
      assert.strictEqual(capturedConfig?.headers?.Authorization, 'Bearer valid-access-token');
      assert.strictEqual(capturedConfig?.timeout, 3000);
      assert.strictEqual(result.message, 'Logged out successfully');
    });

    it('omits Authorization header when accessToken is absent', async () => {
      let capturedConfig: any = null;

      rawAuthTransport.post = (async (_url: string, _data?: any, config?: any) => {
        capturedConfig = config;
        return { status: 200, data: { message: 'Logged out' } };
      }) as any;

      await authApi.logout({});
      assert.strictEqual(capturedConfig?.headers?.Authorization, undefined);
    });
  });

  describe('authApi.getProfile', () => {
    it('sends explicit Authorization header and returns user profile', async () => {
      let capturedUrl = '';
      let capturedConfig: any = null;

      rawAuthTransport.get = (async (url: string, config?: any) => {
        capturedUrl = url;
        capturedConfig = config;
        return {
          status: 200,
          data: {
            user: {
              id: 'user-uuid-123',
              email: 'sweetheart@gmail.com',
              createdAt: '2026-11-08T10:00:00.000Z',
              displayName: 'Sweetheart',
            },
          },
        };
      }) as any;

      const user = await authApi.getProfile('test-access-token-123');

      assert.strictEqual(capturedUrl, '/api/auth/me');
      assert.strictEqual(capturedConfig?.headers?.Authorization, 'Bearer test-access-token-123');
      assert.strictEqual(user.id, 'user-uuid-123');
      assert.strictEqual(user.email, 'sweetheart@gmail.com');
      assert.strictEqual(user.displayName, 'Sweetheart');
    });
  });

  describe('API Error Handling and Mapping', () => {
    it('propagates HTTP 400 validation error with details', async () => {
      rawAuthTransport.post = (async () => {
        throw new ApiError(400, 'Validation failed', [
          { field: 'email', message: 'Registration is restricted to valid @gmail.com addresses' },
        ]);
      }) as any;

      await assert.rejects(
        async () => {
          await authApi.register({ email: 'bad@yahoo.com', password: 'Password123!' });
        },
        (err: ApiError) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.message, 'Validation failed');
          assert.strictEqual(err.details?.length, 1);
          assert.strictEqual(err.details[0].field, 'email');
          return true;
        }
      );
    });

    it('propagates HTTP 401 invalid credentials error', async () => {
      rawAuthTransport.post = (async () => {
        throw new ApiError(401, 'Invalid email or password');
      }) as any;

      await assert.rejects(
        async () => {
          await authApi.login({ email: 'user@gmail.com', password: 'WrongPassword123!' });
        },
        (err: ApiError) => {
          assert.strictEqual(err.statusCode, 401);
          assert.strictEqual(err.message, 'Invalid email or password');
          return true;
        }
      );
    });

    it('propagates HTTP 409 account already exists error', async () => {
      rawAuthTransport.post = (async () => {
        throw new ApiError(409, 'An account with this email already exists');
      }) as any;

      await assert.rejects(
        async () => {
          await authApi.register({ email: 'existing@gmail.com', password: 'Password123!' });
        },
        (err: ApiError) => {
          assert.strictEqual(err.statusCode, 409);
          assert.strictEqual(err.message, 'An account with this email already exists');
          return true;
        }
      );
    });

    it('propagates HTTP 429 rate limit error', async () => {
      rawAuthTransport.post = (async () => {
        throw new ApiError(429, 'Too many authentication attempts, please try again later.');
      }) as any;

      await assert.rejects(
        async () => {
          await authApi.login({ email: 'user@gmail.com', password: 'Password123!' });
        },
        (err: ApiError) => {
          assert.strictEqual(err.statusCode, 429);
          assert.strictEqual(err.message, 'Too many authentication attempts, please try again later.');
          return true;
        }
      );
    });

    it('propagates network disconnect (status 0) error', async () => {
      rawAuthTransport.post = (async () => {
        throw new ApiError(0, 'Unable to connect to server. Please check your network connection.');
      }) as any;

      await assert.rejects(
        async () => {
          await authApi.login({ email: 'user@gmail.com', password: 'Password123!' });
        },
        (err: ApiError) => {
          assert.strictEqual(err.statusCode, 0);
          assert.strictEqual(
            err.message,
            'Unable to connect to server. Please check your network connection.'
          );
          return true;
        }
      );
    });
  });
});
