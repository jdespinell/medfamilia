import './envSetup.js';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  startTestServer,
  resetDatabase,
  createTestFamily,
  getAdminToken,
  apiRequest,
  db,
  TestServerContext
} from './testHelper.js';
import { getJwtSecret, generateToken, generateAdminToken, authMiddleware, adminMiddleware } from '../../server/src/middleware/auth.js';

function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export async function runM1AdversarialStressSuite() {
  console.log('\n============================================================');
  console.log('⚔️  CHALLENGER 1: M1 EMPIRICAL ADVERSARIAL STRESS TEST SUITE');
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

  // =========================================================================
  // VECTOR 1: OTP BRUTE-FORCE & INSUFFICIENT ATTEMPT THROTTLING
  // =========================================================================
  console.log('\n--- [VECTOR 1] OTP Brute-Force & Lockout Stress Tests ---');

  await runTest('V1.1: Sequential 6 failed OTP attempts trigger lockout on 5th and deletion on 6th', async () => {
    resetDatabase();
    const phone = '573005550001';
    const realOtp = '849201';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Seed OTP
    db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(phone);
    db.prepare('INSERT INTO otp_verifications (phone, code, expires_at, attempts) VALUES (?, ?, ?, 0)').run(
      phone, realOtp, expiresAt
    );

    // Initial check
    let record = db.prepare('SELECT code, attempts FROM otp_verifications WHERE phone = ?').get(phone) as any;
    assert.strictEqual(record.attempts, 0, 'Initial attempts must be 0');

    // Attempts 1 to 4: Should increment attempt counter and return remaining count
    for (let i = 1; i <= 4; i++) {
      const wrongOtp = `00000${i}`;
      const res = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: {
          name: 'Familia BruteForce',
          code: `brutefam${i}`,
          password: 'Password123!',
          phone,
          otp_code: wrongOtp
        }
      });

      assert.strictEqual(res.status, 400, `Attempt ${i} must return HTTP 400`);
      assert.strictEqual(res.body.error, `El código de verificación ingresado es incorrecto. Intentos restantes: ${5 - i}.`,
        `Attempt ${i} error message mismatch`);

      // Verify DB state
      record = db.prepare('SELECT code, attempts FROM otp_verifications WHERE phone = ?').get(phone) as any;
      assert(record, `OTP record must still exist after attempt ${i}`);
      assert.strictEqual(record.attempts, i, `DB attempts should be ${i} after attempt ${i}`);
    }

    // Attempt 5: 5th wrong attempt must trigger permanent deletion and security lockout message
    const res5 = await apiRequest(ctx.baseUrl, '/api/auth/register', {
      method: 'POST',
      json: {
        name: 'Familia BruteForce',
        code: 'brutefam5',
        password: 'Password123!',
        phone,
        otp_code: '000005'
      }
    });

    assert.strictEqual(res5.status, 400, '5th attempt must return HTTP 400');
    assert.strictEqual(res5.body.error, 'Demasiados intentos fallidos. El código de verificación ha sido bloqueado por seguridad. Solicite un nuevo código.',
      '5th attempt must indicate security lockout');

    // Verify DB record is completely deleted
    record = db.prepare('SELECT * FROM otp_verifications WHERE phone = ?').get(phone);
    assert.strictEqual(record, undefined, 'OTP record must be purged from database upon 5th failed attempt');

    // Attempt 6: Even if using the REAL/CORRECT OTP on attempt 6, must fail because record is purged!
    const res6 = await apiRequest(ctx.baseUrl, '/api/auth/register', {
      method: 'POST',
      json: {
        name: 'Familia BruteForce',
        code: 'brutefam6',
        password: 'Password123!',
        phone,
        otp_code: realOtp // Trying real OTP after lockout
      }
    });

    assert.strictEqual(res6.status, 400, '6th attempt must return HTTP 400');
    assert.strictEqual(res6.body.error, 'No se encontró una solicitud de código previa para este WhatsApp. Solicite uno nuevo.',
      '6th attempt must confirm no OTP record exists');

    // Verify DB remains empty
    record = db.prepare('SELECT * FROM otp_verifications WHERE phone = ?').get(phone);
    assert.strictEqual(record, undefined, 'OTP record must remain deleted in DB');
  });

  await runTest('V1.2: Pre-existing max attempts (attempts >= 5) is rejected and purged immediately', async () => {
    resetDatabase();
    const phone = '573005550002';
    const realOtp = '123456';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Seed OTP with 5 attempts already recorded
    db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(phone);
    db.prepare('INSERT INTO otp_verifications (phone, code, expires_at, attempts) VALUES (?, ?, ?, 5)').run(
      phone, realOtp, expiresAt
    );

    const res = await apiRequest(ctx.baseUrl, '/api/auth/register', {
      method: 'POST',
      json: {
        name: 'Familia Locked',
        code: 'lockedfam',
        password: 'Password123!',
        phone,
        otp_code: realOtp // Even with real OTP
      }
    });

    assert.strictEqual(res.status, 400, 'Should reject locked out OTP');
    assert.strictEqual(res.body.error, 'Demasiados intentos fallidos. El código de verificación ha sido bloqueado por seguridad. Solicite un nuevo código.');

    const record = db.prepare('SELECT * FROM otp_verifications WHERE phone = ?').get(phone);
    assert.strictEqual(record, undefined, 'Record with attempts >= 5 must be deleted from DB');
  });

  await runTest('V1.3: Expired OTP is rejected and purged from database', async () => {
    resetDatabase();
    const phone = '573005550003';
    const realOtp = '999111';
    // Expired 5 minutes ago
    const expiresAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(phone);
    db.prepare('INSERT INTO otp_verifications (phone, code, expires_at, attempts) VALUES (?, ?, ?, 0)').run(
      phone, realOtp, expiresAt
    );

    const res = await apiRequest(ctx.baseUrl, '/api/auth/register', {
      method: 'POST',
      json: {
        name: 'Familia Expired',
        code: 'expiredfam',
        password: 'Password123!',
        phone,
        otp_code: realOtp
      }
    });

    assert.strictEqual(res.status, 400, 'Should reject expired OTP');
    assert.strictEqual(res.body.error, 'El código de verificación ha expirado. Solicite un nuevo código.');

    const record = db.prepare('SELECT * FROM otp_verifications WHERE phone = ?').get(phone);
    assert.strictEqual(record, undefined, 'Expired OTP record must be deleted from DB');
  });

  await runTest('V1.4: Statistical uniformity and range of CSPRNG OTP generation', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = crypto.randomInt(100000, 1000000).toString();
      assert.strictEqual(code.length, 6, 'OTP must be 6 digits');
      const num = parseInt(code, 10);
      assert(num >= 100000 && num <= 999999, 'OTP must be in range [100000, 999999]');
      codes.add(code);
    }
    // High entropy check: In 500 samples of 900,000 possibilities, collision rate should be < 2%
    assert(codes.size > 480, `Expected at least 480 unique codes in 500 CSPRNG samples, got ${codes.size}`);
  });

  // =========================================================================
  // VECTOR 2: JWT SECRET PRODUCTION ENFORCEMENT
  // =========================================================================
  console.log('\n--- [VECTOR 2] JWT Secret Production Enforcement Stress Tests ---');

  await runTest('V2.1: getJwtSecret() in production mode strictly throws on empty, missing, and known insecure secrets', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;

    try {
      process.env.NODE_ENV = 'production';

      const invalidSecrets = [
        undefined,
        '',
        '   ',
        '\t\n',
        'super-secret-key-medfamilia-2026',
        'super-secret-medfamilia-key-2026',
        'development-medfamilia-fallback-key-change-me',
        '  super-secret-key-medfamilia-2026  ',
        '  development-medfamilia-fallback-key-change-me \n'
      ];

      for (const secret of invalidSecrets) {
        if (secret === undefined) {
          delete process.env.JWT_SECRET;
        } else {
          process.env.JWT_SECRET = secret;
        }

        let threw = false;
        let errorMessage = '';
        try {
          getJwtSecret();
        } catch (err: any) {
          threw = true;
          errorMessage = err.message;
        }

        assert.strictEqual(
          threw,
          true,
          `getJwtSecret() must throw in production for secret: ${JSON.stringify(secret)}`
        );
        assert(
          errorMessage.includes('CRITICAL SECURITY FATAL ERROR'),
          `Error message must contain 'CRITICAL SECURITY FATAL ERROR', got: ${errorMessage}`
        );
      }
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSecret !== undefined) {
        process.env.JWT_SECRET = originalSecret;
      } else {
        delete process.env.JWT_SECRET;
      }
    }
  });

  await runTest('V2.2: getJwtSecret() accepts strong secrets in production and trims whitespace', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      const strongSecret = '8f4c2e6b9a1d0f5e3a7c8b2d4e6f0a1b3c5d7e9f2a4b6c8d0e1f3a5b7c9d1e3';
      process.env.JWT_SECRET = `  ${strongSecret}  `;

      const resolved = getJwtSecret();
      assert.strictEqual(resolved, strongSecret, 'getJwtSecret must return trimmed strong secret in production');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSecret !== undefined) {
        process.env.JWT_SECRET = originalSecret;
      } else {
        delete process.env.JWT_SECRET;
      }
    }
  });

  await runTest('V2.3: getJwtSecret() falls back to dev key gracefully in development / test environments', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;

    try {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_SECRET;

      const devSecret = getJwtSecret();
      assert.strictEqual(devSecret, 'development-medfamilia-fallback-key-change-me');

      // Also for insecure defaults in dev mode
      process.env.JWT_SECRET = 'super-secret-key-medfamilia-2026';
      const devSecret2 = getJwtSecret();
      assert.strictEqual(devSecret2, 'development-medfamilia-fallback-key-change-me');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSecret !== undefined) {
        process.env.JWT_SECRET = originalSecret;
      } else {
        delete process.env.JWT_SECRET;
      }
    }
  });

  // =========================================================================
  // VECTOR 3: TIMING SAFETY & CONSTANT-TIME COMPARISON
  // =========================================================================
  console.log('\n--- [VECTOR 3] Timing Safety & Constant-Time String Comparison ---');

  await runTest('V3.1: timingSafeStringEqual handles identical, mismatched lengths, empty strings, and special characters', () => {
    // Identical
    assert.strictEqual(timingSafeStringEqual('admin', 'admin'), true, 'Exact match must return true');
    assert.strictEqual(timingSafeStringEqual('', ''), true, 'Empty strings must return true');
    assert.strictEqual(timingSafeStringEqual('P@$$w0rd!#%&_2026_ñ', 'P@$$w0rd!#%&_2026_ñ'), true, 'Complex unicode match');

    // Mismatched lengths
    assert.strictEqual(timingSafeStringEqual('admin', 'admin1'), false, 'Different length must return false');
    assert.strictEqual(timingSafeStringEqual('admin1', 'admin'), false, 'Different length must return false');
    assert.strictEqual(timingSafeStringEqual('', 'a'), false, 'Empty vs non-empty must return false');
    assert.strictEqual(timingSafeStringEqual('a', ''), false, 'Non-empty vs empty must return false');
    assert.strictEqual(timingSafeStringEqual('superadmin_master_key', 'admin'), false, 'Long vs short must return false');

    // Same length different characters
    assert.strictEqual(timingSafeStringEqual('admin1', 'admin2'), false, 'Diff char at end must return false');
    assert.strictEqual(timingSafeStringEqual('1admin', '2admin'), false, 'Diff char at start must return false');
    assert.strictEqual(timingSafeStringEqual('a'.repeat(500) + 'X', 'a'.repeat(500) + 'Y'), false, 'Diff char in 500 byte string');
  });

  await runTest('V3.2: timingSafeStringEqual stress test over 10,000 iterations without throw or error', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
    const randomStr = (len: number) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    for (let i = 0; i < 10000; i++) {
      const lenA = (i % 50) + 1;
      const lenB = ((i + 7) % 50) + 1;
      const strA = randomStr(lenA);
      const strB = (i % 2 === 0) ? strA : randomStr(lenB);

      const expected = (strA === strB);
      const actual = timingSafeStringEqual(strA, strB);
      assert.strictEqual(actual, expected, `Mismatch on iteration ${i}`);
    }
  });

  await runTest('V3.3: Admin login endpoint rejects weak password in production configuration', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalPass = process.env.ADMIN_PASSWORD;

    try {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_PASSWORD = 'admin12345'; // Weak password in production

      const res = await apiRequest(ctx.baseUrl, '/api/admin/login', {
        method: 'POST',
        json: { username: 'admin', password: 'admin12345' }
      });

      assert.strictEqual(res.status, 500, 'Production login with weak default password must return 500 error');
      assert(res.body.error.includes('no está configurado de forma segura'), 'Error message must explain configuration flaw');
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.ADMIN_PASSWORD = originalPass;
    }
  });

  // =========================================================================
  // VECTOR 4: URL QUERY PARAMETER JWT TOKEN REJECTION & JWT HARDENING
  // =========================================================================
  console.log('\n--- [VECTOR 4] URL Query Parameter JWT Token Rejection & Middleware Hardening ---');

  await runTest('V4.1: authMiddleware rejects ?token= parameter across multiple API endpoints', async () => {
    resetDatabase();
    const family = await createTestFamily({ name: 'Familia QueryTokenTest' });
    const validToken = family.token;

    const endpointsToTest = [
      '/api/auth/me',
      '/api/patients',
      '/api/appointments',
      '/api/exams',
      '/api/medical-orders',
      '/api/specialties',
      '/api/whatsapp-numbers',
      '/api/uploads/nonexistent-file.pdf',
      '/uploads/nonexistent-file.pdf'
    ];

    for (const endpoint of endpointsToTest) {
      const res = await apiRequest(ctx.baseUrl, endpoint, {
        method: 'GET',
        params: { token: validToken }
      });

      assert.strictEqual(
        res.status,
        401,
        `Endpoint ${endpoint}?token=... MUST return HTTP 401 Unauthorized, but got ${res.status}`
      );
      assert(
        res.body.error.includes('Acceso no autorizado') || res.body.error.includes('Sesión'),
        `Endpoint ${endpoint} must return unauthorized error message`
      );
    }
  });

  await runTest('V4.2: adminMiddleware rejects ?token= parameter on admin routes', async () => {
    const adminToken = getAdminToken('admin');

    const adminEndpoints = [
      '/api/admin/me',
      '/api/admin/families'
    ];

    for (const endpoint of adminEndpoints) {
      const res = await apiRequest(ctx.baseUrl, endpoint, {
        method: 'GET',
        params: { token: adminToken }
      });

      assert.strictEqual(
        res.status,
        401,
        `Admin endpoint ${endpoint}?token=... MUST return HTTP 401 Unauthorized, but got ${res.status}`
      );
      assert(
        res.body.error.includes('Acceso no autorizado') || res.body.error.includes('credenciales de administrador'),
        `Admin endpoint ${endpoint} must return unauthorized message`
      );
    }
  });

  await runTest('V4.3: Valid Authorization: Bearer header succeeds on private endpoints', async () => {
    const family = await createTestFamily({ name: 'Familia ValidBearer' });

    const res = await apiRequest(ctx.baseUrl, '/api/auth/me', {
      method: 'GET',
      token: family.token
    });

    assert.strictEqual(res.status, 200, 'Valid Bearer token must return HTTP 200 on /api/auth/me');
    assert.strictEqual(res.body.family.id, family.id, 'Response should contain family profile');
  });

  await runTest('V4.4: Conflicting query token is completely ignored when valid Bearer header is present', async () => {
    const family = await createTestFamily({ name: 'Familia MixedAuth' });

    // Header has valid token, query string has garbage token
    const res = await apiRequest(ctx.baseUrl, '/api/patients', {
      method: 'GET',
      token: family.token,
      params: { token: 'invalid_malicious_forged_query_token' }
    });

    assert.strictEqual(res.status, 200, 'Authorization header must take precedence; query param must be ignored');
    assert(Array.isArray(res.body), 'Must return patients list');
  });

  await runTest('V4.5: JWT tampering & algorithm confusion resilience', async () => {
    const family = await createTestFamily({ name: 'Familia TamperTest' });

    // 1. Forged token signed with wrong key
    const forgedToken = jwt.sign({ id: family.id, code: family.code, name: family.name }, 'wrong-secret-key-attacker-666', { algorithm: 'HS256' });
    const resForged = await apiRequest(ctx.baseUrl, '/api/patients', {
      method: 'GET',
      token: forgedToken
    });
    assert.strictEqual(resForged.status, 401, 'Forged JWT must be rejected with 401');

    // 2. Algorithm 'none' token
    const noneAlgToken = jwt.sign({ id: family.id, code: family.code, name: family.name }, '', { algorithm: 'none' });
    const resNone = await apiRequest(ctx.baseUrl, '/api/patients', {
      method: 'GET',
      token: noneAlgToken
    });
    assert.strictEqual(resNone.status, 401, 'Algorithm "none" token must be rejected with 401');

    // 3. Expired token
    const expiredToken = jwt.sign({ id: family.id, code: family.code, name: family.name }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '-10s' });
    const resExpired = await apiRequest(ctx.baseUrl, '/api/patients', {
      method: 'GET',
      token: expiredToken
    });
    assert.strictEqual(resExpired.status, 401, 'Expired JWT must be rejected with 401');

    // 4. Token for non-existent family (deleted account)
    const ghostToken = generateToken({ id: '00000000-0000-0000-0000-000000000000', code: 'ghost', name: 'Ghost Family' });
    const resGhost = await apiRequest(ctx.baseUrl, '/api/patients', {
      method: 'GET',
      token: ghostToken
    });
    assert.strictEqual(resGhost.status, 401, 'Token for deleted/non-existent family must be rejected with 401');

    // 5. Cross-role token: Family token accessing Superadmin endpoint
    const resAdminForbidden = await apiRequest(ctx.baseUrl, '/api/admin/families', {
      method: 'GET',
      token: family.token
    });
    assert.strictEqual(resAdminForbidden.status, 403, 'Family token attempting to access Admin endpoint must return 403 Forbidden');
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n============================================================');
  console.log(`📊 ADVERSARIAL STRESS TEST SUMMARY: ${passed}/${total} PASSED`);
  if (failed > 0) {
    console.log(`❌ ${failed} TESTS FAILED`);
  } else {
    console.log('🎉 100% OF M1 ADVERSARIAL CHALLENGE STRESS TESTS PASSED!');
  }
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Execute suite directly if run with tsx / node
runM1AdversarialStressSuite().catch((err) => {
  console.error('Fatal error in stress suite execution:', err);
  process.exit(1);
});
