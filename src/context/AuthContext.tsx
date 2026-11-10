import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import {
  sessionManager,
  type SessionEvent,
} from '../services/auth/sessionManager.ts';
import {
  type SafeUser,
  type LoginPayload,
  type LoginResponse,
} from '../services/api/auth.ts';

export interface AuthContextType {
  user: SafeUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  login: (payload: LoginPayload) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string>;
  retryProfile: () => Promise<SafeUser>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<SafeUser | null>(sessionManager.getUser());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    sessionManager.isAuthenticated()
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe to SessionManager lifecycle events
    const unsubscribe = sessionManager.subscribe((event: SessionEvent) => {
      switch (event.type) {
        case 'AUTHENTICATED':
          setUser(event.user ?? sessionManager.getUser());
          setIsAuthenticated(true);
          setAuthError(null);
          setIsLoading(false);
          break;
        case 'TOKEN_REFRESHED':
          setIsAuthenticated(true);
          setAuthError(null);
          break;
        case 'UNAUTHENTICATED':
          setUser(null);
          setIsAuthenticated(false);
          setAuthError(event.error ?? null);
          setIsLoading(false);
          break;
        case 'PROFILE_UNVERIFIED':
          setUser(null);
          setIsAuthenticated(false);
          setAuthError(event.error ?? 'Unable to verify profile');
          setIsLoading(false);
          break;
      }
    });

    // Run startup session restoration once
    sessionManager
      .bootstrap()
      .catch((err) => {
        console.warn('[AuthProvider] Bootstrap error:', err);
      })
      .finally(() => {
        setIsLoading(false);
      });

    return unsubscribe;
  }, []);

  const login = useCallback(async (payload: LoginPayload): Promise<LoginResponse> => {
    setAuthError(null);
    return sessionManager.login(payload);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setAuthError(null);
    return sessionManager.logout();
  }, []);

  const refreshSession = useCallback(async (): Promise<string> => {
    return sessionManager.acquireFreshAccessToken();
  }, []);

  const retryProfile = useCallback(async (): Promise<SafeUser> => {
    setAuthError(null);
    return sessionManager.retryProfileVerification();
  }, []);

  const contextValue = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      authError,
      login,
      logout,
      refreshSession,
      retryProfile,
    }),
    [user, isAuthenticated, isLoading, authError, login, logout, refreshSession, retryProfile]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

