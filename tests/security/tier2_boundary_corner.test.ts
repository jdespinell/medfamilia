import './envSetup.js';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import {
  startTestServer,
  resetDatabase,
  createTestFamily,
  getAdminToken,
  apiRequest,
  writeTestFile,
  db,
  TestServerContext
} from './testHelper.js';

export async function runTier2Tests(): Promise<{ total: number; passed: number; failed: number; errors: any[] }> {
  console.log('\n============================================================');
  console.log('🧪 RUNNING TIER 2: BOUNDARY & CORNER CASES (FUZZING & EDGES)');
  console.log('============================================================\n');

  let ctx: TestServerContext;
  let total = 0;
  let passed = 0;
  let failed = 0;
  const errors: any[] = [];

  const test = async (name: string, fn: () => Promise<void>) => {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      errors.push({ name, error: err.message || err });
      console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
    }
  };

  ctx = await startTestServer();

  try {
    resetDatabase();

    // T2.1: Empty and Missing Payloads
    await test('T2.1: Rejection of Empty and Malformed JSON Payloads across Endpoints', async () => {
      const fam = await createTestFamily();

      // Empty Register
      const emptyReg = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: {},
      });
      assert.strictEqual(emptyReg.status, 400, 'Empty register must return 400');

      // Empty Login
      const emptyLogin = await apiRequest(ctx.baseUrl, '/api/auth/login', {
        method: 'POST',
        json: {},
      });
      assert.strictEqual(emptyLogin.status, 400, 'Empty login must return 400');

      // Empty Admin Login
      const emptyAdmin = await apiRequest(ctx.baseUrl, '/api/admin/login', {
        method: 'POST',
        json: {},
      });
      assert.strictEqual(emptyAdmin.status, 400, 'Empty admin login must return 400');

      // Empty Patient Creation
      const emptyPatient = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: fam.token,
        json: {},
      });
      assert.strictEqual(emptyPatient.status, 400, 'Empty patient create must return 400');

      // Empty Appointment Creation
      const emptyAppt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {},
      });
      assert.strictEqual(emptyAppt.status, 400, 'Empty appointment create must return 400');

      // Empty Specialty Creation
      const emptySpec = await apiRequest(ctx.baseUrl, '/api/specialties', {
        method: 'POST',
        token: fam.token,
        json: { name: '   ' },
      });
      assert.strictEqual(emptySpec.status, 400, 'Whitespace specialty name must return 400');

      // Empty WhatsApp Number
      const emptyPhone = await apiRequest(ctx.baseUrl, '/api/whatsapp-numbers', {
        method: 'POST',
        token: fam.token,
        json: {},
      });
      assert.strictEqual(emptyPhone.status, 400, 'Empty WhatsApp number must return 400');
    });

    // T2.2: Extreme Payload Bounds and String Lengths
    await test('T2.2: Extreme String Lengths and Oversized Inputs Handling', async () => {
      const fam = await createTestFamily();
      const longName = 'A'.repeat(10000);

      // Oversized Specialty Name (> 100 chars)
      const overSpec = await apiRequest(ctx.baseUrl, '/api/specialties', {
        method: 'POST',
        token: fam.token,
        json: { name: 'Specialty_'.repeat(20) },
      });
      assert.strictEqual(overSpec.status, 400, 'Oversized specialty name must return 400');

      // Patient Name with Extreme Length
      const longPatientRes = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: fam.token,
        json: { name: longName, relationship: 'Familiar', color: '#3b82f6' },
      });
      // Should either accept safely or reject with 400, but NEVER crash
      assert.ok([200, 400].includes(longPatientRes.status));

      if (longPatientRes.status === 200) {
        // Clean up created patient
        await apiRequest(ctx.baseUrl, `/api/patients/${longPatientRes.body.id}`, {
          method: 'DELETE',
          token: fam.token,
        });
      }
    });

    // T2.3: SQL Injection Neutralization
    await test('T2.3: SQL Injection Payloads across Auth and Query Parameters', async () => {
      const sqliPayloads = [
        "' OR '1'='1",
        "admin' --",
        "'; DROP TABLE families; --",
        "1' UNION SELECT id, code, password_hash, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM families --",
      ];

      for (const payload of sqliPayloads) {
        // SQLi in Family Login
        const loginRes = await apiRequest(ctx.baseUrl, '/api/auth/login', {
          method: 'POST',
          json: { code: payload, password: 'password123' },
        });
        assert.ok([400, 401].includes(loginRes.status), `SQLi login payload should be rejected with 400/401, got ${loginRes.status}`);

        // SQLi in Admin Login
        const adminRes = await apiRequest(ctx.baseUrl, '/api/admin/login', {
          method: 'POST',
          json: { username: payload, password: 'password123' },
        });
        assert.ok([400, 401].includes(adminRes.status), `SQLi admin login should be rejected with 400/401, got ${adminRes.status}`);
      }

      // Verify Database integrity (families table intact)
      const checkDb = db.prepare('SELECT COUNT(*) as count FROM families').get() as any;
      assert.ok(typeof checkDb.count === 'number', 'Families table must remain intact after SQLi fuzzing');
    });

    // T2.4: Cross-Site Scripting (XSS) Payloads
    await test('T2.4: XSS Payloads Stored and Retrieved Safely', async () => {
      const fam = await createTestFamily();
      const xssPayload = "<script>alert('XSS-TEST-1')</script>";

      // Create Patient with XSS string in name
      const pRes = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: fam.token,
        json: { name: xssPayload, relationship: '<img src=x onerror=alert(1)>', color: '#3b82f6' },
      });
      assert.strictEqual(pRes.status, 200);
      const patientId = pRes.body.id;

      // Read back
      const getP = await apiRequest(ctx.baseUrl, '/api/patients', { token: fam.token });
      assert.strictEqual(getP.status, 200);
      const savedPatient = getP.body.find((p: any) => p.id === patientId);
      assert.ok(savedPatient);
      // Verify raw text stored without crash
      assert.strictEqual(savedPatient.name, xssPayload);

      // Clean up
      await apiRequest(ctx.baseUrl, `/api/patients/${patientId}`, { method: 'DELETE', token: fam.token });
    });

    // T2.5: Malformed, Forged, and Expired JWT Tokens
    await test('T2.5: Expired, Forged, Tampered, and Malformed JWT Tokens Rejection', async () => {
      const fam = await createTestFamily();
      const secret = process.env.JWT_SECRET || 'test-medfamilia-super-secret-jwt-key-2026-e2e';

      // 1. Expired JWT
      const expiredToken = jwt.sign(
        { id: fam.id, code: fam.code, name: fam.name, exp: Math.floor(Date.now() / 1000) - 3600 },
        secret
      );
      const expRes = await apiRequest(ctx.baseUrl, '/api/auth/me', { token: expiredToken });
      assert.strictEqual(expRes.status, 401, 'Expired token must return 401');

      // 2. Token Signed with Wrong Secret
      const wrongSecretToken = jwt.sign(
        { id: fam.id, code: fam.code, name: fam.name },
        'completely-wrong-secret-key-signature'
      );
      const wrongRes = await apiRequest(ctx.baseUrl, '/api/auth/me', { token: wrongSecretToken });
      assert.strictEqual(wrongRes.status, 401, 'Wrong secret token must return 401');

      // 3. Garbage / Malformed Token String
      const garbageRes = await apiRequest(ctx.baseUrl, '/api/auth/me', { token: 'Bearer NOT_A_REAL_JWT_TOKEN' });
      assert.strictEqual(garbageRes.status, 401, 'Garbage token must return 401');

      // 4. Missing Token
      const missingRes = await apiRequest(ctx.baseUrl, '/api/auth/me');
      assert.strictEqual(missingRes.status, 401, 'Missing token must return 401');

      // 5. Family Token hitting Admin Route
      const familyOnAdmin = await apiRequest(ctx.baseUrl, '/api/admin/me', { token: fam.token });
      assert.strictEqual(familyOnAdmin.status, 403, 'Family token on admin route must return 403 Forbidden');

      // 6. Admin Token hitting Family Route
      const adminToken = getAdminToken();
      const adminOnFamily = await apiRequest(ctx.baseUrl, '/api/auth/me', { token: adminToken });
      assert.strictEqual(adminOnFamily.status, 401, 'Admin token without family id must return 401');
    });

    // T2.6: OTP Boundary Conditions
    await test('T2.6: OTP Validation Edge Cases (Incorrect, Expired, Missing)', async () => {
      const phone = '573001112233';
      const validCode = '123456';
      const expiredDate = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago

      // Seed Expired OTP
      db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(phone);
      db.prepare('INSERT INTO otp_verifications (phone, code, expires_at) VALUES (?, ?, ?)').run(
        phone, validCode, expiredDate
      );

      // Attempt register with expired OTP
      const expiredRes = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: {
          name: 'Familia Test',
          code: 'testfam_exp',
          password: 'Password123!',
          phone: '3001112233',
          otp_code: validCode,
        },
      });
      assert.strictEqual(expiredRes.status, 400);
      assert.ok(expiredRes.text.includes('expirado'), 'Should indicate OTP expired');

      // Seed Active OTP but provide Incorrect code
      const activeDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(phone);
      db.prepare('INSERT INTO otp_verifications (phone, code, expires_at) VALUES (?, ?, ?)').run(
        phone, validCode, activeDate
      );

      const wrongCodeRes = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: {
          name: 'Familia Test',
          code: 'testfam_wrong',
          password: 'Password123!',
          phone: '3001112233',
          otp_code: '999999',
        },
      });
      assert.strictEqual(wrongCodeRes.status, 400);
      assert.ok(wrongCodeRes.text.includes('incorrecto'), 'Should indicate OTP incorrect');

      // Invalid Phone Format (< 10 digits)
      const badPhoneRes = await apiRequest(ctx.baseUrl, '/api/auth/send-whatsapp-otp', {
        method: 'POST',
        json: { phone: '12345' },
      });
      assert.strictEqual(badPhoneRes.status, 400);
    });

    // T2.7: File Upload & Download Boundary Cases
    await test('T2.7: Non-Existent File and Path Traversal Boundary Handling', async () => {
      const fam = await createTestFamily();

      // Non-existent File
      const missingFile = await apiRequest(ctx.baseUrl, '/api/uploads/non-existent-test-file.pdf', {
        token: fam.token,
      });
      assert.strictEqual(missingFile.status, 404, 'Non-existent file should return 404');

      // Path Traversal Attempt
      const traversalRes = await apiRequest(ctx.baseUrl, '/api/uploads/..%2F..%2Fetc%2Fpasswd', {
        token: fam.token,
      });
      assert.ok([400, 403, 404].includes(traversalRes.status), 'Path traversal must be rejected');
    });

    // T2.8: Invalid Route Parameters & Non-Existent Entities
    await test('T2.8: Invalid UUIDs and Non-Existent Entity Modification Rejections', async () => {
      const fam = await createTestFamily();
      const fakeUuid = '00000000-0000-0000-0000-000000000000';

      // Update non-existent patient
      const putPatient = await apiRequest(ctx.baseUrl, `/api/patients/${fakeUuid}`, {
        method: 'PUT',
        token: fam.token,
        json: { name: 'Non Existent' },
      });
      assert.strictEqual(putPatient.status, 404);

      // Delete non-existent patient
      const delPatient = await apiRequest(ctx.baseUrl, `/api/patients/${fakeUuid}`, {
        method: 'DELETE',
        token: fam.token,
      });
      assert.strictEqual(delPatient.status, 404);

      // Delete non-existent appointment
      const delAppt = await apiRequest(ctx.baseUrl, `/api/appointments/${fakeUuid}`, {
        method: 'DELETE',
        token: fam.token,
      });
      assert.strictEqual(delAppt.status, 404);

      // Delete non-existent medical order
      const delOrder = await apiRequest(ctx.baseUrl, `/api/medical-orders/${fakeUuid}`, {
        method: 'DELETE',
        token: fam.token,
      });
      assert.strictEqual(delOrder.status, 404);

      // Delete non-existent exam
      const delExam = await apiRequest(ctx.baseUrl, `/api/exams/${fakeUuid}`, {
        method: 'DELETE',
        token: fam.token,
      });
      assert.strictEqual(delExam.status, 404);
    });

  } finally {
    await ctx.close();
  }

  console.log(`\nTier 2 Finished: ${passed}/${total} passed (${failed} failed).\n`);
  return { total, passed, failed, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTier2Tests()
    .then((r) => process.exit(r.failed > 0 ? 1 : 0))
    .catch((err) => {
      console.error('Fatal in Tier 2:', err);
      process.exit(1);
    });
}
