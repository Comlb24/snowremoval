import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, isNetworkError } from '../../../lib/api';
import { useSync, type DriverRoute } from '../../../lib/sync';
import { Banner, BigButton, Card, colors, dayText, StatusPill, SyncBar, time, windowText } from '../../../components/ui';

export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { loadRoute, version } = useSync();
  const [data, setData] = useState<DriverRoute | null>(null);
  const [cachedAt, setCachedAt] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await loadRoute(id);
      setData(r.data);
      setCachedAt(r.fromCache ? r.cachedAt : undefined);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [id, loadRoute]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { void load(); }, [version, load]);

  const shift = async (action: 'start' | 'end') => {
    setBusy(true);
    setMsg('');
    try {
      await api(`/api/driver/routes/${id}/shift`, { method: 'POST', json: { action } });
      await load();
    } catch (e) {
      setMsg(isNetworkError(e) ? 'No connection. Your shift starts automatically when your first stop update is sent.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <ScrollView contentContainerStyle={{ padding: 16 }}><SyncBar />{msg ? <Banner tone="danger">{msg}</Banner> : <Text>Loading…</Text>}</ScrollView>;

  const { route, stops } = data;
  const done = stops.filter((s) => s.status === 'completed' || s.status === 'blocked').length;
  const current = stops.find((s) => s.status === 'in_progress') ?? stops.find((s) => s.status === 'pending');
  const shiftOn = !!route.shift_started_at && !route.shift_ended_at;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}>
      <Stack.Screen options={{ title: dayText(route.service_date) }} />
      <SyncBar />
      {cachedAt && <Banner tone="warning">Offline — route saved at {time(cachedAt)}</Banner>}
      {route.status === 'paused' && <Banner tone="warning">‖ The office paused this route.</Banner>}
      {msg ? <Banner tone="info">{msg}</Banner> : null}

      <Card>
        <Text style={{ fontSize: 16, color: colors.muted }}>Progress</Text>
        <Text style={{ fontSize: 28, fontWeight: '800' }}>{done} of {stops.length} done</Text>
        <View style={{ height: 10, backgroundColor: '#e2e8f0', borderRadius: 5, marginTop: 8, overflow: 'hidden' }}>
          <View style={{ height: 10, width: `${stops.length ? (done / stops.length) * 100 : 0}%`, backgroundColor: colors.success }} />
        </View>
        <View style={{ marginTop: 14 }}>
          {!route.shift_started_at && <BigButton title="Start shift" sub={`Planned start ${time(route.planned_start)}`} onPress={() => shift('start')} loading={busy} />}
          {shiftOn && !current && <BigButton title="Finish shift" variant="success" onPress={() => shift('end')} loading={busy} />}
          {shiftOn && <Text style={{ fontSize: 16, color: colors.muted, marginBottom: current ? 0 : 10 }}>Shift started at {time(route.shift_started_at)}</Text>}
          {route.shift_ended_at && <Text style={{ fontSize: 16, color: colors.muted }}>Shift finished at {time(route.shift_ended_at)}</Text>}
        </View>
      </Card>

      {current && (
        <Pressable onPress={() => router.push({ pathname: '/driver/stop/[id]', params: { id: current.id, routeId: id } })} accessibilityRole="button" accessibilityLabel={`Next stop ${current.address}`}>
          <Card style={{ borderColor: colors.primary, borderWidth: 2 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.primary }}>{current.status === 'in_progress' ? 'CURRENT STOP' : 'NEXT STOP'} · #{stops.indexOf(current) + 1}</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 4 }}>{current.address}</Text>
            <Text style={{ fontSize: 16, color: colors.muted, marginTop: 4 }}>{current.client_name} · est. {time(current.est_arrival)}</Text>
            {current.instructions ? <Text style={{ fontSize: 16, marginTop: 8 }} numberOfLines={2}>📝 {current.instructions}</Text> : null}
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.primary, marginTop: 10 }}>Open stop ›</Text>
          </Card>
        </Pressable>
      )}
      {!current && stops.length > 0 && <Banner tone="success">✓ All stops are done.{shiftOn ? ' Tap “Finish shift”.' : ''}</Banner>}

      <Text style={{ fontSize: 18, fontWeight: '700', marginVertical: 8 }}>All stops</Text>
      {stops.map((s, i) => (
        <Pressable key={s.id} onPress={() => router.push({ pathname: '/driver/stop/[id]', params: { id: s.id, routeId: id } })} accessibilityRole="button">
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', width: 28, color: colors.muted }}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600' }}>{s.address}</Text>
              <Text style={{ color: colors.muted }}>
                {s.status === 'completed' || s.status === 'blocked' ? `Done ${time(s.finished_at)}` : `Est. ${time(s.est_arrival)} · window ${windowText(s.window_start, s.window_end)}`}
              </Text>
            </View>
            <StatusPill status={s.status} />
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

