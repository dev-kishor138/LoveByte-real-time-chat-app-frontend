import { rawAuthTransport } from './transport.ts';

/**
 * Safe user metadata returned by the backend auth service.
 * Never includes password hashes or sensitive internal flags.
 */
export interface SafeUser {
  id: string;
  email: string;
  createdAt: string;
  displayName?: string | null;
  lastSeenAt?: string | null;
}

/**
 * Payload sent to POST /api/auth/register
 */
export interface RegisterPayload {
  email: string;
  password: string;
}

/**
 * Response returned by POST /api/auth/register (HTTP 201 Created)
 */
export interface RegisterResponse {
  user: SafeUser;
  requiresVerification?: boolean;
  message?: string;
}

/**
 * Payload sent to POST /api/auth/verify-email
 */
export interface VerifyEmailPayload {
  email: string;
  code: string;
}

/**
 * Payload sent to POST /api/auth/resend-otp
 */
export interface ResendOtpPayload {
  email: string;
  type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
}

/**
 * Payload sent to POST /api/auth/forgot-password
 */
export interface ForgotPasswordPayload {
  email: string;
}

/**
 * Payload sent to POST /api/auth/reset-password
 */
export interface ResetPasswordPayload {
  email: string;
  code: string;
  newPassword: string;
}

/**
 * Payload sent to POST /api/auth/login
 */
export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * Response returned by POST /api/auth/login (HTTP 200 OK)
 */
export interface LoginResponse {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
  token?: string;
}

/**
 * Response returned by POST /api/auth/refresh (HTTP 200 OK)
 */
export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

/**
 * Options sent to POST /api/auth/logout
 */
export interface LogoutOptions {
  refreshToken?: string;
  accessToken?: string;
}

/**
 * Authentication API service.
 * Strictly adheres to backend contracts for LoveByte Stage 2B.
 * Uses rawAuthTransport exclusively (no recursive 401 interceptors).
 */
export const authApi = {
  /**
   * Registers a new user with a valid Gmail address.
   */
  async register(payload: RegisterPayload): Promise<RegisterResponse> {
    const normalizedPayload = {
      email: payload.email.trim().toLowerCase(),
      password: payload.password, // Passwords must never be trimmed or transformed
    };

    const response = await rawAuthTransport.post<RegisterResponse>(
      '/api/auth/register',
      normalizedPayload
    );
    return response.data;
  },

  /**
   * Authenticates user credentials with the backend.
   * Returns authenticated user profile and tokens.
   */
  async login(payload: LoginPayload): Promise<LoginResponse> {
    const normalizedPayload = {
      email: payload.email.trim().toLowerCase(),
      password: payload.password, // Passwords must never be trimmed or transformed
    };

    const response = await rawAuthTransport.post<LoginResponse>(
      '/api/auth/login',
      normalizedPayload
    );
    return response.data;
  },

  /**
   * Rotates a valid refresh token for a new access token and replacement refresh token.
   * Dispatched strictly via rawAuthTransport to prevent interceptor loops.
   */
  async refresh(refreshToken: string): Promise<RefreshResponse> {
    const response = await rawAuthTransport.post<RefreshResponse>(
      '/api/auth/refresh',
      { refreshToken }
    );
    return response.data;
  },

  /**
   * Revokes the current session on the backend.
   * Requires Bearer access token evaluated by backend authenticateToken middleware.
   */
  async logout(options?: LogoutOptions): Promise<{ message: string }> {
    const headers = options?.accessToken
      ? { Authorization: `Bearer ${options.accessToken}` }
      : undefined;

    const body = options?.refreshToken
      ? { refreshToken: options.refreshToken }
      : {};

    const response = await rawAuthTransport.post<{ message: string }>(
      '/api/auth/logout',
      body,
      {
        headers,
        timeout: 3000, // Non-blocking 3s timeout
      }
    );
    return response.data;
  },

  /**
   * Fetches the authenticated user's profile using an explicit Bearer access token.
   */
  async getProfile(accessToken: string): Promise<SafeUser> {
    const response = await rawAuthTransport.get<{ user: SafeUser }>(
      '/api/auth/me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    return response.data.user;
  },

  /**
   * Verifies email using 6-digit OTP code.
   */
  async verifyEmail(payload: VerifyEmailPayload): Promise<{ success: boolean; message: string }> {
    const response = await rawAuthTransport.post<{ success: boolean; message: string }>(
      '/api/auth/verify-email',
      {
        email: payload.email.trim().toLowerCase(),
        code: payload.code.trim(),
      }
    );
    return response.data;
  },

  /**
   * Resends OTP code for email verification or password reset.
   */
  async resendOtp(payload: ResendOtpPayload): Promise<{ message: string }> {
    const response = await rawAuthTransport.post<{ message: string }>(
      '/api/auth/resend-otp',
      {
        email: payload.email.trim().toLowerCase(),
        type: payload.type,
      }
    );
    return response.data;
  },

  /**
   * Submits a forgot password request to receive a 6-digit password reset OTP.
   */
  async forgotPassword(payload: ForgotPasswordPayload): Promise<{ message: string }> {
    const response = await rawAuthTransport.post<{ message: string }>(
      '/api/auth/forgot-password',
      {
        email: payload.email.trim().toLowerCase(),
      }
    );
    return response.data;
  },

  /**
   * Resets password using 6-digit reset code and new password.
   */
  async resetPassword(payload: ResetPasswordPayload): Promise<{ success: boolean; message: string }> {
    const response = await rawAuthTransport.post<{ success: boolean; message: string }>(
      '/api/auth/reset-password',
      {
        email: payload.email.trim().toLowerCase(),
        code: payload.code.trim(),
        newPassword: payload.newPassword,
      }
    );
    return response.data;
  },
};
