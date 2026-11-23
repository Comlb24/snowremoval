import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, isNetworkError, loadToken, saveToken } from './api';
import { clearLocalData, kvGet, kvSet } from './store';

export interface User {
  id: string;
  role: 'admin' | 'driver' | 'client';
  fullName: string;
}

interface AuthState {
  user: User | null;
  ready: boolean;
  signInDev: (userId: string) => Promise<void>;
  signInPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => useContext(Ctx)!;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const t = await loadToken();
      if (t) {
        try {
          const { user } = await api<{ user: User }>('/api/me');
          setUser(user);
          await kvSet('me', user);
        } catch (e) {
          // Offline: keep the driver signed in with the last known profile.
          if (isNetworkError(e)) setUser((await kvGet<User>('me'))?.value ?? null);
          else await saveToken(null);
        }
      }
      setReady(true);
    })();
  }, []);

  const finish = async (token: string, u: User) => {
    await saveToken(token);
    await kvSet('me', u);
    setUser(u);
  };

  const signInDev = useCallback(async (userId: string) => {
    const r = await api<{ token: string; user: User }>('/api/auth/dev-login', { method: 'POST', json: { userId } });
    await finish(r.token, r.user);
  }, []);

  const signInPassword = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/api/auth/login', { method: 'POST', json: { email, password } });
    await finish(r.token, r.user);
  }, []);

  const signOut = useCallback(async () => {
    await saveToken(null);
    await clearLocalData();
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, ready, signInDev, signInPassword, signOut }}>{children}</Ctx.Provider>;
}
