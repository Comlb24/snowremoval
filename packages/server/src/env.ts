import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TIME_ZONE } from '@snow/core';

/**
 * Server configuration. Secrets are read only here, on the server.
 *
 * Safety rule: real SMS/calls are possible only when APP_ENV=production AND MESSAGING_MODE=live
 * AND every Twilio secret is present. Anything else uses the simulated messenger.
 * Real email follows the same rule, with RESEND_API_KEY and EMAIL_FROM instead of the Twilio values.
 */
export interface ServerConfig {
  appEnv: 'development' | 'production' | 'test';
  timeZone: string;
  businessName: string;
  publicBaseUrl: string;
  sessionSecret: string;
  cronSecret: string | null;
  databaseUrl: string | null;
  pgliteDir: string | null;
  authMode: 'dev' | 'supabase';
  messagingMode: 'simulated' | 'live';
  /**
   * Automatic texts (service window one hour before, updated window). Off unless AUTO_MESSAGES=on.
   * When off, clients get only the driver's "On my way" message and messages an admin sends by hand.
   */
  autoMessages: boolean;
  emailMode: 'simulated' | 'live';
  email: { apiKey: string; from: string; replyTo: string | null } | null;
  routingMode: 'mock' | 'mapbox';
  storageMode: 'local' | 'supabase';
  localStorageDir: string;
  twilio: { accountSid: string; authToken: string; fromNumber: string; messagingServiceSid?: string } | null;
  mapboxToken: string | null;
  /** Browser key for Google Places address suggestions. It is sent to the browser, so restrict it to your web addresses in Google Cloud. */
  googleMapsBrowserKey: string | null;
  supabase: { url: string; publishableKey: string; secretKey: string | null } | null;
  defaultStart: { address: string; lat: number; lng: number };
}

let cached: ServerConfig | null = null;

/** Repo root: SNOW_REPO_ROOT, or the nearest parent of cwd that contains supabase/migrations. */
export function repoRoot(): string {
  if (process.env.SNOW_REPO_ROOT) return process.env.SNOW_REPO_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'supabase', 'migrations'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const appEnv = (env.APP_ENV as ServerConfig['appEnv']) ?? (env.NODE_ENV === 'production' ? 'production' : 'development');
  const root = repoRoot();
  const twilio =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID)
      ? { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, fromNumber: env.TWILIO_FROM_NUMBER ?? '', messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID }
      : null;
  const wantsLive = env.MESSAGING_MODE === 'live';
  const sessionSecret = env.SESSION_SECRET ?? (appEnv === 'production' ? '' : 'dev-only-session-secret-change-me-0123456789');
  if (appEnv === 'production' && sessionSecret.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters) in production');
  return {
    appEnv,
    timeZone: env.TIME_ZONE ?? DEFAULT_TIME_ZONE,
    businessName: env.BUSINESS_NAME ?? 'Demo Snow Co.',
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:3100').replace(/\/$/, ''),
    sessionSecret,
    cronSecret: env.CRON_SECRET ?? null,
    databaseUrl: env.DATABASE_URL ?? null,
    pgliteDir: env.DATABASE_URL ? null : (env.PGLITE_DIR ?? path.join(root, '.data', 'pglite')),
    authMode: env.AUTH_MODE === 'supabase' ? 'supabase' : 'dev',
    messagingMode: appEnv === 'production' && wantsLive && twilio ? 'live' : 'simulated',
    autoMessages: env.AUTO_MESSAGES === 'on',
    emailMode: appEnv === 'production' && wantsLive && env.RESEND_API_KEY && env.EMAIL_FROM ? 'live' : 'simulated',
    email: env.RESEND_API_KEY && env.EMAIL_FROM ? { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO || null } : null,
    routingMode: env.ROUTING_MODE === 'mapbox' && env.MAPBOX_TOKEN ? 'mapbox' : 'mock',
    storageMode: env.STORAGE_MODE === 'supabase' ? 'supabase' : 'local',
    localStorageDir: env.LOCAL_STORAGE_DIR ?? path.join(root, '.data', 'photos'),
    twilio,
    mapboxToken: env.MAPBOX_TOKEN ?? null,
    googleMapsBrowserKey: env.GOOGLE_MAPS_API_KEY || null,
    // New key names (publishable/secret) preferred; legacy anon/service_role names still accepted.
    supabase:
      env.SUPABASE_URL && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY)
        ? {
            url: env.SUPABASE_URL.replace(/\/$/, ''),
            publishableKey: (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY)!,
            secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || null,
          }
        : null,
    defaultStart: {
      address: env.DEFAULT_START_ADDRESS ?? 'Depot, 1 Industrial Dr, Moncton, NB',
      lat: Number(env.DEFAULT_START_LAT ?? 46.1105),
      lng: Number(env.DEFAULT_START_LNG ?? -64.8024),
    },
  };
}

export function config(): ServerConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** For tests. */
export function setConfig(c: ServerConfig | null) {
  cached = c;
}
