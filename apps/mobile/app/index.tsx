import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../lib/auth';

export default function Index() {
  const { user, ready } = useAuth();
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;
  if (!user) return <Redirect href="/login" />;
  return <Redirect href={user.role === 'client' ? '/client' : '/driver'} />;
}
