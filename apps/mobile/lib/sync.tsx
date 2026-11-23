import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api, ApiError, isNetworkError } from './api';
import { kvGet, kvSet, outboxAdd, outboxDelete, outboxList, outboxMark, type OutboxItem } from './store';

export interface DriverStop {
  id: string;
  position: number;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  est_arrival: string | null;
  window_start: string | null;
  window_end: string | null;
  started_at: string | null;
  finished_at: string | null;
  property_id: string;
  address: string;
  lat: number;
  lng: number;
  instructions: string;
  /** Recommended equipment. Missing in routes cached by older app versions. */
  equipment?: ('snowplow' | 'snowblower')[];
  client_name: string;
  note: string | null;
  block_reason: string | null;
  photo_count: number;
  service_minutes: number;
}
export interface DriverRoute {
  route: { id: string; service_date: string; planned_start: string; status: string; start_address: string; shift_started_at: string | null; shift_ended_at: string | null };
  stops: DriverStop[];
  fetchedAt: string;
}

/** Re-apply updates still waiting in the outbox on top of server data, so the screen never jumps back. */
function overlay(r: DriverRoute, pending: OutboxItem[]): DriverRoute {
  const stops = r.stops.map((s) => {
    let out = { ...s };
    for (const p of pending) {
      if (p.payload.stopId !== s.id) continue;
      if (p.kind === 'stop_update') {
        out = { ...out, status: p.payload.status, note: p.payload.note ?? out.note, block_reason: p.payload.blockReason ?? out.block_reason };
        if (p.payload.status === 'in_progress') out.started_at ??= p.payload.occurredAt;
        else out.finished_at = p.payload.occurredAt;
      } else out = { ...out, photo_count: out.photo_count + 1 };
    }
    return out;
  });
  return { ...r, stops };
}

interface SyncState {
  online: boolean;
  pending: OutboxItem[];
  syncing: boolean;
  lastError: string | null;
  flush: () => Promise<void>;
  loadRoute: (id: string) => Promise<{ data: DriverRoute | null; fromCache: boolean; cachedAt?: string }>;
  updateStop: (stopId: string, routeId: string, status: DriverStop['status'], extra?: { note?: string; blockReason?: string }) => Promise<void>;
  addPhoto: (stopId: string, routeId: string, uri: string, mime: string) => Promise<void>;
  version: number;
}

const Ctx = createContext<SyncState | null>(null);
export const useSync = () => useContext(Ctx)!;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const busy = useRef(false);

  const refreshPending = useCallback(async () => setPending(await outboxList()), []);

  /** Send queued items in order. Stops at the first network error and tries again later. */
  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      for (const item of await outboxList()) {
        if (item.failed) continue;
        try {
          if (item.kind === 'stop_update') {
            await api('/api/driver/stop-updates', { method: 'POST', json: { ...item.payload, clientUuid: item.id } });
          } else {
            const form = new FormData();
            form.append('clientUuid', item.id);
            form.append('stopId', item.payload.stopId);
            form.append('photo', { uri: item.file_uri, name: `${item.id}.jpg`, type: item.payload.mime } as any);
            await api('/api/driver/photos', { method: 'POST', body: form, timeoutMs: 60000 });
          }
          // 'applied' or 'duplicate' both mean the server has it exactly once.
          await outboxDelete(item.id);
          setLastError(null);
        } catch (e) {
          if (isNetworkError(e) || (e instanceof ApiError && (e.status >= 500 || e.status === 401 || e.status === 429))) {
            await outboxMark(item.id, e instanceof Error ? e.message : 'Network error', false);
            setLastError('Waiting for connection');
            break; // keep order: retry this item first next time
          }
          // The server rejected it (e.g. stop removed). Keep it visible, do not retry forever.
          await outboxMark(item.id, (e as Error).message, true);
          setLastError((e as Error).message);
        }
      }
    } finally {
      busy.current = false;
      setSyncing(false);
      await refreshPending();
      setVersion((v) => v + 1);
    }
  }, [refreshPending]);

  useEffect(() => {
    void refreshPending();
    const unsub = NetInfo.addEventListener((s) => {
      const on = !!s.isConnected && s.isInternetReachable !== false;
      setOnline(on);
      if (on) void flush();
    });
    const timer = setInterval(() => void flush(), 20000);
    const app = AppState.addEventListener('change', (s) => s === 'active' && void flush());
    return () => {
      unsub();
      clearInterval(timer);
      app.remove();
    };
  }, [flush, refreshPending]);

  const loadRoute = useCallback(async (id: string) => {
    const key = `route:${id}`;
    try {
      const fresh = await api<DriverRoute>(`/api/driver/routes/${id}`);
      await kvSet(key, fresh);
      return { data: overlay(fresh, await outboxList()), fromCache: false };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      const cached = await kvGet<DriverRoute>(key);
      return { data: cached ? overlay(cached.value, await outboxList()) : null, fromCache: true, cachedAt: cached?.updatedAt };
    }
  }, []);

  const updateStop = useCallback<SyncState['updateStop']>(async (stopId, _routeId, status, extra) => {
    await outboxAdd({ id: Crypto.randomUUID(), kind: 'stop_update', file_uri: null, payload: { stopId, status, note: extra?.note || undefined, blockReason: extra?.blockReason, occurredAt: new Date().toISOString() } });
    await refreshPending();
    setVersion((v) => v + 1);
    void flush();
  }, [flush, refreshPending]);

  const addPhoto = useCallback<SyncState['addPhoto']>(async (stopId, _routeId, uri, mime) => {
    await outboxAdd({ id: Crypto.randomUUID(), kind: 'photo', file_uri: uri, payload: { stopId, mime } });
    await refreshPending();
    setVersion((v) => v + 1);
    void flush();
  }, [flush, refreshPending]);

  const value = useMemo(() => ({ online, pending, syncing, lastError, flush, loadRoute, updateStop, addPhoto, version }), [online, pending, syncing, lastError, flush, loadRoute, updateStop, addPhoto, version]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
