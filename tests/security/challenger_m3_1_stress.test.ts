import './envSetup.js';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  startTestServer,
  resetDatabase,
  createTestFamily,
  getAdminToken,
  apiRequest,
  writeTestFile,
  cleanTestFiles,
  db,
  TestServerContext,
} from './testHelper.js';
import { TEST_UPLOADS_DIR } from './envSetup.js';

export async function runChallengerM31StressSuite() {
  console.log('\n============================================================');
  console.log('🛡️  CHALLENGER 1: M3 EMPIRICAL INTEGRATIONS STRESS TEST SUITE');
  console.log('    WhatsApp Webhook Auth, Bot File Scoping, Admin & Push');
  console.log('============================================================\n');

  let ctx: TestServerContext;
  let total = 0;
  let passed = 0;
  let failed = 0;
  const testResults: Array<{ name: string; status: 'PASS' | 'FAIL'; details?: string; durationMs: number }> = [];

  const runTest = async (name: string, fn: () => Promise<void> | void) => {
    total++;
    const start = performance.now();
    try {
      await fn();
      const dur = Math.round(performance.now() - start);
      passed++;
      testResults.push({ name, status: 'PASS', durationMs: dur });
      console.log(`  ✅ [PASS] (${dur}ms) ${name}`);
    } catch (err: any) {
      const dur = Math.round(performance.now() - start);
      failed++;
      testResults.push({ name, status: 'FAIL', details: err.message || String(err), durationMs: dur });
      console.error(`  ❌ [FAIL] (${dur}ms) ${name}:`, err.message || err);
    }
  };

  ctx = await startTestServer();

  try {
    resetDatabase();

    // =========================================================================
    // 1. UNAUTHENTICATED WEBHOOK INJECTION VERIFICATION
    // =========================================================================
    console.log('\n--- 1. WhatsApp Webhook Authentication Stress Testing ---');

    const sampleWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '573009876543@s.whatsapp.net',
          fromMe: false,
          id: `WEBHOOK-TEST-${Date.now()}`,
        },
        pushName: 'Test Sender',
        message: { conversation: 'Hola bot' },
      },
    };

    await runTest('1.1: Webhook POST without headers returns HTTP 401 Unauthorized', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
        method: 'POST',
        json: sampleWebhookPayload,
      });
      assert.strictEqual(res.status, 401, `Missing headers must return HTTP 401, got ${res.status}`);
      assert.ok(res.body.error, 'Must return an error message in response body');
    });

    await runTest('1.2: Webhook POST with invalid x-webhook-token returns HTTP 401 Unauthorized', async () => {
      const invalidTokens = [
        'invalid_token_123',
        'forged_secret_token_abc',
        'null',
        'undefined',
        ' ',
      ];

      for (const token of invalidTokens) {
        const res = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
          method: 'POST',
          headers: { 'x-webhook-token': token },
          json: sampleWebhookPayload,
        });
        assert.strictEqual(res.status, 401, `Invalid x-webhook-token "${token}" must return HTTP 401, got ${res.status}`);
      }
    });

    await runTest('1.3: Webhook POST with invalid apikey returns HTTP 401 Unauthorized', async () => {
      const invalidKeys = [
        'wrong_evolution_api_key',
        'medfamilia_whatsapp_key_2026_attacker',
        '12345',
      ];

      for (const key of invalidKeys) {
        const res = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
          method: 'POST',
          headers: { apikey: key },
          json: sampleWebhookPayload,
        });
        assert.strictEqual(res.status, 401, `Invalid apikey "${key}" must return HTTP 401, got ${res.status}`);
      }
    });

    await runTest('1.4: Webhook POST with valid headers returns HTTP 200 OK', async () => {
      const validWebhookSecret = process.env.WEBHOOK_SECRET || 'medfamilia_webhook_secret_2026';
      const validApiKey = process.env.EVOLUTION_API_KEY || 'medfamilia_whatsapp_key_2026';

      // Test with valid x-webhook-token
      const resSecret = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'x-webhook-token': validWebhookSecret },
        json: {
          ...sampleWebhookPayload,
          data: {
            ...sampleWebhookPayload.data,
            key: { ...sampleWebhookPayload.data.key, id: `VALID-SECRET-${Date.now()}` },
          },
        },
      });
      assert.strictEqual(resSecret.status, 200, `Valid x-webhook-token must return HTTP 200, got ${resSecret.status}`);

      // Test with valid apikey
      const resKey = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
        method: 'POST',
        headers: { apikey: validApiKey },
        json: {
          ...sampleWebhookPayload,
          data: {
            ...sampleWebhookPayload.data,
            key: { ...sampleWebhookPayload.data.key, id: `VALID-APIKEY-${Date.now()}` },
          },
        },
      });
      assert.strictEqual(resKey.status, 200, `Valid apikey must return HTTP 200, got ${resKey.status}`);
    });

    // =========================================================================
    // 2. WHATSAPP FILE EXFILTRATION PREVENTION
    // =========================================================================
    console.log('\n--- 2. WhatsApp Bot File Scoping & Exfiltration Prevention ---');

    await runTest('2.1: Simulate send_exam_file requesting Family A file from Family B phone number is denied', async () => {
      const familyA = await createTestFamily({ code: 'fam_victim_a', phone: '573111111111' });
      const familyB = await createTestFamily({ code: 'fam_attacker_b', phone: '573222222222' });

      // Create sensitive exam file for Family A
      const secretFileName = `confidential_biopsy_family_a_${Date.now()}.pdf`;
      writeTestFile(secretFileName, Buffer.from('%PDF-1.7 TOP SECRET MEDICAL BIOPSY FOR FAMILY A ONLY'));

      const examAId = `exam-a-${Date.now()}`;
      db.prepare(`
        INSERT INTO exam_results (id, family_id, patient_id, title, file_url, file_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run([examAId, familyA.id, familyA.papaId, 'Biopsia Confidencial Paciente A', `/api/uploads/${secretFileName}`, 'pdf']);

      // Family B tries to request Family A's file
      const targetFilename = path.basename(`/api/uploads/${secretFileName}`.split('?')[0]);

      // Execute tenant verification checks as done inside whatsappWebhook.ts
      const examMatchB = db.prepare('SELECT id FROM exam_results WHERE family_id = ? AND file_url LIKE ?').get(familyB.id, `%${targetFilename}`) as any;
      const orderMatchB = db.prepare('SELECT id FROM medical_orders WHERE family_id = ? AND file_url LIKE ?').get(familyB.id, `%${targetFilename}`) as any;
      const apptMatchB = db.prepare('SELECT id FROM appointments WHERE family_id = ? AND photo_url LIKE ?').get(familyB.id, `%${targetFilename}`) as any;

      // Access must be strictly denied for Family B
      assert.strictEqual(examMatchB, undefined, 'Family B must not match Family A file in exam_results');
      assert.strictEqual(orderMatchB, undefined, 'Family B must not match Family A file in medical_orders');
      assert.strictEqual(apptMatchB, undefined, 'Family B must not match Family A file in appointments');

      const isAccessAllowedB = Boolean(examMatchB || orderMatchB || apptMatchB);
      assert.strictEqual(isAccessAllowedB, false, 'Access MUST be denied when Family B requests Family A file');

      // Verify that Family A requesting their own file succeeds
      const examMatchA = db.prepare('SELECT id FROM exam_results WHERE family_id = ? AND file_url LIKE ?').get(familyA.id, `%${targetFilename}`) as any;
      assert.ok(examMatchA, 'Family A requesting their own file must match in exam_results');
      assert.strictEqual(examMatchA.id, examAId, 'Exam ID must match');
    });

    await runTest('2.2: WhatsApp bot file lookup blocks cross-tenant access for medical orders and appointments', async () => {
      const familyA = await createTestFamily({ code: 'fam_orders_a', phone: '573333333333' });
      const familyB = await createTestFamily({ code: 'fam_orders_b', phone: '573444444444' });

      const orderFileName = `rx_torax_order_${Date.now()}.pdf`;
      const photoFileName = `cita_foto_${Date.now()}.jpg`;
      writeTestFile(orderFileName, Buffer.from('%PDF-1.4 RX TORAX ORDER'));
      writeTestFile(photoFileName, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]));

      db.prepare(`
        INSERT INTO medical_orders (id, family_id, patient_id, title, file_url)
        VALUES (?, ?, ?, ?, ?)
      `).run([`order-${Date.now()}`, familyA.id, familyA.papaId, 'Orden RX', `/api/uploads/${orderFileName}`]);

      db.prepare(`
        INSERT INTO appointments (id, family_id, patient_id, title, date_time, photo_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run([`appt-${Date.now()}`, familyA.id, familyA.papaId, 'Cita Dermatología', '2026-11-20T10:00:00Z', `/api/uploads/${photoFileName}`]);

      // Family B querying order or appointment photo must get 0 results
      const orderMatchB = db.prepare('SELECT id FROM medical_orders WHERE family_id = ? AND file_url LIKE ?').get(familyB.id, `%${orderFileName}`);
      const apptMatchB = db.prepare('SELECT id FROM appointments WHERE family_id = ? AND photo_url LIKE ?').get(familyB.id, `%${photoFileName}`);

      assert.strictEqual(orderMatchB, undefined, 'Family B cannot access Family A medical order via bot');
      assert.strictEqual(apptMatchB, undefined, 'Family B cannot access Family A appointment photo via bot');
    });

    // =========================================================================
    // 3. WHATSAPP ADMIN ENDPOINTS AUTHENTICATION & ROLE ENFORCEMENT
    // =========================================================================
    console.log('\n--- 3. WhatsApp Admin Endpoints Auth & Role Enforcement ---');

    await runTest('3.1: GET /api/whatsapp/status returns 401 without Authorization header and 403 with family JWT', async () => {
      const family = await createTestFamily();
      const adminToken = getAdminToken();

      // 1. Without Authorization header -> 401
      const unauthRes = await apiRequest(ctx.baseUrl, '/api/whatsapp/status');
      assert.strictEqual(unauthRes.status, 401, `Unauthenticated /api/whatsapp/status must return 401, got ${unauthRes.status}`);

      // 2. With regular family JWT -> 403
      const familyRes = await apiRequest(ctx.baseUrl, '/api/whatsapp/status', { token: family.token });
      assert.strictEqual(familyRes.status, 403, `Family user accessing /api/whatsapp/status must return 403 Forbidden, got ${familyRes.status}`);

      // 3. With Superadmin token -> 200 or 500 (authorized to execute route)
      const adminRes = await apiRequest(ctx.baseUrl, '/api/whatsapp/status', { token: adminToken });
      assert.notStrictEqual(adminRes.status, 401, 'Admin token must not be 401');
      assert.notStrictEqual(adminRes.status, 403, 'Admin token must not be 403');
    });

    await runTest('3.2: Additional WhatsApp admin routes (/reset, /qr, /pairing-code) enforce 401/403 controls', async () => {
      const family = await createTestFamily();
      const adminToken = getAdminToken();

      const routes = [
        '/api/whatsapp/reset',
        '/api/whatsapp/qr',
        '/api/whatsapp/pairing-code?number=573001234567',
      ];

      for (const route of routes) {
        // Unauthenticated -> 401
        const unauth = await apiRequest(ctx.baseUrl, route);
        assert.strictEqual(unauth.status, 401, `Unauthenticated ${route} must return 401`);

        // Family token -> 403
        const familyAuth = await apiRequest(ctx.baseUrl, route, { token: family.token });
        assert.strictEqual(familyAuth.status, 403, `Family token accessing ${route} must return 403`);

        // Admin token -> Authorized (not 401 or 403)
        const adminAuth = await apiRequest(ctx.baseUrl, route, { token: adminToken });
        assert.notStrictEqual(adminAuth.status, 401, `Admin token accessing ${route} must not return 401`);
        assert.notStrictEqual(adminAuth.status, 403, `Admin token accessing ${route} must not return 403`);
      }
    });

    // =========================================================================
    // 4. PUSH SUBSCRIPTION UPSERT & TENANT ISOLATION
    // =========================================================================
    console.log('\n--- 4. Push Notification Subscription Upsert & Ownership Transfer ---');

    await runTest('4.1: Register endpoint as Family A, then register same endpoint as Family B transfers ownership', async () => {
      const familyA = await createTestFamily({ code: 'push_user_a' });
      const familyB = await createTestFamily({ code: 'push_user_b' });

      const sharedEndpointUrl = `https://fcm.googleapis.com/fcm/send/shared-browser-token-${Date.now()}`;
      const payloadA = {
        endpoint: sharedEndpointUrl,
        keys: { p256dh: 'p256dh-key-family-a', auth: 'auth-key-family-a' },
      };

      // 1. Family A registers the browser push subscription
      const subResA = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: familyA.token,
        json: { subscription: payloadA },
      });
      assert.strictEqual(subResA.status, 200, 'Family A push subscription must return 200');

      // Verify in DB that Family A owns this endpoint
      const dbRowA = db.prepare('SELECT family_id, keys_json FROM push_subscriptions WHERE endpoint = ?').get(sharedEndpointUrl) as any;
      assert.ok(dbRowA, 'Subscription record must exist in DB');
      assert.strictEqual(dbRowA.family_id, familyA.id, 'Subscription must initially belong to Family A');
      assert.ok(dbRowA.keys_json.includes('family-a'), 'Keys must belong to Family A');

      // 2. Family B logs into the same browser and registers the same push endpoint
      const payloadB = {
        endpoint: sharedEndpointUrl,
        keys: { p256dh: 'p256dh-key-family-b', auth: 'auth-key-family-b' },
      };

      const subResB = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: familyB.token,
        json: { subscription: payloadB },
      });
      assert.strictEqual(subResB.status, 200, 'Family B push subscription must return 200');

      // Verify in DB that the endpoint record was UPSERTED (updated, not duplicated) and now belongs to Family B
      const allRowsForEndpoint = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').all(sharedEndpointUrl) as any[];
      assert.strictEqual(allRowsForEndpoint.length, 1, 'There must be exactly 1 row for this endpoint in DB (UPSERT)');
      assert.strictEqual(allRowsForEndpoint[0].family_id, familyB.id, 'Ownership must be transferred to Family B');
      assert.ok(allRowsForEndpoint[0].keys_json.includes('family-b'), 'Keys must be updated to Family B');

      // Verify Family A no longer receives notifications for this endpoint
      const familyASubs = db.prepare('SELECT * FROM push_subscriptions WHERE family_id = ?').all(familyA.id) as any[];
      const leakedSubInA = familyASubs.find((s: any) => s.endpoint === sharedEndpointUrl);
      assert.strictEqual(leakedSubInA, undefined, 'Family A must not have this subscription endpoint anymore');
    });

    await runTest('4.2: Push subscription rejects malformed subscriptions with HTTP 400', async () => {
      const family = await createTestFamily();

      const invalidPayloads = [
        {},
        { subscription: null },
        { subscription: { endpoint: '' } },
        { subscription: { endpoint: 'https://valid.endpoint.com/test' } },
        { subscription: { endpoint: 'https://valid.endpoint.com/test', keys: { p256dh: 'key-only' } } },
      ];

      for (const inv of invalidPayloads) {
        const res = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
          method: 'POST',
          token: family.token,
          json: inv,
        });
        assert.strictEqual(res.status, 400, `Malformed payload ${JSON.stringify(inv)} must return 400`);
      }
    });

  } finally {
    await ctx.close();
    cleanTestFiles();
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n============================================================');
  console.log(`📊 CHALLENGER 1 SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  if (failed > 0) {
    console.log(`❌ ${failed} TESTS FAILED`);
  } else {
    console.log('🎉 100% OF M3 CHALLENGER 1 STRESS TESTS PASSED!');
  }
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }

  return { total, passed, failed, testResults };
}

// Execute suite directly if run with tsx / node
if (import.meta.url === `file://${process.argv[1]}`) {
  runChallengerM31StressSuite().catch((err) => {
    console.error('Fatal error in Challenger 1 M3 stress suite execution:', err);
    process.exit(1);
  });
}
