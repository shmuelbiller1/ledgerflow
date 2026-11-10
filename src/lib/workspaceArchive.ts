/**
 * E-21: read-only archive of the COMPLETE server JSON backup scope.
 *
 * ZIP is stored (no compression, no new dependency). Every collection present
 * in metadata.counts gets its own exact JSON and spreadsheet-safe UTF-8 CSV.
 * The original checksum-protected backup.json is retained for normal restore.
 * BK-10: the backup holds every workspace record table and the attachment list
 * (details and checksums); the system tables it leaves out on purpose and the
 * uploaded file bytes are named in the manifest notes. The restore screen reads
 * this ZIP back with backupFromWorkspaceArchive (the same restore, no second path).
 */
import { toCsv } from './csvExport';
import { recordExportTable } from './workspaceExports';

export type JsonObject = Record<string, unknown>;
const textEncoder = new TextEncoder();
const obj = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const safeKey = (s: string) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s);

/**
 * CRC32 for ZIP stored entries; checksum of the authoritative backup itself
 * is verified separately with SHA-256 before any archive is assembled.
 */
export function zipCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { path: string; content: string }

/** A portable UTF-8 ZIP archive with stored entries and correct central directory. */
export function makeStoredZip(files: readonly ZipEntry[]): Blob {
  if (!files.length || files.length > 65535) throw new Error('The archive has an invalid number of files.');
  const seen = new Set<string>();
  const chunks: ArrayBuffer[] = [];
  const central: ArrayBuffer[] = [];
  let offset = 0;
  let centralSize = 0;
  const version = 20;
  const flags = 0x0800; // UTF-8 file names

  for (const { path, content } of files) {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')
      || Array.from(path).some(character => character.charCodeAt(0) < 32) || seen.has(path)) {
      throw new Error('Unsafe or duplicate ZIP entry name.');
    }
    seen.add(path);
    const name = textEncoder.encode(path);
    const bytes = textEncoder.encode(content);
    if (name.length > 65535 || bytes.length > 0xffffffff) throw new Error('ZIP entry is too large.');
    const crc = zipCrc32(bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, version, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x5021, true); // 2020-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bytes.length, true);
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    chunks.push(local.buffer as ArrayBuffer, bytes.buffer as ArrayBuffer);
    const directory = new Uint8Array(46 + name.length);
    const dv = new DataView(directory.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, version, true);
    dv.setUint16(6, version, true);
    dv.setUint16(8, flags, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0x5021, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, bytes.length, true);
    dv.setUint32(24, bytes.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory.buffer as ArrayBuffer);
    centralSize += directory.length;
    offset += local.length + bytes.length;
    if (offset > 0xffffffff || centralSize > 0xffffffff || offset + centralSize + 22 > 0xffffffff) {
      throw new Error('Archive exceeds ZIP32 limits; request a server-side streamed archive.');
    }
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end.buffer as ArrayBuffer], { type: 'application/zip' });
}

