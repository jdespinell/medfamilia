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
import { runAllSecurityTests } from './run_all_tests.js';

export async function runM4AdversarialStressSuite() {
  console.log('\n================================================================');
  console.log('⚔️  CHALLENGER 2: M4 ADVERSARIAL STRESS & EMPIRICAL HARNESS');
  console.log('    CORS Origin Restriction, Schema Hardening & Full Suite');
  console.log('================================================================\n');

  let ctx: TestServerContext;
  let total = 0;
  let passed = 0;
  let failed = 0;
  const failureDetails: Array<{ test: string; error: string }> = [];

  const test = async (name: string, fn: () => Promise<void> | void) => {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      failureDetails.push({ test: name, error: err.message || String(err) });
      console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
    }
  };

  try {
    ctx = await startTestServer();
    resetDatabase();

    // =========================================================================
    // SECTION 1: UNAUTHORIZED CORS ORIGINS REJECTION STRESS TEST
    // =========================================================================
    console.log('\n--- Section 1: Unauthorized CORS Origin Rejection Stress Test ---');

    await test('M4.S1.1: GET /api/health rejects unauthorized origin http://evil-attacker.com without reflecting CORS', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/health', {
        headers: {
          origin: 'http://evil-attacker.com',
        },
      });

      const allowOrigin = res.headers.get('access-control-allow-origin');
      assert.notStrictEqual(
        allowOrigin,
        'http://evil-attacker.com',
        'Unauthorized origin must NOT be reflected in Access-Control-Allow-Origin'
      );
      assert.notStrictEqual(
        allowOrigin,
        '*',
        'Wildcard * must NOT be reflected for unauthorized origin'
      );
    });

    await test('M4.S1.2: POST /api/auth/login rejects unauthorized origin http://evil-attacker.com without reflecting CORS', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: {
          origin: 'http://evil-attacker.com',
        },
        json: { code: 'test_family', password: 'password123' },
      });

      const allowOrigin = res.headers.get('access-control-allow-origin');
      assert.notStrictEqual(
        allowOrigin,
        'http://evil-attacker.com',
        'Unauthorized origin must NOT be reflected in Access-Control-Allow-Origin on auth endpoint'
      );
      assert.notStrictEqual(
        allowOrigin,
        '*',
        'Wildcard * must NOT be reflected on auth endpoint'
      );
    });

    await test('M4.S1.3: Subdomain and prefix spoofing origins (localhost.evil.com, 127.0.0.1.attacker.org, null) are rejected', async () => {
      const spoofedOrigins = [
        'http://localhost.evil.com',
        'http://127.0.0.1.attacker.org',
        'http://evil-localhost:5173',
        'http://localhost.attacker:3000',
        'https://attacker-medfamilia.app',
        'http://localhost:5173.evil.org',
        'null',
        'https://malicious-phishing-site.xyz',
      ];

      for (const spoofedOrigin of spoofedOrigins) {
        const res = await apiRequest(ctx.baseUrl, '/api/health', {
          headers: { origin: spoofedOrigin },
        });

        const allowOrigin = res.headers.get('access-control-allow-origin');
        assert.notStrictEqual(
          allowOrigin,
          spoofedOrigin,
          `Spoofed origin '${spoofedOrigin}' must NOT be reflected in Access-Control-Allow-Origin`
        );
        assert.notStrictEqual(
          allowOrigin,
          '*',
          `Wildcard * must NOT be reflected for spoofed origin '${spoofedOrigin}'`
        );
      }
    });

    await test('M4.S1.4: Preflight OPTIONS request from unauthorized origin does not grant CORS access', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://evil-attacker.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, authorization',
        },
      });

      const allowOrigin = res.headers.get('access-control-allow-origin');
      assert.notStrictEqual(
        allowOrigin,
        'http://evil-attacker.com',
        'Preflight OPTIONS request from unauthorized origin must NOT receive Access-Control-Allow-Origin header'
      );
      assert.notStrictEqual(
        allowOrigin,
        '*',
        'Preflight OPTIONS request must NOT return wildcard *'
      );
    });

    await test('M4.S1.5: Requests without Origin header (curl, mobile apps) do not return wildcard * with credentials', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/health');
      assert.strictEqual(res.status, 200);

      const allowOrigin = res.headers.get('access-control-allow-origin');
      const allowCreds = res.headers.get('access-control-allow-credentials');

      if (allowCreds === 'true') {
        assert.notStrictEqual(
          allowOrigin,
          '*',
          'Access-Control-Allow-Origin must not be "*" when credentials are true'
        );
      }
      assert.strictEqual(allowOrigin, null, 'No-origin requests should omit Access-Control-Allow-Origin header');
    });

    // =========================================================================
    // SECTION 2: AUTHORIZED CORS ORIGINS & CREDENTIALS VERIFICATION
    // =========================================================================
    console.log('\n--- Section 2: Authorized CORS Origin Reflection & Credentials ---');

    await test('M4.S2.1: Authorized origin http://localhost:5173 is reflected with credentials allowed', async () => {
      const origin = 'http://localhost:5173';
      const res = await apiRequest(ctx.baseUrl, '/api/health', {
        headers: { origin },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(
        res.headers.get('access-control-allow-origin'),
        origin,
        `Expected Access-Control-Allow-Origin to match '${origin}'`
      );
      assert.strictEqual(
        res.headers.get('access-control-allow-credentials'),
        'true',
        'Expected Access-Control-Allow-Credentials to be true'
      );
    });

    await test('M4.S2.2: Authorized origin http://127.0.0.1:3000 is reflected with credentials allowed', async () => {
      const origin = 'http://127.0.0.1:3000';
      const res = await apiRequest(ctx.baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { origin },
        json: { code: 'nonexistent', password: 'wrong' },
      });

      assert.strictEqual(
        res.headers.get('access-control-allow-origin'),
        origin,
        `Expected Access-Control-Allow-Origin to match '${origin}'`
      );
      assert.strictEqual(
        res.headers.get('access-control-allow-credentials'),
        'true',
        'Expected Access-Control-Allow-Credentials to be true'
      );
    });

    await test('M4.S2.3: Multiple local dev ports (localhost:3000, 127.0.0.1:5173, localhost:8080) are accepted', async () => {
      const authorizedOrigins = [
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:8080',
      ];

      for (const origin of authorizedOrigins) {
        const res = await apiRequest(ctx.baseUrl, '/api/health', {
          headers: { origin },
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(
          res.headers.get('access-control-allow-origin'),
          origin,
          `Origin '${origin}' should be allowed and reflected`
        );
        assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');
      }
    });

    await test('M4.S2.4: Preflight OPTIONS request from authorized origin returns 200/204 with allowed methods & headers', async () => {
      const origin = 'http://localhost:5173';
      const res = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'Content-Type, Authorization',
        },
      });

      assert.ok([200, 204].includes(res.status), `Preflight OPTIONS should return 200 or 204, got ${res.status}`);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), origin);
      assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');

      const allowMethods = res.headers.get('access-control-allow-methods');
      assert.ok(allowMethods, 'Access-Control-Allow-Methods header must be present');
      assert.ok(allowMethods.includes('POST'), 'Access-Control-Allow-Methods must include POST');
      assert.ok(allowMethods.includes('GET'), 'Access-Control-Allow-Methods must include GET');
      assert.ok(allowMethods.includes('PUT'), 'Access-Control-Allow-Methods must include PUT');
      assert.ok(allowMethods.includes('DELETE'), 'Access-Control-Allow-Methods must include DELETE');
    });

    // =========================================================================
    // SECTION 3: DECLARATIVE SCHEMA VALIDATION REJECTION & STRESS TESTS
    // =========================================================================
    console.log('\n--- Section 3: Route Schema Hardening & Input Rejection Fuzzing ---');

    const fam = await createTestFamily();

    await test('M4.S3.1: POST /api/auth/send-whatsapp-otp rejects missing, non-digit, and out-of-range phone numbers', async () => {
      // 1. Missing phone_number
      const res1 = await apiRequest(ctx.baseUrl, '/api/auth/send-whatsapp-otp', {
        method: 'POST',
        json: {},
      });
      assert.strictEqual(res1.status, 400, 'Missing phone_number must return 400');
      assert.ok(res1.body.error);

      // 2. Short phone number (< 7 digits)
      const res2 = await apiRequest(ctx.baseUrl, '/api/auth/send-whatsapp-otp', {
        method: 'POST',
        json: { phone_number: '123' },
      });
      assert.strictEqual(res2.status, 400, 'Too short phone number must return 400');

      // 3. Excessively long phone number (> 20 chars)
      const res3 = await apiRequest(ctx.baseUrl, '/api/auth/send-whatsapp-otp', {
        method: 'POST',
        json: { phone_number: '5730012345678901234567890' },
      });
      assert.strictEqual(res3.status, 400, 'Oversized phone number must return 400');

      // 4. Non-string phone number (array / object)
      const res4 = await apiRequest(ctx.baseUrl, '/api/auth/send-whatsapp-otp', {
        method: 'POST',
        json: { phone_number: { nested: '573001234567' } },
      });
      assert.strictEqual(res4.status, 400, 'Object phone number must return 400');
    });

    await test('M4.S3.2: POST /api/auth/register enforces strict schema validation on all registration fields', async () => {
      // 1. Missing required fields
      const res1 = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: { code: 'fam_incomplete' },
      });
      assert.strictEqual(res1.status, 400, 'Missing required fields must return 400');

      // 2. Oversized strings (> 100 chars for name)
      const res2 = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: {
          code: 'fam_valid',
          name: 'A'.repeat(150),
          password: 'password123',
          phone_number: '573001112233',
          otp: '123456',
        },
      });
      assert.strictEqual(res2.status, 400, 'Oversized family name must return 400');

      // 3. Invalid OTP pattern (non-6 digit or non-numeric)
      const res3 = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: {
          code: 'fam_valid2',
          name: 'Familia Valida',
          password: 'password123',
          phone_number: '573001112233',
          otp: 'abc',
        },
      });
      assert.strictEqual(res3.status, 400, 'Invalid OTP format must return 400');
    });

    await test('M4.S3.3: POST /api/patients validates name, relationship enum, and hex color format strictly', async () => {
      // 1. Missing name
      const res1 = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: fam.token,
        json: { relationship: 'Hijo', color: '#3b82f6' },
      });
      assert.strictEqual(res1.status, 400, 'Missing patient name must return 400');

      // 2. Oversized name (> 100 chars)
      const res2 = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: fam.token,
        json: { name: 'P'.repeat(150), relationship: 'Hijo', color: '#3b82f6' },
      });
      assert.strictEqual(res2.status, 400, 'Oversized patient name must return 400');

      // 3. Invalid Hex Color format (#GGGGGG, #12345, blue, <script>)
      const invalidColors = ['blue', '#12345', '#GGGGGG', '<script>alert(1)</script>', '#1234567'];
      for (const badColor of invalidColors) {
        const resColor = await apiRequest(ctx.baseUrl, '/api/patients', {
          method: 'POST',
          token: fam.token,
          json: { name: 'Paciente Color Test', relationship: 'Padre', color: badColor },
        });
        assert.strictEqual(resColor.status, 400, `Invalid hex color '${badColor}' must return 400`);
      }
    });

    await test('M4.S3.4: Patient ID route params strictly validate UUID / ID format on PUT and DELETE', async () => {
      const badIds = [
        '../etc/passwd',
        'invalid!uuid@',
        'DROP TABLE patients;',
        'A'.repeat(150),
      ];

      for (const badId of badIds) {
        const putRes = await apiRequest(ctx.baseUrl, `/api/patients/${encodeURIComponent(badId)}`, {
          method: 'PUT',
          token: fam.token,
          json: { name: 'Nombre Test' },
        });
        assert.strictEqual(putRes.status, 400, `Malformed patient ID param on PUT '${badId}' must return 400`);

        const delRes = await apiRequest(ctx.baseUrl, `/api/patients/${encodeURIComponent(badId)}`, {
          method: 'DELETE',
          token: fam.token,
        });
        assert.strictEqual(delRes.status, 400, `Malformed patient ID param on DELETE '${badId}' must return 400`);
      }
    });

    await test('M4.S3.5: POST and PUT /api/appointments strictly validate date, title length, and enums', async () => {
      // 1. Malformed date on POST
      const res1 = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.papaId,
          title: 'Cita Mal Formato',
          date_time: '2026-99-99T99:99:99Z',
        },
      });
      assert.strictEqual(res1.status, 400, 'Invalid date string must return 400');

      // 2. Oversized title (> 200 chars) on POST
      const res2 = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.papaId,
          title: 'T'.repeat(300),
          date_time: '2026-11-20T10:00:00Z',
        },
      });
      assert.strictEqual(res2.status, 400, 'Oversized appointment title must return 400');

      // 3. Invalid appointment_type enum on POST
      const res3 = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.papaId,
          title: 'Cita Tipo Invalido',
          date_time: '2026-11-20T10:00:00Z',
          appointment_type: 'hacked_type',
        },
      });
      assert.strictEqual(res3.status, 400, 'Invalid appointment_type enum must return 400');

      // 4. Create valid appointment for PUT tests
      const validAppt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.papaId,
          title: 'Cita para Actualizar',
          date_time: '2026-11-20T10:00:00Z',
        },
      });
      assert.strictEqual(validAppt.status, 200);

      // 5. Invalid status enum on PUT
      const resPutStatus = await apiRequest(ctx.baseUrl, `/api/appointments/${validAppt.body.id}`, {
        method: 'PUT',
        token: fam.token,
        json: { status: 'invalid_status_value' },
      });
      assert.strictEqual(resPutStatus.status, 400, 'Invalid status enum on PUT must return 400');
    });

    await test('M4.S3.6: Admin routes validate plan enum and integer usage counts strictly', async () => {
      const adminToken = getAdminToken();

      // 1. Invalid plan type (must be 'gratuito' | 'pago')
      const res1 = await apiRequest(ctx.baseUrl, `/api/admin/families/${fam.id}/plan`, {
        method: 'PATCH',
        token: adminToken,
        json: { plan_type: 'unlimited_enterprise_vip' },
      });
      assert.strictEqual(res1.status, 400, 'Invalid plan enum value must return 400');

      // 2. Negative max_daily_whatsapp_queries
      const res2 = await apiRequest(ctx.baseUrl, `/api/admin/families/${fam.id}/plan`, {
        method: 'PATCH',
        token: adminToken,
        json: { plan_type: 'pago', max_daily_whatsapp_queries: -5 },
      });
      assert.strictEqual(res2.status, 400, 'Negative query quota must return 400');

      // 3. Valid plan update passes
      const res3 = await apiRequest(ctx.baseUrl, `/api/admin/families/${fam.id}/plan`, {
        method: 'PATCH',
        token: adminToken,
        json: { plan_type: 'pago', max_daily_whatsapp_queries: 100 },
      });
      assert.strictEqual(res3.status, 200, 'Valid plan update must return 200');
    });

    await test('M4.S3.7: Multipart upload validation failure immediately unlinks uploaded files to prevent orphaned staging storage', async () => {
      cleanTestFiles();
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      // Create a valid image buffer
      const fakeValidPng = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        Buffer.alloc(100, 0xAA),
      ]);

      // Missing required fields (patient_id) triggers schema validation error
      const res = await apiRequest(ctx.baseUrl, '/api/exams/upload', {
        method: 'POST',
        token: fam.token,
        multipart: {
          fields: {
            title: 'Examen Sin Paciente',
            // patient_id is missing!
          },
          files: [
            {
              name: 'file',
              filename: 'orphan_prevent_test.png',
              buffer: fakeValidPng,
              mimeType: 'image/png',
            },
          ],
        },
      });

      assert.strictEqual(res.status, 400, 'Missing patient_id must trigger validation 400');
      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(
        afterFiles.length,
        beforeFiles.length,
        'Uploaded multipart file must be unlinked immediately when validation fails'
      );
    });

    // =========================================================================
    // SECTION 4: FULL SECURITY TEST HARNESS REGRESSION (38/38 TESTS)
    // =========================================================================
    console.log('\n--- Section 4: Full Security Test Harness Regression (38/38) ---');

    await test('M4.S4.1: Master 4-Tier security test harness executes with 38/38 tests passing (100%)', async () => {
      const suiteResults = await runAllSecurityTests();

      assert.strictEqual(suiteResults.total, 38, `Expected exactly 38 total tests, got ${suiteResults.total}`);
      assert.strictEqual(suiteResults.passed, 38, `Expected exactly 38 passed tests, got ${suiteResults.passed}`);
      assert.strictEqual(suiteResults.failed, 0, `Expected 0 failures, got ${suiteResults.failed}`);
      assert.strictEqual(
        suiteResults.vulnerabilities.length,
        0,
        `Expected 0 vulnerabilities detected, found: ${suiteResults.vulnerabilities.join(', ')}`
      );
    });

  } finally {
    cleanTestFiles();
    if (ctx!) await ctx.close();
  }

  console.log('\n================================================================');
  console.log(`📊 CHALLENGER M4 SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error('❌ Failures Encountered:');
    failureDetails.forEach((f) => console.error(`  - ${f.test}: ${f.error}`));
    throw new Error(`Challenger M4 Stress Suite failed with ${failed} failure(s).`);
  }

  return { total, passed, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runM4AdversarialStressSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
