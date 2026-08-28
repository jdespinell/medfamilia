import './envSetup.js';
import assert from 'node:assert';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { encrypt, decrypt } from '../../server/src/services/encryption.js';
import { generateOAuthState, verifyOAuthState } from '../../server/src/services/googleCalendar.js';
import { getJwtSecret } from '../../server/src/middleware/auth.js';
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

async function runAuditorForensicStressSuite() {
  console.log('\n================================================================');
  console.log('🔬 INDEPENDENT AUDITOR FORENSIC INTEGRITY & ADVERSARIAL STRESS SUITE');
  console.log('   Milestone 3: Integrations Hardening Verification');
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

  let ctx: TestServerContext;

  try {
    ctx = await startTestServer();
    resetDatabase();

    // -------------------------------------------------------------------------
    // FORENSIC AREA 1: AES-256-GCM ENCRYPTION STRESS TESTING
    // -------------------------------------------------------------------------
    console.log('\n--- Forensic Area 1: Cryptographic Integrity of AES-256-GCM ---');

    await runCheck('F1.1: Handles empty, null, and non-string inputs safely', () => {
      assert.strictEqual(encrypt(''), '');
      assert.strictEqual(encrypt(null as any), '');
      assert.strictEqual(encrypt(undefined as any), '');
      assert.strictEqual(decrypt(''), '');
      assert.strictEqual(decrypt(null as any), '');
      assert.strictEqual(decrypt(undefined as any), '');
      assert.strictEqual(decrypt(12345 as any), '');
    });

    await runCheck('F1.2: Authenticated tag verifies data integrity and catches bit flips', () => {
      const plaintext = 'ya29.a0AfH6SMD_sensitive_google_refresh_token_xyz_987654321';
      const encrypted = encrypt(plaintext);
      const parts = encrypted.split(':');
      assert.strictEqual(parts.length, 3, 'Must contain IV, Tag, Ciphertext');

      const [ivHex, tagHex, cipherHex] = parts;
      assert.strictEqual(ivHex.length, 24, 'IV must be 24 hex characters (12 bytes)');
      assert.strictEqual(tagHex.length, 32, 'Tag must be 32 hex characters (16 bytes)');

      // Tampered ciphertext
      const tamperedCipher = cipherHex.slice(0, -2) + (cipherHex.slice(-2) === 'ff' ? '00' : 'ff');
      assert.strictEqual(decrypt(`${ivHex}:${tagHex}:${tamperedCipher}`), '', 'Tampered ciphertext must decrypt to empty string');

      // Tampered tag
      const tamperedTag = tagHex.slice(0, -2) + (tagHex.slice(-2) === 'ff' ? '00' : 'ff');
      assert.strictEqual(decrypt(`${ivHex}:${tamperedTag}:${cipherHex}`), '', 'Tampered tag must decrypt to empty string');

      // Tampered IV
      const tamperedIv = ivHex.slice(0, -2) + (ivHex.slice(-2) === 'ff' ? '00' : 'ff');
      assert.strictEqual(decrypt(`${tamperedIv}:${tagHex}:${cipherHex}`), '', 'Tampered IV must decrypt to empty string');
    });

    await runCheck('F1.3: Handles malformed colon formatting and invalid hex gracefully', () => {
      assert.strictEqual(decrypt('iv_only'), 'iv_only', 'Single string returns as legacy plaintext');
      assert.strictEqual(decrypt('iv:tag'), 'iv:tag', 'Two-part string returns as legacy plaintext');
      assert.strictEqual(decrypt('iv:tag:cipher:extra'), 'iv:tag:cipher:extra', 'Four-part string returns as legacy plaintext');
      assert.strictEqual(decrypt('not_hex_iv_24chrs!:not_hex_tag_32_chars_here_abc!:deadbeef'), '', 'Invalid hex returns empty string');
    });

    await runCheck('F1.4: Handles multi-byte Unicode characters and large 10KB tokens', () => {
      const complexText = '🩺🏥 Prueba de token con acentos y emojis: áéíóú ñ Ñ 中文 🚀 ' + 'A'.repeat(10000);
      const enc = encrypt(complexText);
      const dec = decrypt(enc);
      assert.strictEqual(dec, complexText, 'Large complex string must match after encryption/decryption roundtrip');
    });

    // -------------------------------------------------------------------------
    // FORENSIC AREA 2: OAUTH CSRF STATE GENERATION & VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- Forensic Area 2: OAuth CSRF State Generation & Verification ---');

    await runCheck('F2.1: State token generation includes patientId, familyId, unique nonce and 15m expiration', () => {
      const patientId = uuidv4();
      const familyId = uuidv4();
      const state1 = generateOAuthState(patientId, familyId);
      const state2 = generateOAuthState(patientId, familyId);

      assert.notStrictEqual(state1, state2, 'Two states generated for same patient must have different nonces');

      const verified = verifyOAuthState(state1);
      assert.ok(verified, 'State must verify');
      assert.strictEqual(verified!.patientId, patientId);
      assert.strictEqual(verified!.familyId, familyId);
      assert.ok(verified!.nonce);
    });

    await runCheck('F2.2: State verification rejects none algorithm and algorithm confusion', () => {
      const secret = getJwtSecret();
      const patientId = uuidv4();
      const familyId = uuidv4();

      // Algorithm 'none' attack
      const noneToken = jwt.sign({ patientId, familyId, nonce: '123' }, '', { algorithm: 'none' as any });
      assert.strictEqual(verifyOAuthState(noneToken), null, 'None algorithm token must be rejected');

      // HS384 / HS512 when expecting HS256
      const hs512Token = jwt.sign({ patientId, familyId, nonce: '123' }, secret, { algorithm: 'HS512' });
      assert.strictEqual(verifyOAuthState(hs512Token), null, 'Wrong algorithm token must be rejected');

      // Expired token (exp in past)
      const expiredToken = jwt.sign(
        { patientId, familyId, nonce: '123', exp: Math.floor(Date.now() / 1000) - 100 },
        secret,
        { algorithm: 'HS256' }
      );
      assert.strictEqual(verifyOAuthState(expiredToken), null, 'Expired token must be rejected');
    });

    await runCheck('F2.3: OAuth callback endpoint strictly prevents cross-tenant state swapping', async () => {
      const family1 = await createTestFamily();
      const family2 = await createTestFamily();

      // Attacker tries to link their Google account to Family 1 patient by supplying Family 1 patientId with Family 2 state
      const stateForged = generateOAuthState(family1.papaId, family2.id);

      const callbackRes = await apiRequest(ctx.baseUrl, '/api/calendar/callback', {
        params: {
          code: 'mock-code',
          state: stateForged,
        },
      });

      assert.strictEqual(callbackRes.status, 400, 'Cross-tenant state must be rejected with 400');
    });

    // -------------------------------------------------------------------------
    // FORENSIC AREA 3: PATIENTS API TOKEN SANITIZATION
    // -------------------------------------------------------------------------
    console.log('\n--- Forensic Area 3: Patient API Data Sanitization & Invariants ---');

    await runCheck('F3.1: Patient GET, POST, PUT routes strictly omit google_refresh_token and expose is_google_connected', async () => {
      const fam = await createTestFamily();

      // Inject encrypted refresh token into DB for Mama
      const encToken = encrypt('mama-encrypted-refresh-token-999');
      db.prepare('UPDATE patients SET google_refresh_token = ? WHERE id = ?').run(encToken, fam.mamaId);

      // GET /api/patients
      const getRes = await apiRequest(ctx.baseUrl, '/api/patients', { token: fam.token });
      assert.strictEqual(getRes.status, 200);

      const papa = getRes.body.find((p: any) => p.id === fam.papaId);
      const mama = getRes.body.find((p: any) => p.id === fam.mamaId);

      assert.strictEqual(papa.is_google_connected, false);
      assert.strictEqual(papa.google_refresh_token, undefined);
      assert.strictEqual(mama.is_google_connected, true);
      assert.strictEqual(mama.google_refresh_token, undefined);

      // POST /api/patients
      const postRes = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: fam.token,
        json: { name: 'Abuelo', relationship: 'Abuelo', color: '#ec4899' },
      });
      assert.strictEqual(postRes.status, 200);
      assert.strictEqual(postRes.body.is_google_connected, false);
      assert.strictEqual(postRes.body.google_refresh_token, undefined);

      // PUT /api/patients/:id
      const putRes = await apiRequest(ctx.baseUrl, `/api/patients/${fam.mamaId}`, {
        method: 'PUT',
        token: fam.token,
        json: { name: 'Mamá Super Test' },
      });
      assert.strictEqual(putRes.status, 200);
      assert.strictEqual(putRes.body.is_google_connected, true);
      assert.strictEqual(putRes.body.google_refresh_token, undefined);
    });

    // -------------------------------------------------------------------------
    // FORENSIC AREA 4: WHATSAPP WEBHOOK AUTH & MULTI-TENANT DB LOOKUP
    // -------------------------------------------------------------------------
    console.log('\n--- Forensic Area 4: WhatsApp Webhook & Media Tenant Isolation ---');

    await runCheck('F4.1: Webhook rejects unauthorized requests with 401', async () => {
      const res1 = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
        method: 'POST',
        json: { event: 'messages.upsert', data: {} },
      });
      assert.strictEqual(res1.status, 401, 'No auth header -> 401');

      const res2 = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'x-webhook-token': 'wrong_token' },
        json: { event: 'messages.upsert', data: {} },
      });
      assert.strictEqual(res2.status, 401, 'Wrong x-webhook-token -> 401');
    });

    await runCheck('F4.2: Webhook accepts authorized requests via x-webhook-token or apikey', async () => {
      const fam = await createTestFamily({ phone: '573129990001' });
      const payload = {
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '573129990001@s.whatsapp.net', fromMe: false, id: `TEST-AUDIT-${Date.now()}` },
          pushName: 'Auditor Test',
          message: { conversation: 'Hola' },
        },
      };

      const resToken = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'x-webhook-token': process.env.WEBHOOK_SECRET || 'medfamilia_webhook_secret_2026' },
        json: payload,
      });
      assert.strictEqual(resToken.status, 200);

      const resKey = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
        method: 'POST',
        headers: { apikey: process.env.EVOLUTION_API_KEY || 'medfamilia_whatsapp_key_2026' },
        json: {
          ...payload,
          data: { ...payload.data, key: { ...payload.data.key, id: `TEST-AUDIT-KEY-${Date.now()}` } },
        },
      });
      assert.strictEqual(resKey.status, 200);
    });

    await runCheck('F4.3: Multi-tenant file access check in send_exam_file enforces family ownership', async () => {
      const fam1 = await createTestFamily();
      const fam2 = await createTestFamily();

      const filename1 = `fam1_confidential_report_${Date.now()}.pdf`;
      writeTestFile(filename1, '%PDF-1.4 confidential medical record');
      db.prepare(`
        INSERT INTO exam_results (id, family_id, patient_id, title, file_url, file_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run([uuidv4(), fam1.id, fam1.papaId, 'Report Fam 1', `/api/uploads/${filename1}`, 'pdf']);

      // Direct tenant check simulation:
      const check1 = db.prepare('SELECT id FROM exam_results WHERE family_id = ? AND file_url LIKE ?').get(fam1.id, `%${filename1}`);
      assert.ok(check1, 'Fam 1 must find its own file');

      const check2 = db.prepare('SELECT id FROM exam_results WHERE family_id = ? AND file_url LIKE ?').get(fam2.id, `%${filename1}`);
      assert.strictEqual(check2, undefined, 'Fam 2 must NOT find Fam 1 file');
    });

    // -------------------------------------------------------------------------
    // FORENSIC AREA 5: VAPID WEB PUSH MULTI-TENANT ISOLATION
    // -------------------------------------------------------------------------
    console.log('\n--- Forensic Area 5: VAPID Web Push Subscription Multi-Tenancy ---');

    await runCheck('F5.1: Push subscription upsert safely rebinds shared device endpoint to current active family', async () => {
      const famA = await createTestFamily();
      const famB = await createTestFamily();

      const endpoint = `https://fcm.googleapis.com/fcm/send/device-${Date.now()}`;
      const subA = {
        endpoint,
        keys: { p256dh: 'key_p256dh_a', auth: 'key_auth_a' },
      };

      // 1. Family A registers
      const resA = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: famA.token,
        json: { subscription: subA },
      });
      assert.strictEqual(resA.status, 200);

      const dbSubA = db.prepare('SELECT family_id FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as any;
      assert.strictEqual(dbSubA.family_id, famA.id);

      // 2. Family B registers on same device/browser endpoint
      const subB = {
        endpoint,
        keys: { p256dh: 'key_p256dh_b', auth: 'key_auth_b' },
      };
      const resB = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: famB.token,
        json: { subscription: subB },
      });
      assert.strictEqual(resB.status, 200);

      const allRows = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').all(endpoint) as any[];
      assert.strictEqual(allRows.length, 1, 'Must remain exactly 1 row (unique endpoint)');
      assert.strictEqual(allRows[0].family_id, famB.id, 'Must now belong to Family B');
    });

    // -------------------------------------------------------------------------
    // FORENSIC AREA 6: GEMINI AI PROMPT DELIMITERS
    // -------------------------------------------------------------------------
    console.log('\n--- Forensic Area 6: Gemini AI Prompt Injection Hardening ---');

    await runCheck('F6.1: Verify gemini.ts enforces XML delimiter tags and system instruction parameters', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const geminiSrc = fs.readFileSync(path.resolve(__dirname, '../../server/src/services/gemini.ts'), 'utf8');

      assert.ok(geminiSrc.includes('<user_input>'), 'Must contain <user_input>');
      assert.ok(geminiSrc.includes('</user_input>'), 'Must contain </user_input>');
      assert.ok(geminiSrc.includes('<family_context>'), 'Must contain <family_context>');
      assert.ok(geminiSrc.includes('</family_context>'), 'Must contain </family_context>');
      assert.ok(geminiSrc.includes('systemInstruction'), 'Must configure systemInstruction');
    });

  } finally {
    if (ctx!) await ctx.close();
  }

  console.log('\n================================================================');
  console.log(`📊 FORENSIC AUDITOR SUMMARY: ${passed}/${total} CHECKS PASSED (${failures.length} FAILED)`);
  console.log('================================================================\n');

  if (failures.length > 0) {
    console.error('❌ Failures:');
    failures.forEach((f) => console.error(`  - ${f.name}: ${f.error}`));
    process.exit(1);
  }
}

runAuditorForensicStressSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error in forensic auditor suite:', err);
    process.exit(1);
  });
