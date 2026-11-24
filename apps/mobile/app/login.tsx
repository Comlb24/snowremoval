import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, Text, TextInput, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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

  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: SKY[0] }}>
      <StatusBar style="light" />
      <SnowySky />
      {/* box-none: taps on empty space fall through to the snowy scene behind, so bubbles can be popped. */}
      <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View pointerEvents="box-none" style={{ flex: 1, padding: 20, paddingTop: insets.top + 36, paddingBottom: insets.bottom + 140 }}>
          <View pointerEvents="box-none" style={{ alignItems: 'center', marginBottom: 28 }}>
            <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <Wiggle size={34}>🏡</Wiggle>
            </View>
            <Text accessibilityRole="header" style={{ fontSize: 36, fontWeight: '800', color: '#fff', letterSpacing: 0.5 }}>TruHome Care</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ fontSize: 18, color: '#e0f2fe' }}>Welcome back! </Text>
              <Wiggle>☃️</Wiggle>
            </View>
            <Text pointerEvents="none" style={{ fontSize: 15, color: '#bae6fd', marginTop: 4, textAlign: 'center' }}>Let’s keep every driveway clear and cozy.</Text>
          </View>

          {error ? <Banner tone="danger">{error}</Banner> : null}
          {websiteOnly ? (
            <Pressable onPress={() => Linking.openURL(API_URL)} accessibilityRole="link" style={{ marginBottom: 12 }}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>Open the website ›</Text>
            </Pressable>
          ) : null}
          {devMode ? (
            <Card style={card}>
              <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 4 }}>Development sign-in</Text>
              <Text style={{ color: colors.muted, marginBottom: 12 }}>Pick a demo account. Turned off in production.</Text>
              {devUsers?.map((u) => (
                <BigButton key={u.id} variant="secondary" title={u.name} sub={u.role === 'driver' ? 'Driver' : 'Client'} loading={busy === u.id} onPress={() => go(() => signInDev(u.id), u.id)} style={{ marginBottom: 10 }} />
              ))}
            </Card>
          ) : (
            <Card style={card}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 14 }}>Sign in</Text>
              <TextInput placeholder="Email" placeholderTextColor="#94a3b8" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} style={input} />
              <TextInput placeholder="Password" placeholderTextColor="#94a3b8" autoComplete="password" secureTextEntry value={password} onChangeText={setPassword} style={input} />
              <BigButton title="Let’s go" loading={busy === 'pw'} onPress={() => go(() => signInPassword(email, password), 'pw')} />
            </Card>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------------------------------------------------------------- snowy night scene (tap to play)

const SKY = ['#0b1e46', '#12306b', '#1d4b8f', '#2f6bb0'];
/** Many thin bands blended between the sky colours, so the sky looks like a smooth gradient without an extra library. */
const BANDS = (() => {
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const out: string[] = [];
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * (SKY.length - 1);
    const a = hex(SKY[Math.floor(t)]);
    const b = hex(SKY[Math.min(Math.ceil(t), SKY.length - 1)]);
    const f = t - Math.floor(t);
    out.push(`rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`);
  }
  return out;
})();
const BUBBLES = Array.from({ length: 18 }, (_, i) => ({ left: (i * 37 + 5) % 92, size: 12 + ((i * 7) % 13), delay: (i * 613) % 6000, duration: 8000 + ((i * 1291) % 6000) }));
const HIT = 46; // finger-sized tap area around each bubble

/** Fun lines for the pop counter. The last one that fits wins. */
const CHEERS: [number, string][] = [[1, 'Pop! Keep going 🎈'], [5, 'Snow popper ❄️'], [10, 'Snow ninja! 🥷'], [25, 'Blizzard buster! 🏆'], [50, 'Legend of the plow 👑']];

interface Burst { id: number; x: number; y: number; kind: 'pop' | 'sparkle' }

