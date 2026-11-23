import { router, useFocusEffect, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, isNetworkError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { kvGet, kvSet } from '../../lib/store';
import { useSync } from '../../lib/sync';
import { Banner, Card, colors, dayText, StatusPill, SyncBar, time } from '../../components/ui';

interface RouteSummary { id: string; service_date: string; planned_start: string; status: string; stop_count: number; done_count: number; shift_started_at: string | null }

export default function MyRoutes() {
  const { user, signOut } = useAuth();
  const { pending, loadRoute } = useSync();
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const r = await api<{ routes: RouteSummary[] }>('/api/driver/routes');
      setRoutes(r.routes);
      setCachedAt(null);
      await kvSet('routes', r.routes);
      // Save every assigned route on the phone now, so it is available without signal later.
      await Promise.all(r.routes.map((x) => loadRoute(x.id).catch(() => null)));
    } catch (e) {
      if (!isNetworkError(e)) setError((e as Error).message);
      const c = await kvGet<RouteSummary[]>('routes');
      setRoutes(c?.value ?? []);
      setCachedAt(c?.updatedAt ?? null);
    } finally {
      setRefreshing(false);
    }
  }, [loadRoute]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const confirmSignOut = () => {
    const waiting = pending.filter((p) => !p.failed).length;
    Alert.alert('Sign out?', waiting ? `${waiting} update(s) have not been sent yet and will be lost.` : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/login'); } },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}>
      <Stack.Screen options={{ headerRight: () => <Pressable onPress={confirmSignOut} hitSlop={12}><Text style={{ color: colors.primary, fontSize: 16 }}>Sign out</Text></Pressable> }} />
      <Text style={{ fontSize: 15, color: colors.muted, marginBottom: 12 }}>Hi {user?.fullName}</Text>
      <SyncBar />
      {cachedAt && <Banner tone="warning">Offline — showing routes saved at {time(cachedAt)}</Banner>}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {routes?.length === 0 && <Card><Text style={{ fontSize: 17 }}>No routes assigned to you right now.</Text></Card>}
      {routes?.map((r) => (
        <Pressable key={r.id} onPress={() => router.push(`/driver/route/${r.id}`)} accessibilityRole="button">
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ fontSize: 20, fontWeight: '700' }}>{dayText(r.service_date)}</Text>
              <StatusPill status={r.status} />
            </View>
            <Text style={{ fontSize: 16, color: colors.muted }}>Start {time(r.planned_start)} · {r.done_count} of {r.stop_count} stops done</Text>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
