import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text } from 'react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Banner, Card, colors, dayText, time } from '../../components/ui';

interface Prop {
  id: string;
  address: string;
  active: boolean;
  stop: null | { status: string; windowStart: string | null; windowEnd: string | null; finishedAt: string | null; serviceDate: string; routeStatus: string; hasPhoto: boolean };
}

const tidy = (t: string) => t.replace(/\.\./g, '.');

function describe(p: Prop): { icon: string; title: string; detail: string; tone: 'info' | 'success' | 'warning' } {
  const s = p.stop;
  if (!p.active) return { icon: '○', title: 'Service not active', detail: 'Contact us if this is unexpected.', tone: 'warning' };
  if (!s) return { icon: '○', title: 'No service scheduled', detail: 'We will let you know when you are on a route.', tone: 'info' };
  if (s.status === 'completed') return { icon: '✓', title: 'Completed', detail: `Finished ${time(s.finishedAt)} on ${dayText(s.finishedAt ?? s.serviceDate)}${s.hasPhoto ? ' · photo on file' : ''}`, tone: 'success' };
  if (s.status === 'in_progress') return { icon: '◔', title: 'Crew is at your property', detail: 'Snow removal in progress.', tone: 'info' };
  if (s.status === 'blocked') return { icon: '!', title: 'Could not complete', detail: 'Something blocked the driveway. We will contact you.', tone: 'warning' };
  if (s.routeStatus === 'paused') return { icon: '‖', title: 'On hold', detail: 'We will send a new time.', tone: 'warning' };
  return { icon: '◷', title: 'Scheduled', detail: tidy(`${dayText(s.serviceDate)}, estimated between ${time(s.windowStart)} and ${time(s.windowEnd)}. Please move vehicles before ${time(s.windowStart)}. Times are estimates.`), tone: 'info' };
}

export default function ClientHome() {
  const { user, signOut } = useAuth();
  const [props, setProps] = useState<Prop[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api<{ properties: Prop[] }>('/api/client/overview');
      setProps(r.properties);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}>
      <Stack.Screen options={{ headerRight: () => <Pressable onPress={async () => { await signOut(); router.replace('/login'); }}><Text style={{ color: colors.primary, fontSize: 16 }}>Sign out</Text></Pressable> }} />
      <Text style={{ fontSize: 22, fontWeight: '800', marginBottom: 12 }}>Hi {user?.fullName.split(' ')[0]}</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {props?.map((p) => {
        const d = describe(p);
        return (
          <Card key={p.id}>
            <Text style={{ fontSize: 14, color: colors.muted }}>Property</Text>
            <Text style={{ fontSize: 19, fontWeight: '700', marginBottom: 10 }}>{p.address}</Text>
            <Banner tone={d.tone}>{d.icon} {d.title}</Banner>
            <Text style={{ fontSize: 16, lineHeight: 22 }}>{d.detail}</Text>
          </Card>
        );
      })}
    </ScrollView>
  );
}
