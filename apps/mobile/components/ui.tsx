import { STATUS_LABELS, statusTone, formatTime, formatWindow, formatDate } from '@snow/core';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSync } from '../lib/sync';

export const TZ = 'America/Moncton';
export const time = (d?: string | null) => (d ? formatTime(d, TZ) : '—');
export const windowText = (s?: string | null, e?: string | null) => (s && e ? formatWindow({ start: s, end: e }, TZ) : '—');
export const dayText = (d: string) => formatDate(d.length === 10 ? `${d}T12:00:00Z` : d, TZ);

export const colors = {
  bg: '#f1f5f9',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#475569',
  border: '#cbd5e1',
  primary: '#0369a1',
  success: '#047857',
  warning: '#b45309',
  danger: '#be123c',
};

const TONE = {
  neutral: { bg: '#f1f5f9', fg: '#334155', icon: '○' },
  info: { bg: '#e0f2fe', fg: '#075985', icon: '◔' },
  success: { bg: '#d1fae5', fg: '#065f46', icon: '✓' },
  warning: { bg: '#fef3c7', fg: '#92400e', icon: '!' },
  danger: { bg: '#ffe4e6', fg: '#9f1239', icon: '✕' },
};

/** Status as icon + words + colour. */
export function StatusPill({ status, large }: { status: string; large?: boolean }) {
  const t = TONE[statusTone(status)];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }, large && { paddingVertical: 6, paddingHorizontal: 12 }]}>
      <Text style={{ color: t.fg, fontWeight: '700', fontSize: large ? 16 : 13 }}>
        {t.icon} {STATUS_LABELS[status] ?? status}
      </Text>
    </View>
  );
}

type Variant = 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
const BTN: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: '#fff' },
  secondary: { bg: '#fff', fg: colors.text, border: colors.border },
  success: { bg: colors.success, fg: '#fff' },
  warning: { bg: '#fff', fg: colors.warning, border: '#f59e0b' },
  danger: { bg: '#fff', fg: colors.danger, border: '#fda4af' },
};

/** Big touch target (min 60 pt) for gloved hands. */
export function BigButton({ title, onPress, variant = 'primary', disabled, loading, sub, style }: { title: string; onPress: () => void; variant?: Variant; disabled?: boolean; loading?: boolean; sub?: string; style?: ViewStyle }) {
  const v = BTN[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: v.bg, borderColor: v.border ?? v.bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <Text style={[styles.btnText, { color: v.fg }]}>{title}</Text>}
      {sub && !loading && <Text style={{ color: v.fg, opacity: 0.85, fontSize: 13, marginTop: 2 }}>{sub}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Banner({ tone, children }: { tone: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <View style={{ backgroundColor: t.bg, padding: 10, borderRadius: 10, marginBottom: 10 }}>
      <Text style={{ color: t.fg, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

/** Connection + pending-sync indicator shown on every driver screen. */
export function SyncBar() {
  const { online, pending, syncing, lastError, flush } = useSync();
  const waiting = pending.filter((p) => !p.failed).length;
  const failed = pending.filter((p) => p.failed);
  if (online && !waiting && !failed.length) return null;
  return (
    <Pressable onPress={() => void flush()} accessibilityRole="button" accessibilityLabel="Retry sync">
      {!online && <Banner tone="warning">⚠ No connection. Your updates are saved on this phone.</Banner>}
      {waiting > 0 && (
        <Banner tone="info">
          {syncing ? '⟳ Sending…' : `◔ Pending sync: ${waiting} update${waiting === 1 ? '' : 's'}`}{online && !syncing ? ' · tap to retry' : ''}
        </Banner>
      )}
      {failed.length > 0 && <Banner tone="danger">✕ {failed.length} update(s) were rejected: {failed[0].last_error ?? lastError}</Banner>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  btn: { minHeight: 60, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  btnText: { fontSize: 18, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
});