function SnowySky() {
  const { width, height } = useWindowDimensions();
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [popped, setPopped] = useState(0);
  const [stars, setStars] = useState<number[]>([]);
  const nextId = useRef(1);

  const addBurst = useCallback((x: number, y: number, kind: Burst['kind']) => {
    const id = nextId.current++;
    setBursts((b) => [...b.slice(-12), { id, x, y, kind }]);
  }, []);
  const removeBurst = useCallback((id: number) => setBursts((b) => b.filter((x) => x.id !== id)), []);
  const onPop = useCallback((x: number, y: number) => { addBurst(x, y, 'pop'); setPopped((n) => n + 1); }, [addBurst]);
  const onSky = (e: GestureResponderEvent) => { Keyboard.dismiss(); addBurst(e.nativeEvent.pageX, e.nativeEvent.pageY, 'sparkle'); };
  const shootStar = () => { const id = nextId.current++; setStars((s) => [...s, id]); };

  const cheer = [...CHEERS].reverse().find(([n]) => popped >= n)?.[1];

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Pressable onPress={onSky} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        {BANDS.map((c, i) => (
          <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: (height * i) / BANDS.length, height: height / BANDS.length + 1, backgroundColor: c }} />
        ))}
      </Pressable>
      <Moon top={height * 0.07} onPress={shootStar} />
      {stars.map((id) => <ShootingStar key={id} width={width} top={height * 0.12} onDone={() => setStars((s) => s.filter((x) => x !== id))} />)}
      {BUBBLES.map((f, i) => <Bubble key={i} {...f} width={width} height={height} onPop={onPop} />)}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: -width * 0.2, width: width * 0.9, height: 150, borderTopLeftRadius: width, borderTopRightRadius: width, backgroundColor: '#e2e8f0' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, right: -width * 0.25, width: width, height: 120, borderTopLeftRadius: width, borderTopRightRadius: width, backgroundColor: '#f8fafc' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, backgroundColor: '#ffffff' }} />
      <Plow width={width} />
      {cheer ? <Counter key={cheer} popped={popped} cheer={cheer} /> : null}
      {bursts.map((b) => <BurstFx key={b.id} {...b} onDone={removeBurst} />)}
    </View>
  );
}

/** A snow bubble drifting down. Tap it and it pops, then floats back in from the top. */
function Bubble({ left, size, delay, duration, width, height, onPop }: { left: number; size: number; delay: number; duration: number; width: number; height: number; onPop: (x: number, y: number) => void }) {
  const fall = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const popped = useRef(false);

  const start = useCallback((wait: number) => {
    fall.setValue(0);
    Animated.sequence([
      Animated.delay(wait),
      Animated.loop(Animated.timing(fall, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true })),
    ]).start();
  }, [fall, duration]);

  useEffect(() => {
    start(delay);
    return () => fall.stopAnimation();
  }, [start, delay, fall]);

  const onPress = (e: GestureResponderEvent) => {
    if (popped.current) return;
    popped.current = true;
    onPop(e.nativeEvent.pageX, e.nativeEvent.pageY);
    Animated.timing(pop, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
      fall.stopAnimation();
      setTimeout(() => {
        pop.setValue(0);
        popped.current = false;
        start(0);
      }, 900);
    });
  };

  const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-HIT, height] });
  const translateX = fall.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 10, 0, -10, 0] });
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const opacity = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <Animated.View style={{ position: 'absolute', top: 0, left: (left / 100) * width, width: HIT, height: HIT, transform: [{ translateY }, { translateX }] }}>
      <Pressable onPress={onPress} hitSlop={4} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(224,242,254,0.22)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)', shadowColor: '#fff', shadowOpacity: 0.6, shadowRadius: 4, opacity, transform: [{ scale }] }}>
          <View style={{ position: 'absolute', top: size * 0.14, left: size * 0.16, width: size * 0.22, height: size * 0.22, borderRadius: size, backgroundColor: '#fff' }} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/** Little pieces flying out from a tap. A pop also shows "+1". */
function BurstFx({ id, x, y, kind, onDone }: Burst & { onDone: (id: number) => void }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: kind === 'pop' ? 650 : 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => onDone(id));
  }, [t, id, kind, onDone]);
  const pieces = kind === 'pop' ? 10 : 6;
  const reach = kind === 'pop' ? 42 : 26;
  const opacity = t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.8, 0] });
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y }}>
      {Array.from({ length: pieces }, (_, i) => {
        const a = (i / pieces) * Math.PI * 2;
        const tx = t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * reach] });
        const ty = t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * reach] });
        return kind === 'pop' ? (
          <Animated.View key={i} style={{ position: 'absolute', left: -3, top: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: i % 2 ? '#ffffff' : '#bae6fd', opacity, transform: [{ translateX: tx }, { translateY: ty }] }} />
        ) : (
          <Animated.Text key={i} style={{ position: 'absolute', left: -6, top: -8, fontSize: 12, opacity, transform: [{ translateX: tx }, { translateY: ty }] }}>✨</Animated.Text>
        );
      })}
      {kind === 'pop' ? (
        <Animated.Text style={{ position: 'absolute', left: -10, top: -14, fontSize: 16, fontWeight: '800', color: '#fff', opacity, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -36] }) }] }}>+1</Animated.Text>
      ) : null}
    </View>
  );
}

