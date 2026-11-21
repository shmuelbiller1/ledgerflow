/**
 * S-19: Scheduled backup / PITR window verification against the Supabase Management API.
 *
 * Checks GET https://api.supabase.com/v1/projects/{ref}/database/backups, evaluates whether
 * PITR or a recent COMPLETED backup exists within `maxAgeHours` (default 26 h), and fails
 * closed on missing credentials, API errors, disabled backups, or stale recovery windows.
 * Optionally posts a redacted alert payload to `BACKUP_ALERT_WEBHOOK_URL` on failure.
 *
 * Never logs tokens, credentials, or raw database URLs.
 */
import { pathToFileURL } from 'node:url';
import { SUPABASE_PROJECT } from '../src/config/supabaseProject';

export interface SupabaseBackupEntry {
  id?: string | number;
  status?: string;
  inserted_at?: string;
  is_physical_backup?: boolean;
}

export interface SupabasePhysicalBackupData {
  earliest_physical_backup_date_unix?: number;
  latest_physical_backup_date_unix?: number;
}

export interface SupabaseBackupResponse {
  region?: string;
  walg_enabled?: boolean;
  pitr_enabled?: boolean;
  backups?: SupabaseBackupEntry[];
  physical_backup_data?: SupabasePhysicalBackupData;
}

export interface BackupVerificationOptions {
  nowMs?: number;
  maxAgeHours?: number;
  requirePitr?: boolean;
}

export interface BackupVerificationResult {
  ok: boolean;
  region: string | null;
  pitrEnabled: boolean;
  walgEnabled: boolean;
  latestBackupAt: string | null;
  latestBackupAgeHours: number | null;
  completedBackupCount: number;
  reason: string;
}

export function extractProjectRef(supabaseUrl?: string): string {
  const raw = (supabaseUrl || process.env.SUPABASE_URL || SUPABASE_PROJECT.url || '').trim();
  if (!raw) return '';
  try {
    const host = new URL(raw).hostname;
    const match = /^([a-z0-9]{10,32})\.supabase\.co$/i.exec(host);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

export function validateAlertWebhookUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('BACKUP_ALERT_WEBHOOK_URL must be a valid URL.');
  }
  const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(isLoopback && parsed.protocol === 'http:')) {
    throw new Error('BACKUP_ALERT_WEBHOOK_URL must use HTTPS outside loopback.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('BACKUP_ALERT_WEBHOOK_URL must not contain embedded credentials.');
  }
  return parsed;
}

export function evaluateSupabaseBackups(
  payload: unknown,
  options: BackupVerificationOptions = {},
): BackupVerificationResult {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeHours = Number.isFinite(options.maxAgeHours) && (options.maxAgeHours ?? 0) > 0
    ? Number(options.maxAgeHours)
    : 26;
  const requirePitr = options.requirePitr === true;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      region: null,
      pitrEnabled: false,
      walgEnabled: false,
      latestBackupAt: null,
      latestBackupAgeHours: null,
      completedBackupCount: 0,
      reason: 'Supabase backup response is malformed or empty.',
    };
  }

  const data = payload as SupabaseBackupResponse;
  const region = typeof data.region === 'string' && data.region ? data.region : null;
  const pitrEnabled = data.pitr_enabled === true;
  const walgEnabled = data.walg_enabled === true;
  const backups = Array.isArray(data.backups) ? data.backups : [];

  const completedTimestampsMs: number[] = [];
  for (const entry of backups) {
    if (!entry || typeof entry !== 'object') continue;
    if (String(entry.status || '').toUpperCase() !== 'COMPLETED') continue;
    if (typeof entry.inserted_at !== 'string') continue;
    const ms = Date.parse(entry.inserted_at);
    if (Number.isFinite(ms)) completedTimestampsMs.push(ms);
  }

  const physicalLatestUnix = data.physical_backup_data?.latest_physical_backup_date_unix;
  const physicalLatestMs = typeof physicalLatestUnix === 'number' && Number.isFinite(physicalLatestUnix) && physicalLatestUnix > 0
    && Number.isFinite(new Date(physicalLatestUnix * 1000).getTime())
    ? physicalLatestUnix * 1000
    : null;

  // When PITR is required, a recent logical backup cannot demonstrate a usable recovery point.
  const candidateTimestamps = requirePitr ? [] : [...completedTimestampsMs];
  if (pitrEnabled && physicalLatestMs !== null) {
    candidateTimestamps.push(physicalLatestMs);
  }

  const latestMs = candidateTimestamps.length > 0 ? Math.max(...candidateTimestamps) : null;
  const latestBackupAt = latestMs !== null ? new Date(latestMs).toISOString() : null;
  const ageHours = latestMs !== null ? (nowMs - latestMs) / 3_600_000 : null;
  const latestBackupAgeHours = ageHours !== null ? Number(ageHours.toFixed(2)) : null;

  if (requirePitr && !pitrEnabled) {
    return {
      ok: false,
      region,
      pitrEnabled,
      walgEnabled,
      latestBackupAt,
      latestBackupAgeHours,
      completedBackupCount: completedTimestampsMs.length,
      reason: 'Point-in-Time Recovery (PITR) is disabled on this project (REQUIRE_PITR=true).',
    };
  }

  if (latestMs === null || latestBackupAgeHours === null) {
    return {
      ok: false,
      region,
      pitrEnabled,
      walgEnabled,
      latestBackupAt: null,
      latestBackupAgeHours: null,
      completedBackupCount: completedTimestampsMs.length,
      reason: requirePitr && pitrEnabled
        ? 'PITR is required but no valid physical recovery point timestamp was reported.'
        : pitrEnabled
          ? 'PITR is enabled but no physical or completed backup timestamp was reported.'
        : 'No COMPLETED database backup was returned by Supabase.',
    };
  }

  if (ageHours !== null && ageHours < -1) {
    return {
      ok: false,
      region,
      pitrEnabled,
      walgEnabled,
      latestBackupAt,
      latestBackupAgeHours,
      completedBackupCount: completedTimestampsMs.length,
      reason: 'Backup timestamp is unreasonably far in the future; check clock/API response.',
    };
  }

  if (ageHours !== null && ageHours > maxAgeHours) {
    return {
      ok: false,
      region,
      pitrEnabled,
      walgEnabled,
      latestBackupAt,
      latestBackupAgeHours,
      completedBackupCount: completedTimestampsMs.length,
      reason: `Latest verified backup is ${ageHours}h old, exceeding the ${maxAgeHours}h threshold.`,
    };
  }

  return {
    ok: true,
    region,
    pitrEnabled,
    walgEnabled,
    latestBackupAt,
    latestBackupAgeHours,
    completedBackupCount: completedTimestampsMs.length,
    reason: pitrEnabled && physicalLatestMs === latestMs
      ? `PITR enabled (reported physical recovery point ${latestBackupAgeHours}h old).`
      : `Latest completed backup is ${latestBackupAgeHours}h old (${completedTimestampsMs.length} completed backups visible).`,
  };
}

