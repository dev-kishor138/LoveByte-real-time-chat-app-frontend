import { apiClient } from './client.ts';
import type {
  UserProfile,
  UserProfileResponse,
  UpdateProfilePayload,
} from './types.ts';

/**
 * User Profile REST API Service
 * Strictly adheres to verified backend contracts in backend/src/modules/users/
 * Uses apiClient with automatic Bearer token injection and single-flight 401 refresh.
 */
export const usersApi = {
  /**
   * Retrieves the profile of self or the active conversation partner.
   * Attempting to query non-partner user IDs returns 403 Forbidden on the backend.
   * GET /api/users/:id
   */
  async getProfile(userId: string): Promise<UserProfileResponse> {
    const response = await apiClient.get<UserProfileResponse>(
      `/api/users/${encodeURIComponent(userId)}`
    );
    return response.data;
  },

  /**
   * Convenience helper to retrieve user profile directly unwrapped.
   * GET /api/users/:id
   */
  async getUser(userId: string): Promise<UserProfile> {
    const data = await this.getProfile(userId);
    return data.user;
  },

  /**
   * Updates authenticated user's display name.
   * PATCH /api/users/profile
   */
  async updateProfile(payload: UpdateProfilePayload | string): Promise<UserProfileResponse> {
    const rawDisplayName = typeof payload === 'string' ? payload : payload.displayName;
    const normalizedPayload: UpdateProfilePayload = {
      displayName: rawDisplayName.trim(),
    };

    const response = await apiClient.patch<UserProfileResponse>(
      '/api/users/profile',
      normalizedPayload
    );
    return response.data;
  },

  /**
   * Convenience helper to update display name and return updated profile unwrapped.
   * PATCH /api/users/profile
   */
  async updateDisplayName(displayName: string): Promise<UserProfile> {
    const data = await this.updateProfile(displayName);
    return data.user;
  },
};

