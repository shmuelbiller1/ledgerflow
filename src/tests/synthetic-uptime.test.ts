import { describe, it, expect } from 'vitest';
// @ts-expect-error -- untyped ESM script
import { runUptimeCheck } from '../../scripts/synthetic-uptime.mjs';

describe('D-23: synthetic uptime check', () => {
  it('passes when health, sign-in, and dashboard endpoints return 200', async () => {
    const calls: string[] = [];
    const mockFetch = async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'session=abc123; Path=/; HttpOnly' },
      };
    };

    const result = await runUptimeCheck(mockFetch, {
      baseUrl: 'https://ledgerflow.example.com/',
      email: 'uptime@example.com',
      password: 'secret',
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'https://ledgerflow.example.com/api/health',
      'https://ledgerflow.example.com/api/auth/login',
      'https://ledgerflow.example.com/api/workspaces',
    ]);
  });

  it('throws when health check returns non-2xx', async () => {
    const mockFetch = async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await expect(runUptimeCheck(mockFetch, { baseUrl: 'https://ledgerflow.example.com' })).rejects.toThrow('Health check failed: 503');
  });
});
