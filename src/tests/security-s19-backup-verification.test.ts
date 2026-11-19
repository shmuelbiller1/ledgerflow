import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  evaluateSupabaseBackups,
  extractProjectRef,
  fetchSupabaseBackups,
  sendBackupFailureAlert,
  validateAlertWebhookUrl,
} from '../../scripts/verify-backups';

const NOW_MS = Date.parse('2026-11-19T12:00:00.000Z');

test('S-19: passes when a COMPLETED backup is within the 26h window', () => {
  const result = evaluateSupabaseBackups({
    region: 'us-east-1',
    walg_enabled: true,
    pitr_enabled: false,
    backups: [
      { id: 1, status: 'COMPLETED', inserted_at: '2026-11-19T02:00:00.000Z' },
      { id: 2, status: 'PENDING', inserted_at: '2026-11-19T11:55:00.000Z' },
    ],
  }, { nowMs: NOW_MS });

  assert.equal(result.ok, true);
  assert.equal(result.region, 'us-east-1');
  assert.equal(result.latestBackupAgeHours, 10);
  assert.equal(result.completedBackupCount, 1);
});

test('S-19: passes when PITR is enabled with a fresh physical_backup_data anchor', () => {
  const latestUnix = Math.floor(Date.parse('2026-11-19T11:30:00.000Z') / 1000);
  const result = evaluateSupabaseBackups({
    region: 'eu-central-1',
    walg_enabled: true,
    pitr_enabled: true,
    backups: [],
    physical_backup_data: {
      earliest_physical_backup_date_unix: latestUnix - 86400 * 7,
      latest_physical_backup_date_unix: latestUnix,
    },
  }, { nowMs: NOW_MS, requirePitr: true });

  assert.equal(result.ok, true);
  assert.equal(result.pitrEnabled, true);
  assert.equal(result.latestBackupAgeHours, 0.5);
});

test('S-19: fails closed when backup is stale, missing, malformed, or PITR is disabled under REQUIRE_PITR', () => {
  const stale = evaluateSupabaseBackups({
    walg_enabled: true,
    pitr_enabled: false,
    backups: [{ status: 'COMPLETED', inserted_at: '2026-11-17T00:00:00.000Z' }],
  }, { nowMs: NOW_MS, maxAgeHours: 26 });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /exceeding the 26h threshold/);

  const noCompleted = evaluateSupabaseBackups({
    walg_enabled: false,
    pitr_enabled: false,
    backups: [{ status: 'FAILED', inserted_at: '2026-11-19T10:00:00.000Z' }],
  }, { nowMs: NOW_MS });
  assert.equal(noCompleted.ok, false);
  assert.match(noCompleted.reason, /No COMPLETED/);

  const pitrRequired = evaluateSupabaseBackups({
    walg_enabled: true,
    pitr_enabled: false,
    backups: [{ status: 'COMPLETED', inserted_at: '2026-11-19T11:00:00.000Z' }],
  }, { nowMs: NOW_MS, requirePitr: true });
  assert.equal(pitrRequired.ok, false);
  assert.match(pitrRequired.reason, /PITR.*disabled/i);

  assert.equal(evaluateSupabaseBackups(null, { nowMs: NOW_MS }).ok, false);
});

test('S-19: extractProjectRef and validateAlertWebhookUrl reject unsafe URLs', () => {
  assert.equal(extractProjectRef('https://sbxxbbscuwmlkvcvkbxi.supabase.co'), 'sbxxbbscuwmlkvcvkbxi');
  assert.throws(() => validateAlertWebhookUrl('http://hooks.example.com/alert'), /HTTPS/);
  assert.throws(() => validateAlertWebhookUrl('https://user:pass@hooks.example.com/alert'), /credentials/);
  assert.equal(validateAlertWebhookUrl('http://127.0.0.1:9999/hook').hostname, '127.0.0.1');
});

test('S-19: fetchSupabaseBackups and sendBackupFailureAlert talk cleanly to HTTP endpoints without leaking tokens', async () => {
  let seenAuth = '';
  let seenAlertBody = '';
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/projects/abcdefghijklmnop/database/backups') {
      seenAuth = String(req.headers.authorization || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        region: 'us-east-1',
        walg_enabled: true,
        pitr_enabled: false,
        backups: [{ status: 'COMPLETED', inserted_at: '2026-11-19T11:00:00.000Z' }],
      }));
      return;
    }
    if (req.url === '/alert' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        seenAlertBody = body;
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const payload = await fetchSupabaseBackups('abcdefghijklmnop', 'sbp_secret_token_value', fetch, baseUrl);
    assert.equal(seenAuth, 'Bearer sbp_secret_token_value');
    const evaluated = evaluateSupabaseBackups(payload, { nowMs: NOW_MS });
    assert.equal(evaluated.ok, true);

    await sendBackupFailureAlert(`${baseUrl}/alert`, 'abcdefghijklmnop', { ...evaluated, ok: false, reason: 'Stale backup' });
    const parsedAlert = JSON.parse(seenAlertBody) as Record<string, unknown>;
    assert.equal(parsedAlert.event, 'ledgerflow.backup_verification_failed');
    assert.equal(seenAlertBody.includes('sbp_secret_token_value'), false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
