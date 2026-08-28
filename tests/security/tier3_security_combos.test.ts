import './envSetup.js';
import assert from 'node:assert';
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

export async function runTier3Tests(): Promise<{ total: number; passed: number; failed: number; errors: any[]; vulnerabilitiesDetected: string[] }> {
  console.log('\n============================================================');
  console.log('🧪 RUNNING TIER 3: CROSS-FEATURE & SECURITY COMBINATIONS');
  console.log('============================================================\n');

  let ctx: TestServerContext;
  let total = 0;
  let passed = 0;
  let failed = 0;
  const errors: any[] = [];
  const vulnerabilitiesDetected: string[] = [];

  const test = async (name: string, vulnId: string, fn: () => Promise<void>) => {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      errors.push({ name, vulnId, error: err.message || err });
      vulnerabilitiesDetected.push(`[${vulnId}] ${name}: ${err.message || err}`);
      console.error(`  ⚠️ [SECURITY FINDING / TEST FAIL] ${name}:`, err.message || err);
    }
  };

  ctx = await startTestServer();

  try {
    resetDatabase();

    // T3.1: Cross-Tenant File IDOR (handleSecureFileServe 1-Hour Buffer Bypass)
    await test(
      'T3.1: Cross-Tenant File IDOR Access Prevention (Recent & Older Files)',
      'VULN-02',
      async () => {
        const familyA = await createTestFamily({ code: 'family_alpha' });
        const familyB = await createTestFamily({ code: 'family_beta' });

        const filenameA = `sensitive-medical-record-${Date.now()}.pdf`;
        writeTestFile(filenameA, '%PDF-1.4 CONFIDENTIAL MEDICAL RECORD FOR FAMILY ALPHA');

        // Link file in DB to Family A
        db.prepare(`
          INSERT INTO exam_results (id, family_id, patient_id, title, file_url, file_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(['exam-sec-a', familyA.id, familyA.papaId, 'Confidential Scan', `/api/uploads/${filenameA}`, 'pdf']);

        // Family A (owner) should succeed
        const ownerRes = await apiRequest(ctx.baseUrl, `/api/uploads/${filenameA}`, { token: familyA.token });
        assert.strictEqual(ownerRes.status, 200, 'Owner Family A must be able to download their file');

        // Family B (attacker) attempts to download Family A's recent file
        const attackerRes = await apiRequest(ctx.baseUrl, `/api/uploads/${filenameA}`, { token: familyB.token });

        // Hardened requirement: MUST return 403 Forbidden!
        // (If vulnerable to VULN-02 due to isRecent, status is 200)
        assert.strictEqual(
          attackerRes.status,
          403,
          `Cross-Tenant IDOR: Family B accessed Family A file (status ${attackerRes.status}). isRecent 1-hour grace bypass detected!`
        );
      }
    );

    // T3.2: Cross-Tenant Resource IDOR (Patients, Appointments, Orders, Exams, WhatsApp Numbers)
    await test(
      'T3.2: Cross-Tenant Entity Modification & Deletion IDOR Protection',
      'IDOR-ENTITIES',
      async () => {
        const familyA = await createTestFamily({ code: 'family_a_res' });
        const familyB = await createTestFamily({ code: 'family_b_res' });

        // 1. Family A Patient IDOR
        const putPatientRes = await apiRequest(ctx.baseUrl, `/api/patients/${familyA.papaId}`, {
          method: 'PUT',
          token: familyB.token,
          json: { name: 'Hacked Papa Name' },
        });
        assert.ok([403, 404].includes(putPatientRes.status), `Family B modifying Family A patient returned ${putPatientRes.status}`);

        const delPatientRes = await apiRequest(ctx.baseUrl, `/api/patients/${familyA.papaId}`, {
          method: 'DELETE',
          token: familyB.token,
        });
        assert.ok([403, 404].includes(delPatientRes.status), `Family B deleting Family A patient returned ${delPatientRes.status}`);

        // 2. Family A Appointment IDOR
        const apptId = `appt-a-${Date.now()}`;
        db.prepare(`
          INSERT INTO appointments (id, family_id, patient_id, title, date_time, status)
          VALUES (?, ?, ?, ?, ?, 'pendiente')
        `).run([apptId, familyA.id, familyA.papaId, 'Consulta Privada A', '2026-12-01T10:00:00Z']);

        const putApptRes = await apiRequest(ctx.baseUrl, `/api/appointments/${apptId}`, {
          method: 'PUT',
          token: familyB.token,
          json: { title: 'Hacked Appointment' },
        });
        assert.ok([403, 404].includes(putApptRes.status), `Family B modifying Family A appt returned ${putApptRes.status}`);

        const delApptRes = await apiRequest(ctx.baseUrl, `/api/appointments/${apptId}`, {
          method: 'DELETE',
          token: familyB.token,
        });
        assert.ok([403, 404].includes(delApptRes.status), `Family B deleting Family A appt returned ${delApptRes.status}`);

        // 3. Family A Medical Order IDOR
        const orderId = `order-a-${Date.now()}`;
        db.prepare(`
          INSERT INTO medical_orders (id, family_id, patient_id, title, status)
          VALUES (?, ?, ?, ?, 'pendiente')
        `).run([orderId, familyA.id, familyA.papaId, 'Orden Privada A']);

        const putOrderRes = await apiRequest(ctx.baseUrl, `/api/medical-orders/${orderId}`, {
          method: 'PUT',
          token: familyB.token,
          json: { title: 'Hacked Order' },
        });
        assert.ok([403, 404].includes(putOrderRes.status), `Family B modifying Family A order returned ${putOrderRes.status}`);

        const delOrderRes = await apiRequest(ctx.baseUrl, `/api/medical-orders/${orderId}`, {
          method: 'DELETE',
          token: familyB.token,
        });
        assert.ok([403, 404].includes(delOrderRes.status), `Family B deleting Family A order returned ${delOrderRes.status}`);

        // 4. Family A Exam IDOR
        const examId = `exam-a-${Date.now()}`;
        db.prepare(`
          INSERT INTO exam_results (id, family_id, patient_id, title, file_url, file_type)
          VALUES (?, ?, ?, ?, '/api/uploads/dummy.pdf', 'pdf')
        `).run([examId, familyA.id, familyA.papaId, 'Examen Privado A']);

        const delExamRes = await apiRequest(ctx.baseUrl, `/api/exams/${examId}`, {
          method: 'DELETE',
          token: familyB.token,
        });
        assert.ok([403, 404].includes(delExamRes.status), `Family B deleting Family A exam returned ${delExamRes.status}`);
      }
    );

    // T3.3: Unauthenticated WhatsApp Webhook Injection
    await test(
      'T3.3: Unauthenticated & Forged WhatsApp Webhook Message Injection Rejection',
      'VULN-01',
      async () => {
        const webhookPayload = {
          event: 'messages.upsert',
          data: {
            key: {
              remoteJid: '573001234567@s.whatsapp.net',
              fromMe: false,
              id: 'FORGED_MSG_001',
            },
            pushName: 'Attacker',
            message: { conversation: 'Hacked prompt injection' },
          },
        };

        // 1. Call webhook with NO auth headers
        const unauthRes = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
          method: 'POST',
          json: webhookPayload,
        });

        // Hardened requirement: MUST return 401 Unauthorized!
        assert.strictEqual(
          unauthRes.status,
          401,
          `Unauthenticated WhatsApp Webhook allowed (status ${unauthRes.status}). Webhook secret authentication missing!`
        );

        // 2. Call webhook with INVALID auth header
        const badKeyRes = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
          method: 'POST',
          headers: { 'x-webhook-token': 'wrong-attacker-secret' },
          json: webhookPayload,
        });
        assert.strictEqual(badKeyRes.status, 401, 'Invalid webhook secret token must return 401 Unauthorized');
      }
    );

    // T3.4: Admin Route Rate Limiting & Authentication Protection
    await test(
      'T3.4: Admin Login Rate Limiting & Unauthenticated Admin Route Blocking',
      'VULN-04',
      async () => {
        // 1. Unauthenticated access to Admin Endpoints
        const unauthFamilies = await apiRequest(ctx.baseUrl, '/api/admin/families');
        assert.strictEqual(unauthFamilies.status, 401, 'Unauthenticated /api/admin/families must return 401');

        const unauthMe = await apiRequest(ctx.baseUrl, '/api/admin/me');
        assert.strictEqual(unauthMe.status, 401, 'Unauthenticated /api/admin/me must return 401');

        // 2. High-speed Brute-Force against /api/admin/login from the SAME IP
        const testIp = '198.51.100.42';
        let rateLimited = false;

        for (let i = 0; i < 20; i++) {
          const loginAttempt = await apiRequest(ctx.baseUrl, '/api/admin/login', {
            method: 'POST',
            ip: testIp,
            json: { username: 'admin', password: `wrong_pass_${i}` },
          });

          if (loginAttempt.status === 429) {
            rateLimited = true;
            break;
          }
        }

        // Hardened requirement: authRateLimiter mounted on /api/admin/login triggers 429 after 15 attempts
        assert.ok(
          rateLimited,
          'Admin login brute-force was not throttled after 20 rapid attempts! Missing authRateLimiter on /api/admin/login.'
        );
      }
    );

    // T3.5: Google Calendar OAuth CSRF State Forgery
    await test(
      'T3.5: Google Calendar OAuth Callback State Forgery Rejection',
      'VULN-05',
      async () => {
        const fam = await createTestFamily();

        // Calling callback with raw unauthenticated patientId (CSRF vulnerability VULN-05)
        const csrfCallback = await apiRequest(ctx.baseUrl, '/api/calendar/callback', {
          params: {
            code: 'mock_authorization_code',
            state: fam.papaId, // Raw unsigned patient ID
          },
        });

        // Hardened requirement: Callback must require cryptographically signed HMAC/JWT state and reject raw patientId
        assert.ok(
          [400, 401, 403].includes(csrfCallback.status) && !csrfCallback.text.includes('vinculado correctamente'),
          `OAuth callback accepted unsigned raw patientId state! Missing CSRF HMAC verification.`
        );
      }
    );

    // T3.6: URL Query Parameter JWT Token Rejection
    await test(
      'T3.6: Session JWT Token Rejection in URL Query Parameters',
      'VULN-07',
      async () => {
        const fam = await createTestFamily();

        // Attempting authenticated request with ?token=<jwt> in URL query string instead of Authorization header
        const queryTokenRes = await apiRequest(ctx.baseUrl, `/api/patients?token=${encodeURIComponent(fam.token)}`);

        // Hardened requirement: Long-lived JWT tokens in query strings must be rejected (401)
        assert.strictEqual(
          queryTokenRes.status,
          401,
          `API accepted 90-day JWT in URL query parameter (?token=...). Should require Bearer header.`
        );
      }
    );

    // T3.7: CORS & Helmet CSP Configuration Hardening
    await test(
      'T3.7: CORS Origin Restriction and Helmet Security Headers Enforcement',
      'VULN-08',
      async () => {
        const health = await apiRequest(ctx.baseUrl, '/api/health');
        assert.strictEqual(health.status, 200);

        // Verify X-Content-Type-Options
        assert.strictEqual(health.headers.get('x-content-type-options'), 'nosniff');

        // Check CORS allow origin with credentials
        const corsOrigin = health.headers.get('access-control-allow-origin');
        const corsCreds = health.headers.get('access-control-allow-credentials');

        if (corsCreds === 'true') {
          assert.notStrictEqual(
            corsOrigin,
            '*',
            'Insecure CORS configuration: Access-Control-Allow-Origin is "*" with Access-Control-Allow-Credentials: true'
          );
        }
      }
    );

    // T3.8: File Ownership Hijacking via /confirm-batch
    await test(
      'T3.8: File Ownership Hijacking Prevention in Batch Order Confirmation',
      'VULN-02-B',
      async () => {
        const familyA = await createTestFamily({ code: 'family_alpha_batch' });
        const familyB = await createTestFamily({ code: 'family_beta_batch' });

        const filenameA = `private-scan-${Date.now()}.pdf`;
        writeTestFile(filenameA, '%PDF-1.4 SENSITIVE DOC OF FAMILY A');

        // Family B attempts to claim Family A's file via confirm-batch
        const apptB = await apiRequest(ctx.baseUrl, '/api/appointments', {
          method: 'POST',
          token: familyB.token,
          json: { patient_id: familyB.papaId, title: 'Cita B', date_time: '2026-11-01T10:00:00Z' },
        });

        const hijackAttempt = await apiRequest(ctx.baseUrl, '/api/medical-orders/confirm-batch', {
          method: 'POST',
          token: familyB.token,
          json: {
            orders: [
              {
                appointment_id: apptB.body.id,
                patient_id: familyB.papaId,
                order_type: 'examen',
                title: 'Hijacked File Order',
                file_url: `/api/uploads/${filenameA}`,
              },
            ],
          },
        });

        // If successfully hijacked into medical_orders, Family B can now access Family A's file permanently
        const attackerFileAccess = await apiRequest(ctx.baseUrl, `/api/uploads/${filenameA}`, {
          token: familyB.token,
        });

        assert.strictEqual(
          attackerFileAccess.status,
          403,
          'File ownership was hijacked via /confirm-batch! Family B gained permanent access to Family A file.'
        );
      }
    );

  } finally {
    await ctx.close();
  }

  console.log(`\nTier 3 Finished: ${passed}/${total} passed (${failed} failed).`);
  if (vulnerabilitiesDetected.length > 0) {
    console.log(`\n🚨 Identified Vulnerability Findings (${vulnerabilitiesDetected.length}):`);
    vulnerabilitiesDetected.forEach((v) => console.log(`   - ${v}`));
  }
  console.log('\n');

  return { total, passed, failed, errors, vulnerabilitiesDetected };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTier3Tests()
    .then((r) => process.exit(r.failed > 0 ? 1 : 0))
    .catch((err) => {
      console.error('Fatal in Tier 3:', err);
      process.exit(1);
    });
}
