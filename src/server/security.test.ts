import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createFireWatchDb } from './db.ts';
import {
  buildAllowedOrigins,
  createRateLimiter,
  isOriginAllowed,
  validateAiExplainPayload,
  validateAuditPayload,
  verifyBearerToken,
} from './security.ts';
import { createFireWatchApp } from '../../server.ts';

test('verifyBearerToken fails closed when ADMIN_TOKEN is unset and uses constant-time compare', () => {
  assert.deepEqual(verifyBearerToken('Bearer secret', undefined), {
    ok: false,
    status: 403,
    error: 'Admin write operations are disabled (ADMIN_TOKEN is not configured on the server).',
  });
  assert.equal(verifyBearerToken(undefined, 'top-secret-token-123').ok, false);
  const missing = verifyBearerToken(undefined, 'top-secret-token-123');
  assert.equal(missing.ok ? 0 : missing.status, 401);

  const wrongLen = verifyBearerToken('Bearer short', 'top-secret-token-123');
  assert.equal(wrongLen.ok ? 0 : wrongLen.status, 403);

  assert.deepEqual(verifyBearerToken('Bearer top-secret-token-123', 'top-secret-token-123'), { ok: true });
});

test('createRateLimiter enforces window cap and resets cleanly', () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 3,
    message: 'Too fast',
  });
  assert.equal(limiter.check('1.2.3.4', 1000).allowed, true);
  assert.equal(limiter.check('1.2.3.4', 2000).allowed, true);
  assert.equal(limiter.check('1.2.3.4', 3000).allowed, true);
  const blocked = limiter.check('1.2.3.4', 4000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 56);
  // Separate IP is unaffected
  assert.equal(limiter.check('5.6.7.8', 4000).allowed, true);
  // Resets after window expires
  assert.equal(limiter.check('1.2.3.4', 65_000).allowed, true);
});

test('CORS allowlist allows configured/local origins and blocks arbitrary cross-origin hosts', () => {
  const allowlist = buildAllowedOrigins({
    allowedOriginsEnv: 'https://firewatch.example',
    appUrlEnv: 'https://app.firewatch.example/path',
    port: 3000,
  });
  assert.equal(isOriginAllowed('http://localhost:3000', 'localhost:3000', allowlist), true);
  assert.equal(isOriginAllowed('https://firewatch.example', 'api.firewatch.example', allowlist), true);
  assert.equal(isOriginAllowed('https://app.firewatch.example', 'api.firewatch.example', allowlist), true);
  assert.equal(isOriginAllowed('https://evil.attacker', 'localhost:3000', allowlist), false);
});

test('payload validators reject oversized inputs and enforce bounds', () => {
  const badAudit = validateAuditPayload({
    districtId: 'bayanzurkh',
    khorooNumber: 1,
    homeType: 'invalid_type',
    heatingType: 'iron_stove',
    electricalState: 'safe',
    ashStorage: 'metal_box',
    score: 50,
    riskLevel: 'moderate',
  });
  assert.equal(badAudit.ok, false);

  const badAi = validateAiExplainPayload({
    areaId: 'bz-1',
    areaName: 'Test Area',
    riskScore: 55,
    contributions: Array.from({ length: 20 }, (_, i) => ({
      name: `F${i}`,
      weight: 0.1,
      score: 50,
      contribution: 5,
    })),
  });
  assert.equal(badAi.ok, false);
});

