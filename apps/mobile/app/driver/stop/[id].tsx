import { BLOCK_REASONS, equipmentText, formatPhone } from '@snow/core';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, isNetworkError } from '../../../lib/api';
import { useSync, type DriverStop } from '../../../lib/sync';
import { Banner, BigButton, Card, colors, StatusPill, SyncBar, time, windowText } from '../../../components/ui';

function openNavigation(s: DriverStop) {
  const dest = `${s.lat},${s.lng}`;
  const label = encodeURIComponent(s.address);
  const native = Platform.select({
    ios: `maps://?daddr=${dest}&q=${label}`,
    android: `google.navigation:q=${dest}`,
  })!;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  Linking.canOpenURL(native)
    .then((ok) => Linking.openURL(ok ? native : web))
    .catch(() => Linking.openURL(web));
}

export default function StopScreen() {
  const { id, routeId } = useLocalSearchParams<{ id: string; routeId: string }>();
  const { loadRoute, updateStop, addPhoto, version, pending } = useSync();
  const [stop, setStop] = useState<DriverStop | null>(null);
  const [routeStatus, setRouteStatus] = useState('');
  const [note, setNote] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneMsg, setPhoneMsg] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [onMyWayAt, setOnMyWayAt] = useState<string | null>(null);
  const [onMyWayMsg, setOnMyWayMsg] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null);
  const [sendingOnMyWay, setSendingOnMyWay] = useState(false);

  const load = useCallback(async () => {
    const r = await loadRoute(routeId);
    const s = r.data?.stops.find((x) => x.id === id) ?? null;
    setStop(s);
    setRouteStatus(r.data?.route.status ?? '');
  }, [id, routeId, loadRoute]);

  useEffect(() => { void load(); }, [load, version]);

  // The phone number is hidden again whenever the driver leaves this screen.
  useFocusEffect(useCallback(() => () => { setPhone(null); setPhoneMsg(''); }, []));

  if (!stop) return <ScrollView contentContainerStyle={{ padding: 16 }}><Text>Loading…</Text></ScrollView>;

  const photosQueued = pending.filter((p) => p.kind === 'photo' && p.payload.stopId === id && !p.failed).length;
  const closed = stop.status === 'completed' || stop.status === 'blocked';
  const editable = routeStatus !== 'completed' && routeStatus !== 'cancelled';

  const reveal = async () => {
    setRevealing(true);
    setPhoneMsg('');
    try {
      const r = await api<{ phone: string | null }>(`/api/driver/stops/${id}/phone`, { method: 'POST' });
      if (r.phone) setPhone(r.phone);
      else setPhoneMsg('No phone number on file.');
    } catch (e) {
      setPhoneMsg(isNetworkError(e) ? 'Needs a connection to show the number.' : (e as Error).message);
    } finally {
      setRevealing(false);
    }
  };

  const sentAt = onMyWayAt ?? stop.on_my_way_at ?? null;

  const sendOnMyWay = async () => {
    setSendingOnMyWay(true);
    setOnMyWayMsg(null);
    try {
      const r = await api<{ result: string; at?: string; error?: string }>(`/api/driver/stops/${id}/on-my-way`, { method: 'POST' });
      if ((r.result === 'sent' || r.result === 'already_sent') && r.at) setOnMyWayAt(r.at);
      else if (r.result === 'opted_out') setOnMyWayMsg({ tone: 'warning', text: 'Not sent: this client asked not to get messages.' });
      else if (r.result === 'no_contact') setOnMyWayMsg({ tone: 'warning', text: 'Not sent: no phone number or email on file.' });
      else setOnMyWayMsg({ tone: 'danger', text: `Not sent: ${r.error ?? 'please try again.'}` });
    } catch (e) {
      setOnMyWayMsg({ tone: 'warning', text: isNetworkError(e) ? 'Needs a connection to send the message. Try again in a moment.' : (e as Error).message });
    } finally {
      setSendingOnMyWay(false);
    }
  };

  const confirmOnMyWay = () =>
    Alert.alert('Send "On my way"?', `${stop.client_name} gets a message that you are coming to ${stop.address}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => void sendOnMyWay() },
    ]);

  const setStatus = async (status: DriverStop['status'], blockReason?: string) => {
    await updateStop(id, routeId, status, { note: note.trim() || undefined, blockReason });
    setBlocking(false);
    if (status === 'completed' || status === 'blocked') {
      setNote('');
      router.back();
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    let res: ImagePicker.ImagePickerResult;
    if (perm.granted) res = await ImagePicker.launchCameraAsync({ quality: 0.6, mediaTypes: ['images'] });
    else {
      // Simulator has no camera; fall back to the photo library.
      const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!lib.granted) return Alert.alert('Camera not available', 'You can complete the stop without a photo.');
      res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });
    }
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    await addPhoto(id, routeId, a.uri, a.mimeType ?? 'image/jpeg');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `Stop #${stop.position}` }} />
      <SyncBar />
      <Card>
        <StatusPill status={stop.status} large />
        <Text style={{ fontSize: 26, fontWeight: '800', marginTop: 10 }} selectable>{stop.address}</Text>
        <Text style={{ fontSize: 17, color: colors.muted, marginTop: 4 }}>{stop.client_name}</Text>
        <Text style={{ fontSize: 16, color: colors.muted, marginTop: 4 }}>
          {closed ? `Done at ${time(stop.finished_at)}` : `Est. arrival ${time(stop.est_arrival)} · client window ${windowText(stop.window_start, stop.window_end)}`}
        </Text>
        <BigButton title="Navigate" sub="Opens your maps app" onPress={() => openNavigation(stop)} style={{ marginTop: 14 }} />
        {!closed && editable && (
          <View style={{ marginTop: 10 }}>
            {sentAt ? (
              <Banner tone="success">✓ Client told you are on the way · {time(sentAt)}</Banner>
            ) : (
              <BigButton title="On my way" variant="secondary" sub="Texts the client that you are coming" loading={sendingOnMyWay} onPress={confirmOnMyWay} />
            )}
            {onMyWayMsg ? <View style={{ marginTop: 8 }}><Banner tone={onMyWayMsg.tone}>{onMyWayMsg.text}</Banner></View> : null}
          </View>
        )}
      </Card>

      <Card>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.muted, marginBottom: 6 }}>RECOMMENDED EQUIPMENT</Text>
        <Text style={{ fontSize: 19, lineHeight: 26, marginBottom: 14 }}>{stop.equipment?.length ? equipmentText(stop.equipment) : 'Not specified.'}</Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.muted, marginBottom: 6 }}>DRIVER NOTES</Text>
        <Text style={{ fontSize: 19, lineHeight: 26 }}>{stop.instructions || 'No special instructions.'}</Text>
      </Card>

      {!closed && editable && (
        <Card>
          {stop.status === 'pending' && <BigButton title="Start this stop" onPress={() => setStatus('in_progress')} style={{ marginBottom: 10 }} />}
          <BigButton title="Mark completed" variant="success" sub={stop.photo_count + photosQueued > 0 ? 'Photo attached' : 'Photo is optional'} onPress={() => setStatus('completed')} style={{ marginBottom: 10 }} />
          {!blocking ? (
            <BigButton title="Blocked — cannot clear" variant="warning" onPress={() => setBlocking(true)} />
          ) : (
            <View>
              <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8 }}>What is blocking the driveway?</Text>
              {BLOCK_REASONS.map((r) => (
                <BigButton key={r} title={r} variant="warning" onPress={() => setStatus('blocked', r)} style={{ marginBottom: 8 }} />
              ))}
              <Pressable onPress={() => setBlocking(false)} style={{ padding: 12, alignItems: 'center' }}><Text style={{ fontSize: 16, color: colors.muted }}>Cancel</Text></Pressable>
            </View>
          )}
        </Card>
      )}

      {editable && (
        <Card>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.muted, marginBottom: 6 }}>OPTIONAL</Text>
          <TextInput
            placeholder="Short note (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={500}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 17, marginBottom: 10 }}
          />
          <BigButton title="Add driveway photo" variant="secondary" sub={`${stop.photo_count} saved${photosQueued ? ` · ${photosQueued} waiting to upload` : ''}`} onPress={takePhoto} />
          {stop.note ? <Text style={{ marginTop: 10, color: colors.muted }}>Saved note: {stop.note}</Text> : null}
        </Card>
      )}

      <Card>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.muted, marginBottom: 6 }}>CLIENT PHONE</Text>
        <Text style={{ color: colors.muted, marginBottom: 10 }}>Only for problems on site, such as a vehicle blocking the driveway.</Text>
        {phone ? (
          <BigButton title={`Call ${formatPhone(phone)}`} variant="secondary" onPress={() => Linking.openURL(`tel:${phone}`)} />
        ) : (
          <BigButton title="Show phone number" variant="secondary" loading={revealing} onPress={reveal} />
        )}
        {phoneMsg ? <View style={{ marginTop: 8 }}><Banner tone="warning">{phoneMsg}</Banner></View> : null}
      </Card>
    </ScrollView>
  );
}