export async function fetchSupabaseBackups(
  projectRef: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  apiBaseUrl = 'https://api.supabase.com',
): Promise<unknown> {
  if (!/^[a-z0-9]{10,32}$/i.test(projectRef)) {
    throw new Error('Invalid SUPABASE_PROJECT_REF format.');
  }
  if (!accessToken.trim()) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required.');
  }
  const base = apiBaseUrl.replace(/\/+$/, '');
  const response = await fetchImpl(`${base}/v1/projects/${encodeURIComponent(projectRef)}/database/backups`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Supabase Management API returned HTTP ${response.status}.`);
  }
  return response.json();
}

export async function sendBackupFailureAlert(
  webhookUrl: string,
  projectRef: string,
  result: BackupVerificationResult,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const safeUrl = validateAlertWebhookUrl(webhookUrl);
  const body = JSON.stringify({
    event: 'ledgerflow.backup_verification_failed',
    projectRef,
    checkedAt: new Date().toISOString(),
    result,
  });
  const response = await fetchImpl(safeUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Backup alert webhook returned HTTP ${response.status}.`);
  }
}

export async function runBackupVerificationCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const skipIfUnconfigured = argv.includes('--skip-if-unconfigured');
  const projectRef = (process.env.SUPABASE_PROJECT_REF || extractProjectRef()).trim();
  const accessToken = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  const maxAgeHours = Number(process.env.MAX_BACKUP_AGE_HOURS || '26');
  const requirePitr = process.env.REQUIRE_PITR === 'true';
  const alertWebhookUrl = (process.env.BACKUP_ALERT_WEBHOOK_URL || '').trim();

  if (!projectRef || !accessToken) {
    const message = 'SUPABASE_ACCESS_TOKEN (or SUPABASE_PROJECT_REF) is not set.';
    if (skipIfUnconfigured) {
      console.log(JSON.stringify({ status: 'skipped', reason: message }));
      return 0;
    }
    console.error(JSON.stringify({ ok: false, reason: message }));
    return 1;
  }

  let result: BackupVerificationResult;
  try {
    const payload = await fetchSupabaseBackups(
      projectRef,
      accessToken,
      fetch,
      process.env.SUPABASE_MANAGEMENT_API_BASE || 'https://api.supabase.com',
    );
    result = evaluateSupabaseBackups(payload, { maxAgeHours, requirePitr });
  } catch (err) {
    result = {
      ok: false,
      region: null,
      pitrEnabled: false,
      walgEnabled: false,
      latestBackupAt: null,
      latestBackupAgeHours: null,
      completedBackupCount: 0,
      reason: err instanceof Error ? err.message : 'Backup verification request failed.',
    };
  }

  console.log(JSON.stringify({ projectRef, ...result }));

  if (!result.ok && alertWebhookUrl) {
    try {
      await sendBackupFailureAlert(alertWebhookUrl, projectRef, result);
    } catch (alertErr) {
      console.error('Failed to deliver backup alert webhook:', alertErr instanceof Error ? alertErr.message : String(alertErr));
    }
  }

  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runBackupVerificationCli().then(code => {
    process.exitCode = code;
  });
}