test('HTTP server security controls: auth, CORS, security headers, audit cookie isolation, and rate limits', async () => {
  const db = createFireWatchDb(':memory:');
  const app = createFireWatchApp({
    db,
    getAdminToken: () => 'unit-test-admin-token-9876',
    allowedOriginsEnv: 'https://allowed.example',
    isProd: true,
    aiMinuteMax: 2,
    writeMinuteMax: 20,
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    // 1. Security headers + CORS allowlist
    const healthRes = await fetch(`${base}/api/health`, {
      headers: { Origin: 'https://allowed.example' },
    });
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(healthRes.headers.get('x-powered-by'), null);
    assert.equal(healthRes.headers.get('access-control-allow-origin'), 'https://allowed.example');
    assert.ok(healthRes.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));

    app.get('/__csp-page-check', (_req, res) => res.status(200).send('ok'));
    const pageRes = await fetch(`${base}/__csp-page-check`);
    assert.equal(pageRes.status, 200);
    assert.equal(pageRes.headers.get('x-frame-options'), null);
    assert.ok(pageRes.headers.get('content-security-policy')?.includes('https://aistudio.google.com'));

    const evilCorsRes = await fetch(`${base}/api/incidents`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(evilCorsRes.status, 403);

    // 2. Write & admin routes require Bearer ADMIN_TOKEN
    const unauthPost = await fetch(`${base}/api/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ districtId: 'bayanzurkh', causeGuessMn: 'Test' }),
    });
    assert.equal(unauthPost.status, 401);

    const wrongTokenStatus = await fetch(`${base}/api/data-management/status`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.equal(wrongTokenStatus.status, 403);

    const wrongTokenBatch = await fetch(`${base}/api/v1/incidents/batch-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify([]),
    });
    assert.equal(wrongTokenBatch.status, 403);

    const wrongTokenCache = await fetch(`${base}/api/data-management/ai-cache`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.equal(wrongTokenCache.status, 403);

    // Authorized incident creation, update, and deletion work
    const authCreate = await fetch(`${base}/api/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer unit-test-admin-token-9876',
      },
      body: JSON.stringify({
        id: 'inc-auth-1',
        districtId: 'bayanzurkh',
        khorooNumber: 2,
        causeGuessMn: 'Test chimney',
      }),
    });
    assert.equal(authCreate.status, 201);

    const authPut = await fetch(`${base}/api/incidents/inc-auth-1`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer unit-test-admin-token-9876',
      },
      body: JSON.stringify({ severity: 'critical' }),
    });
    assert.equal(authPut.status, 200);

    const unauthDelete = await fetch(`${base}/api/incidents/inc-auth-1`, { method: 'DELETE' });
    assert.equal(unauthDelete.status, 401);

    const authDelete = await fetch(`${base}/api/incidents/inc-auth-1`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer unit-test-admin-token-9876' },
    });
    assert.equal(authDelete.status, 200);

    // 3. Batch-sync > 200 limit rejection
    const oversizedBatch = Array.from({ length: 201 }, (_, i) => ({
      districtId: 'bayanzurkh',
      causeGuessMn: `Cause ${i}`,
    }));
    const batchRes = await fetch(`${base}/api/v1/incidents/batch-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer unit-test-admin-token-9876',
      },
      body: JSON.stringify(oversizedBatch),
    });
    assert.equal(batchRes.status, 400);

    // 4. Anonymous cookie session isolation on /api/audits & phone minimization
    const createAuditRes = await fetch(`${base}/api/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        districtId: 'bayanzurkh',
        khorooNumber: 2,
        homeType: 'ger',
        heatingType: 'iron_stove',
        electricalState: 'medium',
        hasSmokeDetector: false,
        hasFireExtinguisher: true,
        ashStorage: 'metal_box',
        hasChildren: true,
        hasElderly: false,
        score: 70,
        riskLevel: 'high',
        meetingPoint: 'Corner lamp',
        emergencyPhone: '+976 9999-8888',
      }),
    });
    assert.equal(createAuditRes.status, 201);
    const setCookie = createAuditRes.headers.get('set-cookie') ?? '';
    assert.ok(setCookie.includes('fw_sid='));
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Lax'));
    const cookiePair = setCookie.split(';')[0];
    const createdBody = (await createAuditRes.json()) as {
      audit: { id: string; emergencyPhone?: string; sessionId?: string };
    };
    assert.equal(createdBody.audit.emergencyPhone, undefined);
    assert.equal(createdBody.audit.sessionId, undefined);

    // Session A sees its own audit
    const listARes = await fetch(`${base}/api/audits`, {
      headers: { Cookie: cookiePair },
    });
    const listABody = (await listARes.json()) as { audits: Array<{ id: string }> };
    assert.equal(listABody.audits.length, 1);
    assert.equal(listABody.audits[0].id, createdBody.audit.id);

    // Session B (different cookie / no cookie) cannot see or delete Session A's audit
    const listNoCookieRes = await fetch(`${base}/api/audits`);
    const listNoCookieBody = (await listNoCookieRes.json()) as { audits: unknown[] };
    assert.equal(listNoCookieBody.audits.length, 0);

    const listBRes = await fetch(`${base}/api/audits`, {
      headers: { Cookie: 'fw_sid=99999999-9999-4999-8999-999999999999' },
    });
    const listBBody = (await listBRes.json()) as { audits: unknown[] };
    assert.equal(listBBody.audits.length, 0);

    const deleteByB = await fetch(`${base}/api/audits/${encodeURIComponent(createdBody.audit.id)}`, {
      method: 'DELETE',
      headers: { Cookie: 'fw_sid=99999999-9999-4999-8999-999999999999' },
    });
    assert.equal(deleteByB.status, 404);

    // 5. AI endpoint rate limiting (configured aiMinuteMax = 2 above)
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${base}/api/ai/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // Returns 503 (no GEMINI_API_KEY in test) or 400 before hitting rate cap
      assert.notEqual(r.status, 429);
    }
    const rateLimited = await fetch(`${base}/api/ai/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(rateLimited.status, 429);
    assert.ok(rateLimited.headers.get('retry-after'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
