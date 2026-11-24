import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { SyncProvider } from '../lib/sync';
import { colors } from '../components/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SyncProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#fff' },
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: colors.bg },
              headerBackTitle: 'Back',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false, title: 'Sign in' }} />
            <Stack.Screen name="driver/index" options={{ title: 'My routes', headerBackVisible: false }} />
            <Stack.Screen name="driver/route/[id]" options={{ title: 'Route' }} />
            <Stack.Screen name="driver/stop/[id]" options={{ title: 'Stop' }} />
            <Stack.Screen name="client/index" options={{ title: 'My service', headerBackVisible: false }} />
          </Stack>
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
