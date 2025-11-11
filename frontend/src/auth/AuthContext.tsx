import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type UserRole = 'SUPERVISOR' | 'OPERATOR';

export interface AuthenticatedUser {
  email: string;
  role: UserRole;
}

interface AuthContextValue {
  token: string | null;
  user: AuthenticatedUser | null;
  login: (token: string, user: AuthenticatedUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_STORAGE_KEY = 'monitoring-toilet.auth.token';
const USER_STORAGE_KEY = 'monitoring-toilet.auth.user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  useEffect(() => {
    try {
      const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      const storedUser = localStorage.getItem(USER_STORAGE_KEY);
      if (storedToken) {
        setToken(storedToken);
      }
      if (storedUser) {
        const parsed = JSON.parse(storedUser) as AuthenticatedUser;
        setUser(parsed);
      }
    } catch (error) {
      console.error('Failed to restore authentication state from storage:', error);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  }, []);

  const login = useCallback((newToken: string, newUser: AuthenticatedUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ token, user, login, logout }), [token, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
