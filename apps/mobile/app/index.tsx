import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../lib/auth';

const HOME = { driver: '/driver', client: '/client' } as const;

export default function Index() {
  const { user, ready } = useAuth();
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;
  // Each role goes to its own screens. Anything else (for example an admin) goes back to sign-in.
  const home = user ? HOME[user.role as keyof typeof HOME] : undefined;
  return <Redirect href={home ?? '/login'} />;
}
