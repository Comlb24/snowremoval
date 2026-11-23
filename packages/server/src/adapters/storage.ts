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

/** Supabase Storage private bucket, accessed only by the server with the secret key. */
export function supabaseStorage(bucket = 'visit-photos'): PhotoStorage {
  return {
    name: 'supabase',
    async put(key, bytes, contentType) {
      checkKey(key);
      const { supabaseAdmin } = await import('./supabase');
      const { error } = await supabaseAdmin().storage.from(bucket).upload(key, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Photo upload failed: ${error.message}`);
    },
    async get(key) {
      checkKey(key);
      const { supabaseAdmin } = await import('./supabase');
      const { data, error } = await supabaseAdmin().storage.from(bucket).download(key);
      if (error || !data) return null;
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || 'image/jpeg' };
    },
  };
}

export function getStorage(): PhotoStorage {
  const c = config();
  if (c.storageMode === 'supabase') {
    if (!c.supabase?.secretKey) throw new Error('STORAGE_MODE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY');
    return supabaseStorage();
  }
  return localStorage(c.localStorageDir);
}
