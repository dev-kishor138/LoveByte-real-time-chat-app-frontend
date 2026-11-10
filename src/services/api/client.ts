import axios, {
  type AxiosInstance,
  AxiosError,
  type InternalAxiosRequestConfig,
  type GenericAbortSignal,
} from 'axios';
import { BASE_HTTP_CONFIG, formatApiError } from './transport.ts';
import { sessionManager } from '../auth/sessionManager.ts';
import { type ApiErrorResponse } from './types.ts';

export interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean; // Auth 401 refresh replay flag
  _retryCount?: number; // Safe GET retry counter (0, 1, 2)
  skipAuthRefresh?: boolean;
  skipRetry?: boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  backoffSchedule: number[];
  sleepFn?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffSchedule: [2000, 4000],
};

let activeRetryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG };

/**
 * Configure or reset retry parameters for unit tests.
 * Passing null restores production defaults.
 */
export function setRetryConfigForTesting(overrides: Partial<RetryConfig> | null): void {
  if (overrides === null) {
    activeRetryConfig = { ...DEFAULT_RETRY_CONFIG };
  } else {
    activeRetryConfig = { ...activeRetryConfig, ...overrides };
  }
}

/**
 * Returns current read-only retry configuration.
 */
export function getRetryConfig(): Readonly<RetryConfig> {
  return activeRetryConfig;
}

/**
 * Returns true if the HTTP method is safe and idempotent (strictly GET).
 * Mutations (POST, PUT, PATCH, DELETE) return false and must never be auto-retried.
 */
export function isSafeIdempotentMethod(method?: string): boolean {
  if (!method) return false;
  return method.toLowerCase() === 'get';
}

/**
 * Evaluates whether an Axios error represents a retryable transient failure.
 * Retryable: network errors without HTTP response, timeouts, and HTTP 502/503/504.
 * Non-retryable: user cancellations, client 4xx errors, or non-retryable 5xx.
 */
export function isRetryableError(error: AxiosError<ApiErrorResponse>): boolean {
  if (
    axios.isCancel(error) ||
    error.code === 'ERR_CANCELED' ||
    error.name === 'CanceledError' ||
    Boolean(error.config?.signal?.aborted)
  ) {
    return false;
  }

  // Network error or timeout with no response
  if (!error.response) {
    return true;
  }

  const status = error.response.status;

  // HTTP 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }

  return false;
}

/**
 * Asynchronous exponential backoff delay with abort signal support.
 */
async function waitBackoff(ms: number, signal?: GenericAbortSignal | AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const err = new Error('Request aborted');
    err.name = 'CanceledError';
    throw err;
  }

  if (activeRetryConfig.sleepFn) {
    await activeRetryConfig.sleepFn(ms);
    if (signal?.aborted) {
      const err = new Error('Request aborted');
      err.name = 'CanceledError';
      throw err;
    }
    return;
  }

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      const err = new Error('Request aborted');
      err.name = 'CanceledError';
      reject(err);
    };

    timer = setTimeout(() => {
      if (signal?.removeEventListener) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    if (signal?.addEventListener) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Backward compatibility helpers delegating to SessionManager singleton.
 */
export function getAccessToken(): string | null {
  return sessionManager.getAccessToken();
}

export function setAccessToken(token: string | null): void {
  // Provided for backward compatibility; prefer sessionManager directly
  if (token === null) {
    sessionManager.logout().catch(() => {});
  }
}

/**
 * Core Authenticated Axios HTTP Client for LoveByte application endpoints.
 * Automatically injects active in-memory JWT Bearer tokens, coordinates
 * single-flight 401 token refresh retries, and applies bounded exponential backoff
 * retries strictly to safe, idempotent GET requests.
 */
export const apiClient: AxiosInstance = axios.create(BASE_HTTP_CONFIG);

/**
 * Request Interceptor: Injects active Bearer Access Token from SessionManager if present.
 */
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = sessionManager.getAccessToken();
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Response Interceptor:
 * 1. Checks cancellation — never retries cancelled or aborted requests.
 * 2. Catches HTTP 401 Unauthorized errors and coordinates single-flight token refresh.
 * 3. Applies safe bounded retry (max 3 total attempts, ~2s and ~4s exponential backoff)
 *    strictly to idempotent GET requests on transient network or 502/503/504 errors.
 * 4. Strictly prohibits automatic retry on mutations (POST, PUT, PATCH, DELETE).
 * 5. Formats all remaining errors into typed ApiError instances.
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const originalRequest = error.config as ExtendedAxiosRequestConfig | undefined;

    // 1. Request cancellation check
    if (
      axios.isCancel(error) ||
      error.code === 'ERR_CANCELED' ||
      error.name === 'CanceledError' ||
      Boolean(originalRequest?.signal?.aborted)
    ) {
      return Promise.reject(error);
    }

    // 2. HTTP 401 Interception & Replay
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.skipAuthRefresh
    ) {
      originalRequest._retry = true;

      try {
        const freshAccessToken = await sessionManager.acquireFreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${freshAccessToken}`;
        return apiClient(originalRequest);
      } catch (refreshErr) {
        // If refresh failed, reject with the refresh failure error
        return Promise.reject(refreshErr);
      }
    }

    // 3. Safe Idempotent GET Request Retry Policy (Stage 3 Resilience)
    const isGet = isSafeIdempotentMethod(originalRequest?.method);
    const canRetry = originalRequest && !originalRequest.skipRetry;
    const currentRetryCount = originalRequest?._retryCount || 0;

    if (
      isGet &&
      canRetry &&
      isRetryableError(error) &&
      currentRetryCount < (activeRetryConfig.maxAttempts - 1)
    ) {
      originalRequest._retryCount = currentRetryCount + 1;
      const delayMs = activeRetryConfig.backoffSchedule[currentRetryCount] ?? 2000;

      try {
        await waitBackoff(delayMs, originalRequest.signal);
        return apiClient(originalRequest);
      } catch (backoffErr) {
        return Promise.reject(backoffErr);
      }
    }

    // 4. Standard Error Formatting
    return Promise.reject(formatApiError(error));
  }
);
