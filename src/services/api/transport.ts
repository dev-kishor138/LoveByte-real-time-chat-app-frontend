import axios, { type AxiosInstance, type AxiosError, type CreateAxiosDefaults } from 'axios';
import { ENV } from '../../config/env.ts';
import { ApiError, type ApiErrorResponse } from './types.ts';

/**
 * Shared base HTTP configuration for LoveByte REST API.
 * Default timeout is 30000ms (30s) to provide resilience against
 * Render free-tier cold-start backend spin-up delays.
 */
export const BASE_HTTP_CONFIG: CreateAxiosDefaults = {
  baseURL: ENV.API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
};

/**
 * Formats any Axios error into a typed ApiError instance matching the LoveByte error envelope.
 */
export function formatApiError(error: AxiosError<ApiErrorResponse>): ApiError {
  if (error.response) {
    const statusCode = error.response.status;
    const data = error.response.data;
    const message = data?.error || error.message || 'Request failed';
    const details = data?.details;

    return new ApiError(statusCode, message, details);
  }

  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return new ApiError(0, 'Request timed out. Please check your network connection.');
  }

  if (error.request) {
    return new ApiError(0, 'Unable to connect to server. Please check your network connection.');
  }

  return new ApiError(0, error.message || 'Unknown network error');
}

/**
 * Helper to determine if an error represents a temporary network or infrastructure failure.
 */
export function isNetworkOrServerError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.statusCode === 0 || (error.statusCode >= 500 && error.statusCode <= 504);
  }
  return false;
}

/**
 * Attaches a standard response interceptor that maps Axios errors
 * into typed ApiError instances matching the backend error envelope.
 */
export function attachErrorFormattingInterceptor(client: AxiosInstance): void {
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError<ApiErrorResponse>) => {
      if (axios.isCancel(error) || error.code === 'ERR_CANCELED') {
        return Promise.reject(error);
      }
      return Promise.reject(formatApiError(error));
    }
  );
}

/**
 * Raw Authentication Transport.
 * Pure leaf transport instance with zero token request interceptors
 * and zero 401 refresh response interceptors.
 *
 * Exclusively used by low-level auth operations (register, login, refresh, logout, bootstrap profile).
 */
export const rawAuthTransport: AxiosInstance = axios.create(BASE_HTTP_CONFIG);
attachErrorFormattingInterceptor(rawAuthTransport);

