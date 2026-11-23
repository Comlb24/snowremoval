import * as SecureStore from 'expo-secure-store';

/** Backend URL. The iOS simulator reaches the Mac at localhost. On a phone, set EXPO_PUBLIC_API_URL to your computer's LAN address. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3100').replace(/\/$/, '');

const TOKEN_KEY = 'snow_session';
let token: string | null = null;

export async function loadToken() {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}
export async function saveToken(t: string | null) {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
/** True when the request never reached the server (offline, timeout). */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body = init.body;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    const res = await fetch(`${API_URL}${path}`, { ...init, headers, body, signal: controller.signal });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}
