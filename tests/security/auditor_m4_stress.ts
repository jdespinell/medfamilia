import './envSetup.js';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { v, validateRequest, validateBody, validateParams, validateQuery } from '../../server/src/middleware/validation.js';
import {
  startTestServer,
  resetDatabase,
  createTestFamily,
  getAdminToken,
  apiRequest,
  writeTestFile,
  db,
  TestServerContext,
} from './testHelper.js';

async function runAuditorM4ForensicStressSuite() {
  console.log('\n================================================================');
  console.log('🔬 INDEPENDENT AUDITOR FORENSIC INTEGRITY & ADVERSARIAL STRESS SUITE');
  console.log('   Milestone 4: Input Validation & Schema Hardening Verification');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;
  const failures: Array<{ name: string; error: string }> = [];

  const runCheck = async (name: string, fn: () => Promise<void> | void) => {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [FORENSIC PASS] ${name}`);
    } catch (err: any) {
      failures.push({ name, error: err.message || String(err) });
      console.error(`  ❌ [FORENSIC FAIL] ${name}:`, err.message || err);
    }
  };

  // -------------------------------------------------------------------------
  // FORENSIC AREA 1: DIRECT VALIDATION MIDDLEWARE UNIT INTEGRITY
  // -------------------------------------------------------------------------
  console.log('\n--- Forensic Area 1: Direct Schema Engine Integrity ---');

  await runCheck('F1.1: v.string validation bounds and regex', () => {
    const stringVal = v.string({ min: 3, max: 10, pattern: /^[a-z]+$/ });
    assert.strictEqual(stringVal('abc', 'test').valid, true);
    assert.strictEqual(stringVal('ab', 'test').valid, false); // too short
    assert.strictEqual(stringVal('abcdefghijk', 'test').valid, false); // too long
    assert.strictEqual(stringVal('abc1', 'test').valid, false); // pattern mismatch
    assert.strictEqual(stringVal(123 as any, 'test').valid, false); // non-string
    assert.strictEqual(stringVal(null, 'test').valid, false); // required null
    
    // Optional with default
    const optStr = v.string({ optional: true, default: 'fallback' });
    const resOpt = optStr(undefined, 'test');
    assert.strictEqual(resOpt.valid, true);
    assert.strictEqual((resOpt as any).value, 'fallback');
  });

  await runCheck('F1.2: v.uuid & v.enum validation', () => {
    const uuidVal = v.uuid();
    assert.strictEqual(uuidVal('123e4567-e89b-12d3-a456-426614174000', 'id').valid, true);
    assert.strictEqual(uuidVal('valid-entity-id_123', 'id').valid, true);
    assert.strictEqual(uuidVal('bad uuid with spaces!', 'id').valid, false);
    assert.strictEqual(uuidVal('', 'id').valid, false);

    const enumVal = v.enum(['consulta', 'examen'] as const);
    assert.strictEqual(enumVal('consulta', 'type').valid, true);
    assert.strictEqual(enumVal('inyeccion', 'type').valid, false);
  });

  await runCheck('F1.3: v.phone & v.hexColor & v.isoDate validation', () => {
    const phoneVal = v.phone({ minDigits: 10, maxDigits: 12 });
    assert.strictEqual(phoneVal('3001234567', 'phone').valid, true);
    assert.strictEqual(phoneVal('+57 (300) 123-4567', 'phone').valid, true);
    assert.strictEqual(phoneVal('123', 'phone').valid, false); // too few digits

    const hexVal = v.hexColor();
    assert.strictEqual(hexVal('#3b82f6', 'color').valid, true);
    assert.strictEqual(hexVal('#FFF', 'color').valid, false); // short hex rejected
    assert.strictEqual(hexVal('red', 'color').valid, false);

    const isoVal = v.isoDate();
    assert.strictEqual(isoVal('2026-08-28T12:00:00Z', 'date').valid, true);
    assert.strictEqual(isoVal('not-a-date', 'date').valid, false);
  });

  await runCheck('F1.4: v.number & v.boolean & v.url & v.object & v.array validation', () => {
    const numVal = v.number({ min: 0, max: 100, integer: true });
    assert.strictEqual(numVal(50, 'num').valid, true);
    assert.strictEqual(numVal(150, 'num').valid, false);
    assert.strictEqual(numVal(3.14, 'num').valid, false);

    const boolVal = v.boolean();
    assert.strictEqual(boolVal(true, 'b').valid, true);
    assert.strictEqual(boolVal('true', 'b').valid, true);
    assert.strictEqual(boolVal('invalid', 'b').valid, false);

    const urlVal = v.url();
    assert.strictEqual(urlVal('https://fcm.googleapis.com/fcm/send/abc', 'url').valid, true);
    assert.strictEqual(urlVal('javascript:alert(1)', 'url').valid, false);

    const objVal = v.object({
      name: v.string({ min: 1 }),
      age: v.number({ min: 0 }),
    });
    assert.strictEqual(objVal({ name: 'Ana', age: 30 }, 'person').valid, true);
    assert.strictEqual(objVal({ name: '', age: 30 }, 'person').valid, false);

    const arrVal = v.array(v.string({ min: 1 }), { min: 1, max: 3 });
    assert.strictEqual(arrVal(['a', 'b'], 'list').valid, true);
    assert.strictEqual(arrVal([], 'list').valid, false); // below min
    assert.strictEqual(arrVal(['a', 'b', 'c', 'd'], 'list').valid, false); // above max
  });

  // -------------------------------------------------------------------------
  // FORENSIC AREA 2: ROUTE-LEVEL ENDPOINT ADVERSARIAL VERIFICATION
  // -------------------------------------------------------------------------
  console.log('\n--- Forensic Area 2: Live Route Validation & Rejection Responses ---');

  let ctx: TestServerContext;

  try {
    ctx = await startTestServer();
    resetDatabase();

    const family = await createTestFamily();
    const adminToken = getAdminToken();

    await runCheck('F2.1: /api/auth/send-whatsapp-otp rejects invalid phone format', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/auth/send-whatsapp-otp', {
        method: 'POST',
        json: { phone: '123' },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error, 'Error message expected');
      assert.ok(Array.isArray(res.body.details), 'Validation details array expected');
    });

    await runCheck('F2.2: /api/auth/register rejects invalid OTP and malformed code', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: {
          name: 'Fam',
          code: 'bad code with spaces!',
          password: 'pass', // too short (<6)
          phone: '3001234567',
          otp_code: '123', // length not 6
        },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.details.length >= 1);
    });

    await runCheck('F2.3: /api/auth/login rejects empty credentials', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/auth/login', {
        method: 'POST',
        json: { code: '', password: '' },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    await runCheck('F2.4: /api/admin/families/:id/plan rejects invalid enum and negative queries', async () => {
      const res = await apiRequest(ctx.baseUrl, `/api/admin/families/${family.id}/plan`, {
        method: 'PATCH',
        token: adminToken,
        json: {
          plan_type: 'super_unlimited_invalid',
          max_daily_whatsapp_queries: -5,
        },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.details.some((d: any) => d.field === 'plan_type' || d.field === 'max_daily_whatsapp_queries'));
    });

    await runCheck('F2.5: /api/patients rejects malformed hex color and empty name', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: family.token,
        json: {
          name: '',
          relationship: 'Hijo',
          color: 'red',
        },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    await runCheck('F2.6: /api/appointments rejects invalid ISO date and invalid enum type', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family.token,
        json: {
          patient_id: family.papaId,
          title: 'Cita Pediatría',
          date_time: '2026-99-99 99:99', // invalid date
          appointment_type: 'cirugia_cosmetica_invalida', // invalid enum
        },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    await runCheck('F2.7: /api/medical-orders/confirm-batch rejects empty array or malformed order structure', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders/confirm-batch', {
        method: 'POST',
        token: family.token,
        json: {
          orders: [], // below min 1
        },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    await runCheck('F2.8: /api/push/subscribe rejects invalid URL in subscription endpoint', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: family.token,
        json: {
          subscription: {
            endpoint: 'javascript:stealCredentials()',
            keys: {
              p256dh: 'testKey123',
              auth: 'testAuth123',
            },
          },
        },
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    // -------------------------------------------------------------------------
    // FORENSIC AREA 3: MULTIPART UPLOAD STAGING CLEANUP ON VALIDATION ERROR
    // -------------------------------------------------------------------------
    console.log('\n--- Forensic Area 3: Orphaned Staging File Cleanup ---');

    await runCheck('F3.1: Staging file is unlinked immediately when validation fails on multipart route', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/exams/upload', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: 'invalid-uuid-format-here!!',
            title: 'Test Exam',
          },
          files: [
            {
              name: 'file',
              filename: 'audit_validation_test.png',
              buffer: Buffer.from('TEST_IMAGE_DATA'),
              mimeType: 'image/png',
            },
          ],
        },
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);

      // Verify no orphaned files with 'audit_validation_test' remain in uploads directory
      const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        const leaked = files.filter((f) => f.includes('audit_validation_test'));
        assert.strictEqual(leaked.length, 0, 'No orphaned staging file should remain in uploads');
      }
    });

    // -------------------------------------------------------------------------
    // FORENSIC AREA 4: CORS ORIGIN SECURITY VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- Forensic Area 4: Strict CORS Origin Protection ---');

    await runCheck('F4.1: Disallowed external origin does not receive Access-Control-Allow-Origin reflection', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/health', {
        headers: {
          origin: 'https://evil-attacker-site.com',
        },
      });
      const acao = res.headers.get('access-control-allow-origin');
      assert.notStrictEqual(acao, 'https://evil-attacker-site.com', 'Disallowed origin should not be reflected');
      assert.notStrictEqual(acao, '*', 'Wildcard origin should not be emitted');
    });

    await runCheck('F4.2: Localhost origin is allowed with credentials', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/health', {
        headers: {
          origin: 'http://localhost:5173',
        },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');
    });

    await runCheck('F4.3: Request with no origin header does not reflect wildcard * with credentials', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/health');
      assert.strictEqual(res.status, 200);
      const acao = res.headers.get('access-control-allow-origin');
      assert.strictEqual(acao, null, 'No Origin header should result in no Access-Control-Allow-Origin header');
    });

  } finally {
    // cleanup
  }

  console.log('\n================================================================');
  console.log(`📊 FORENSIC AUDITOR M4 SUMMARY: ${passed}/${total} CHECKS PASSED (${failures.length} FAILED)`);
  console.log('================================================================\n');

  if (failures.length > 0) {
    process.exit(1);
  }
}

runAuditorM4ForensicStressSuite().catch((err) => {
  console.error('Fatal auditor suite error:', err);
  process.exit(1);
});
