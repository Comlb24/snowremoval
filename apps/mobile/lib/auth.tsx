import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, API_URL, isNetworkError, loadToken, saveToken } from './api';
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

/** The phone app is for drivers and property owners. Admins work on the website. */
export const APP_ROLES: readonly User['role'][] = ['driver', 'client'];
export class WebsiteOnlyError extends Error {
  constructor() {
    super(`Admin accounts use the website: ${API_URL}`);
  }
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
          if (APP_ROLES.includes(user.role)) {
            setUser(user);
            await kvSet('me', user);
          } else {
            // An admin session from an older app version: do not keep it.
            await saveToken(null);
            await clearLocalData();
          }
        } catch (e) {
          // Offline: keep the driver signed in with the last known profile.
          if (isNetworkError(e)) {
            const last = (await kvGet<User>('me'))?.value ?? null;
            setUser(last && APP_ROLES.includes(last.role) ? last : null);
          }
          else await saveToken(null);
        }
      }
      setReady(true);
    })();
  }, []);

  const finish = async (token: string, u: User) => {
    // Never keep an admin session on the phone.
    if (!APP_ROLES.includes(u.role)) throw new WebsiteOnlyError();
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
