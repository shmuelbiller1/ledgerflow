import type { AddressInfo } from './helpers/mockTypes';
import type { ListeningServer, TestResponseBody, TestRequest } from './helpers/mockTypes';
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import express from 'express';
import { invitePublicRouter } from '../server/routes/invitePublicRoutes';
import { publicInvoiceRouter } from '../server/routes/publicInvoiceRoutes';
import { paymentRouter } from '../server/routes/paymentRoutes';
import { leaseRouter } from '../server/routes/leaseRoutes';
import { revenueRouter } from '../server/routes/revenueRoutes';
import { supportRouter } from '../server/routes/supportRoutes';
import { emailRouter } from '../server/routes/emailRoutes';

describe('Public and Mutating API Validation Guard Suite (§14 Finding F & B-18)', () => {
  test('invitePublicRoutes rejects token < 10 chars with 400 Bad Request', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/invites', invitePublicRouter);

    const server = await new Promise<ListeningServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/invites/short`);
      const body: TestResponseBody & { message: string } = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.status, 'error');
      assert.ok(body.message.includes('Invalid invite token format'));
      assert.ok(Array.isArray(body.details));
    } finally {
      server.close();
    }
  });

  test('#842: accepting an invite with an unverified email is refused before the invite is read', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: object }).user = { uid: 'u-unverified', email: 'new@test.local', email_verified: false }; next(); });
    app.use('/api/v1/invites', invitePublicRouter);
    const server = await new Promise<ListeningServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/invites/aaaaaaaaaaaaaaaaaaaaaaaa/accept`, { method: 'POST' });
      const body: TestResponseBody & { message: string } = await res.json();
      assert.equal(res.status, 403);
      assert.match(body.message, /Verify your email address first/);
    } finally {
      server.close();
    }
  });

  test('publicInvoiceRoutes rejects invalid payment token format with 400 Bad Request', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/invoices/public', publicInvoiceRouter);

    const server = await new Promise<ListeningServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/invoices/public/invalid_token_123`);
      const body: TestResponseBody = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.error, 'Invalid token format');
      assert.ok(Array.isArray(body.details));
    } finally {
      server.close();
    }
  });

  test('paymentRoutes rejects missing workspaceId or negative amount with 400 Bad Request', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as TestRequest).user = { uid: 'user-1', admin: true }; next(); });
    app.use('/api/v1/payments', paymentRouter);

    const server = await new Promise<ListeningServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: -500 })
      });
      const body: TestResponseBody = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.status, 'error');
      assert.ok(Array.isArray(body.details));
    } finally {
      server.close();
    }
  });

  test('leaseRoutes rejects non-integer or negative pvAmountCents with 400 Bad Request', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/leases', leaseRouter);

    const server = await new Promise<ListeningServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/leases/capitalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws-1', pvAmountCents: -100, rouAssetAccountId: 'acc-1', leaseLiabilityAccountId: 'acc-2' })
      });
      const body: TestResponseBody = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.status, 'error');
      assert.ok(Array.isArray(body.details));
    } finally {
      server.close();
    }
  });

  test('revenueRoutes rejects missing accounts or negative amount with 400 Bad Request', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);

    const server = await new Promise<ListeningServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/revenue/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'ws-1', amountCents: 0 })
      });
      const body: TestResponseBody = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.status, 'error');
      assert.ok(Array.isArray(body.details));
    } finally {
      server.close();
    }
  });

  test('supportRoutes rejects invalid authorRole with 400 Bad Request', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/support', supportRouter);

    const server = await new Promise<ListeningServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/support/tickets/tick-123/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Hello', authorRole: 'superhacker' })
      });
      const body: TestResponseBody = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.status, 'error');
      assert.ok(Array.isArray(body.details));
    } finally {
      server.close();
    }
  });

  test('emailRoutes rejects invalid email format with 400 Bad Request', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/workspaces/:workspaceId/emails', emailRouter);

    const server = await new Promise<ListeningServer>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/workspaces/ws-1/emails/invoices/inv-123`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'not-an-email' })
      });
      const body: TestResponseBody = await res.json();

      assert.equal(res.status, 400);
      assert.equal(body.status, 'error');
      assert.ok(Array.isArray(body.details));
    } finally {
      server.close();
    }
  });
});