/** The server computes SHA-256 over the backup before appending metadata.checksum. */
async function backupChecksumMatches(payload: JsonObject): Promise<boolean> {
  if (!obj(payload.metadata)) return false;
  const { checksum, ...withoutChecksum } = payload.metadata;
  const original = { ...payload, metadata: withoutChecksum };
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(JSON.stringify(original)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === checksum;
}

export interface WorkspaceArchiveResult {
  blob: Blob;
  collections: { key: string; count: number }[];
  manifest: JsonObject;
}

/** The verified backup's structure, after format and checksum checks. Throws with a reason otherwise. */
async function verifyWorkspaceBackupPayload(payload: unknown, workspaceId: string): Promise<JsonObject> {
  if (!obj(payload) || payload.schemaVersion !== 1 || !obj(payload.workspace)
    || payload.workspace.id !== workspaceId || !obj(payload.metadata)) {
    throw new Error('The server backup belongs to a different workspace or has an unsupported format.');
  }
  const meta = payload.metadata;
  if (meta.serverAuthoritative !== true || !obj(meta.counts) || typeof meta.checksum !== 'string'
    || !/^[a-f0-9]{64}$/.test(meta.checksum) || typeof payload.exportedAt !== 'string'
    || !Number.isFinite(Date.parse(payload.exportedAt))) {
    throw new Error('A verified server-authored backup is required; cached browser records are not sufficient.');
  }
  if (!await backupChecksumMatches(payload)) throw new Error('Server backup checksum verification failed.');
  return payload;
}

export async function buildWorkspaceArchive(payload: unknown, workspaceId: string): Promise<WorkspaceArchiveResult> {
  const backup = await verifyWorkspaceBackupPayload(payload, workspaceId);
  const meta = backup.metadata as JsonObject;

  const checksum = String(meta.checksum);

  const keys = Object.keys(meta.counts as JsonObject).sort();
  if (!keys.length || !keys.includes('transactions') || !keys.includes('accounts')) {
    throw new Error('The backup is missing required ledger collections.');
  }
  const topArrays = Object.keys(backup).filter(key => Array.isArray(backup[key])).sort();
  if (JSON.stringify(topArrays) !== JSON.stringify(keys)) {
    throw new Error('Backup collection inventory is incomplete or differs from its counts.');
  }
  const collections: WorkspaceArchiveResult['collections'] = [];
  const files: ZipEntry[] = [
    { path: 'backup.json', content: JSON.stringify(backup, null, 2) },
    { path: 'workspace.json', content: JSON.stringify(backup.workspace, null, 2) },
  ];
  for (const key of keys) {
    if (!safeKey(key) || key === 'workspace' || key === 'metadata') throw new Error('Invalid collection name in backup.');
    const counts = meta.counts as JsonObject;
    const count = counts[key];
    const records = backup[key] as unknown[];
    if (!Array.isArray(records) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || records.length !== count) {
      throw new Error('Backup row count mismatch for ' + key + '.');
    }
    if (!records.every(record => obj(record) && typeof record.id === 'string' && record.workspaceId === workspaceId)) {
      throw new Error('Backup contains an invalid or other-workspace row in ' + key + '.');
    }
    collections.push({ key, count });
    const table = recordExportTable(records as JsonObject[]);
    files.push({ path: 'collections/' + key + '.json', content: JSON.stringify(records, null, 2) });
    files.push({ path: 'collections/' + key + '.csv', content: '\uFEFF' + toCsv(table.headers, table.rows) });
  }
  const manifest: JsonObject = {
    format: 'ledgerflow-backup-archive-v1',
    workspaceId,
    exportedAt: backup.exportedAt,
    sourceChecksumSha256: checksum,
    source: 'verified server workspace JSON backup',
    collections,
    collectionCount: collections.length,
    rowCount: collections.reduce((sum, item) => sum + item.count, 0),
    restoreFile: 'backup.json',
    notes: [
      'All arrays in the existing authoritative JSON backup are included, including empty collections.',
      'The backup holds every workspace record table, the workspace settings (workspace.json) and the attachment list (collections/attachments: each file\'s name, size, record and SHA-256).',
      'Not included: the bytes of uploaded files (they stay in the workspace; the restore reports any listed file that is missing), members and invitations, API keys, bank connections and their tokens, the audit trail, notifications and e-mail logs, support tickets, and system tables.',
      'To restore, choose this ZIP (or its backup.json) in Settings → Backup & Export → Restore Workspace; it uses the normal verified restore.',
      'CSV is for human review, with a Record JSON column.',
      'The ZIP uses stored (uncompressed) entries; store this sensitive archive securely.',
    ],
  };
  files.unshift({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
  return { blob: makeStoredZip(files), collections, manifest };
}

/**
 * E-53: the complete collections of the verified server backup, for read-only exports that must
 * not fall back to the possibly-incomplete browser cache (same checks as the archive: format,
 * workspace, server metadata and SHA-256 checksum). Returns the top-level arrays keyed by name.
 */
export async function verifiedBackupCollections(payload: unknown, workspaceId: string): Promise<Record<string, unknown[]>> {
  const backup = await verifyWorkspaceBackupPayload(payload, workspaceId);
  const collections: Record<string, unknown[]> = {};
  for (const key of Object.keys(backup)) {
    if (Array.isArray(backup[key])) collections[key] = backup[key] as unknown[];
  }
  return collections;
}

/** The stored entries of a ZIP made by makeStoredZip, CRC-checked, by name. */
export function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => new Error('This file is not a readable workspace archive.');
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || bytes.length - end > 22 + 65535) throw bad();
  const total = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < total; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw bad();
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    if (method !== 0 || view.getUint32(at + 20, true) !== size || at + 46 + nameLength > end) throw bad();
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw bad();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (data.length !== size || zipCrc32(data) !== crc) throw new Error('The archive is damaged: ' + name + ' does not match its checksum.');
    entries.set(name, data);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

/**
 * BK-10: the backup inside a workspace archive, for the normal restore. The ZIP checksums, the
 * manifest and the backup's own SHA-256 are all checked; `text` is backup.json exactly as archived.
 */
export async function backupFromWorkspaceArchive(bytes: Uint8Array): Promise<{ text: string; backup: JsonObject }> {
  const entries = readStoredZip(bytes);
  const decoder = new TextDecoder();
  const read = (name: string): unknown => {
    const data = entries.get(name);
    if (!data) throw new Error('The archive has no ' + name + '.');
    try { return JSON.parse(decoder.decode(data)); } catch { throw new Error('The archive\'s ' + name + ' is not readable.'); }
  };
  const manifest = read('manifest.json');
  if (!obj(manifest) || manifest.format !== 'ledgerflow-backup-archive-v1' || manifest.restoreFile !== 'backup.json') {
    throw new Error('This ZIP is not a LedgerFlow workspace archive.');
  }
  const backup = read('backup.json');
  if (!obj(backup) || !obj(backup.metadata) || backup.metadata.checksum !== manifest.sourceChecksumSha256
    || !obj(backup.workspace) || backup.workspace.id !== manifest.workspaceId) {
    throw new Error('The archive\'s backup does not match its manifest.');
  }
  if (!await backupChecksumMatches(backup)) throw new Error('Backup file corrupted: Checksum verification failed.');
  return { text: decoder.decode(entries.get('backup.json')), backup };
}