/** Pop counter above the hills. It bounces in each time the cheer changes. */
function Counter({ popped, cheer }: { popped: number; cheer: string }) {
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(s, { toValue: 1, friction: 4, useNativeDriver: true }).start(); }, [s]);
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 165, left: 0, right: 0, alignItems: 'center', transform: [{ scale: s }] }}>
      <View style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}>
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{cheer} · {popped} popped</Text>
      </View>
    </Animated.View>
  );
}

/** The moon. Tap it for a shooting star. */
function Moon({ top, onPress }: { top: number; onPress: () => void }) {
  const glow = useRef(new Animated.Value(1)).current;
  const press = () => {
    onPress();
    Animated.sequence([
      Animated.timing(glow, { toValue: 1.25, duration: 140, useNativeDriver: true }),
      Animated.spring(glow, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
  };
  return (
    <Pressable onPress={press} hitSlop={12} style={{ position: 'absolute', top, left: 28 }}>
      <Animated.View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: '#fef9c3', shadowColor: '#fef9c3', shadowOpacity: 0.8, shadowRadius: 24, transform: [{ scale: glow }] }} />
    </Pressable>
  );
}

function ShootingStar({ width, top, onDone }: { width: number; top: number; onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(onDone); }, [t, onDone]);
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [90, width + 40] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, 140] });
  const opacity = t.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] });
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top, left: 0, flexDirection: 'row', alignItems: 'center', opacity, transform: [{ translateX }, { translateY }, { rotate: '25deg' }] }}>
      <View style={{ width: 60, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.6)' }} />
      <Text style={{ fontSize: 18 }}>⭐</Text>
    </Animated.View>
  );
}

/** Tap an emoji and it gives a happy wiggle. */
function Wiggle({ children, size = 18 }: { children: string; size?: number }) {
  const r = useRef(new Animated.Value(0)).current;
  const press = () => {
    r.setValue(0);
    Animated.timing(r, { toValue: 1, duration: 600, easing: Easing.linear, useNativeDriver: true }).start();
  };
  const rotate = r.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: ['0deg', '-18deg', '16deg', '-10deg', '6deg', '0deg'] });
  const scale = r.interpolate({ inputRange: [0, 0.3, 1], outputRange: [1, 1.3, 1] });
  return (
    <Pressable onPress={press} hitSlop={10} accessible={false}>
      <Animated.Text style={{ fontSize: size, transform: [{ rotate }, { scale }] }}>{children}</Animated.Text>
    </Pressable>
  );
}

/** The plow keeps driving. Tap it: it hops and says hi. */
function Plow({ width }: { width: number }) {
  const drive = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const [beep, setBeep] = useState(false);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(drive, { toValue: 1, duration: 14000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [drive]);
  useEffect(() => {
    if (!beep) return;
    const id = setTimeout(() => setBeep(false), 1600);
    return () => clearTimeout(id);
  }, [beep]);
  const press = () => {
    setBeep(true);
    hop.setValue(0);
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(hop, { toValue: 0, friction: 3, useNativeDriver: true }),
    ]).start();
  };
  // The tractor emoji faces right, so it drives left to right and throws snow behind it.
  const translateX = drive.interpolate({ inputRange: [0, 1], outputRange: [-110, width + 20] });
  const translateY = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -26] });
  return (
    <Animated.View style={{ position: 'absolute', bottom: 30, left: 0, transform: [{ translateX }] }}>
      {beep ? (
        <View style={{ position: 'absolute', bottom: 62, left: 10, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>Beep beep! 🎉</Text>
        </View>
      ) : null}
      <Pressable onPress={press} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 18, marginRight: -4, marginBottom: 4 }}>❄️❄️</Text>
        <Animated.Text style={{ fontSize: 44, transform: [{ translateY }] }}>🚜</Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

const card = { backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 22, padding: 20, borderWidth: 0, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } } as const;
const input = { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 17, marginBottom: 10, backgroundColor: '#fff' } as const;
