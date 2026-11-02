/**
 * File storage on Supabase Storage (replaces firebase-admin's storage()).
 * Uses `@supabase/storage-js` directly instead of the umbrella `@supabase/supabase-js`
 * client so serverless bundles exclude Auth, PostgREST, Realtime, WebSocket, and polyfills.
 * Used by workspace purge to delete a workspace's files. Needs SUPABASE_SERVICE_ROLE_KEY
 * (server only); the bucket is SUPABASE_STORAGE_BUCKET (default "workspace-files").
 */
import { StorageClient } from '@supabase/storage-js';
import { supabaseUrl } from '../auth/supabaseAuth';

/** Error thrown when server-side Supabase Storage credentials are missing. */
export class StorageNotConfiguredError extends Error {
  /** Creates a StorageNotConfiguredError with a descriptive diagnostic message. */
  constructor() {
    super('File storage is not configured (SUPABASE_SERVICE_ROLE_KEY is not set)');
    this.name = 'StorageNotConfiguredError';
  }
}

let cachedClient: StorageClient | null = null;
let cachedEndpoint = '';
let cachedKey = '';

/**
 * Builds the authentication headers expected by Supabase Storage for legacy JWT
 * service-role keys as well as modern `sb_secret_` / `sb_publishable_` API keys.
 */
export function buildStorageAuthHeaders(key: string): Record<string, string> {
  if (key.startsWith('sb_publishable_') || key.startsWith('sb_secret_')) {
    return { apikey: key };
  }
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

/** Resolves the `/storage/v1` REST endpoint from the configured Supabase base URL. */
export function resolveStorageEndpoint(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('storage/v1', normalizedBase).href;
}

/** Returns a cached standalone Supabase StorageClient for the active service key. */
function storageClient(customFetch?: typeof fetch): StorageClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new StorageNotConfiguredError();
  const endpoint = resolveStorageEndpoint(supabaseUrl());
  if (customFetch) {
    return new StorageClient(endpoint, buildStorageAuthHeaders(key), customFetch);
  }
  if (!cachedClient || cachedEndpoint !== endpoint || cachedKey !== key) {
    cachedClient = new StorageClient(endpoint, buildStorageAuthHeaders(key));
    cachedEndpoint = endpoint;
    cachedKey = key;
  }
  return cachedClient;
}

/** Returns the configured Supabase Storage bucket name (defaults to `workspace-files`). */
export function storageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || 'workspace-files';
}

/** Lists every stored object path under the given folder prefix in 1,000-item pages. */
async function listFiles(client: StorageClient, bucket: string, prefix: string): Promise<string[]> {
  const files: string[] = [];
  const folders = [prefix.replace(/\/+$/, '')];
  while (folders.length > 0) {
    const folder = folders.pop() as string;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from(bucket).list(folder, { limit: 1000, offset });
      if (error) {
        if (/not found/i.test(error.message)) return files;
        throw error;
      }
      for (const entry of data || []) {
        const path = `${folder}/${entry.name}`;
        if (entry.id) files.push(path);
        else folders.push(path);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return files;
}

/** Deletes every file under the prefix in 1,000-key batches. Returns how many were deleted. */
export async function deleteFilesWithPrefix(
  prefix: string,
  customFetch?: typeof fetch,
): Promise<number> {
  const client = storageClient(customFetch);
  const bucket = storageBucket();
  const files = await listFiles(client, bucket, prefix);
  for (let i = 0; i < files.length; i += 1000) {
    const { error } = await client.from(bucket).remove(files.slice(i, i + 1000));
    if (error) throw error;
  }
  return files.length;
}
