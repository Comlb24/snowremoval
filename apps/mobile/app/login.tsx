import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, API_URL } from '../lib/api';
import { useAuth, WebsiteOnlyError } from '../lib/auth';
import { Banner, BigButton, Card, colors } from '../components/ui';

interface DevUser { id: string; role: string; name: string }

export default function Login() {
  const { signInDev, signInPassword } = useAuth();
  const [devUsers, setDevUsers] = useState<DevUser[] | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [websiteOnly, setWebsiteOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ devLogin: boolean; users: DevUser[] }>('/api/auth/dev-users')
      .then((r) => { setDevMode(r.devLogin); setDevUsers(r.users.filter((u) => u.role !== 'admin')); })
      .catch(() => setError(`Cannot reach the server at ${API_URL}`));
  }, []);

  const go = async (fn: () => Promise<void>, key: string) => {
    setError('');
    setWebsiteOnly(false);
    setBusy(key);
    try {
      await fn();
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
      setWebsiteOnly(e instanceof WebsiteOnlyError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 16, color: colors.muted, marginBottom: 12 }}>Drivers and property owners sign in here. Admins use the website.</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {websiteOnly ? (
        <Pressable onPress={() => Linking.openURL(API_URL)} accessibilityRole="link" style={{ marginBottom: 12 }}>
          <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '600' }}>Open the website ›</Text>
        </Pressable>
      ) : null}
      {devMode ? (
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 4 }}>Development sign-in</Text>
          <Text style={{ color: colors.muted, marginBottom: 12 }}>Pick a demo account. Turned off in production.</Text>
          {devUsers?.map((u) => (
            <BigButton key={u.id} variant="secondary" title={u.name} sub={u.role === 'driver' ? 'Driver' : 'Client'} loading={busy === u.id} onPress={() => go(() => signInDev(u.id), u.id)} style={{ marginBottom: 10 }} />
          ))}
        </Card>
      ) : (
        <Card>
          <TextInput placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={input} />
          <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} style={input} />
          <BigButton title="Sign in" loading={busy === 'pw'} onPress={() => go(() => signInPassword(email, password), 'pw')} />
        </Card>
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const input = { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 17, marginBottom: 10, backgroundColor: '#fff' } as const;
