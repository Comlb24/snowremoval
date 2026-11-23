import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../env';

export interface PhotoStorage {
  name: 'local' | 'supabase';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

const SAFE_KEY = /^[a-zA-Z0-9/_.-]+$/;
function checkKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Invalid storage key');
}

/** Development storage: files in .data/photos, served only through the authorised photo endpoint. */
export function localStorage(dir: string): PhotoStorage {
  return {
    name: 'local',
    async put(key, bytes, contentType) {
      checkKey(key);
      const file = path.join(dir, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      await fs.writeFile(file + '.type', contentType);
    },
    async get(key) {
      checkKey(key);
      const file = path.join(dir, key);
      try {
        const [bytes, type] = await Promise.all([fs.readFile(file), fs.readFile(file + '.type', 'utf8').catch(() => 'image/jpeg')]);
        return { bytes, contentType: type };
      } catch {
        return null;
      }
    },
  };
}

/** Supabase Storage private bucket, accessed only by the server with the service key. */
export function supabaseStorage(url: string, serviceKey: string, bucket = 'visit-photos'): PhotoStorage {
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  return {
    name: 'supabase',
    async put(key, bytes, contentType) {
      checkKey(key);
      const res = await fetch(`${url}/storage/v1/object/${bucket}/${key}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true' },
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
    },
    async get(key) {
      checkKey(key);
      const res = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${key}`, { headers });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Photo download failed (${res.status})`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'image/jpeg' };
    },
  };
}

export function getStorage(): PhotoStorage {
  const c = config();
  if (c.storageMode === 'supabase') {
    if (!c.supabase?.serviceRoleKey) throw new Error('STORAGE_MODE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    return supabaseStorage(c.supabase.url, c.supabase.serviceRoleKey);
  }
  return localStorage(c.localStorageDir);
}
