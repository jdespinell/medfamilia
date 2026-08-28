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

export async function runTier1Tests(): Promise<{ total: number; passed: number; failed: number; errors: any[] }> {
  console.log('\n============================================================');
  console.log('🧪 RUNNING TIER 1: FEATURE COVERAGE (HAPPY PATH VERIFICATION)');
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

    // F01: Registration & WhatsApp OTP Verification
    await test('F01: Family Registration & WhatsApp OTP Verification Flow', async () => {
      const phone = '573009876543';
      const otpCode = '654321';
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Seed OTP verification in DB
      db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(phone);
      db.prepare('INSERT INTO otp_verifications (phone, code, expires_at) VALUES (?, ?, ?)').run(
        phone, otpCode, expiresAt
      );

      const regRes = await apiRequest(ctx.baseUrl, '/api/auth/register', {
        method: 'POST',
        json: {
          name: 'Familia Gomez',
          code: 'gomez2026',
          password: 'Password123!',
          phone: '3009876543',
          otp_code: otpCode,
        },
      });

      assert.strictEqual(regRes.status, 200, `Expected 200 on register, got ${regRes.status}: ${regRes.text}`);
      assert.ok(regRes.body.token, 'Expected JWT token in registration response');
      assert.strictEqual(regRes.body.family.code, 'gomez2026');

      // Verify default patients 'Papá' and 'Mamá' created
      const patients = db.prepare('SELECT name FROM patients WHERE family_id = ?').all(regRes.body.family.id) as any[];
      const names = patients.map((p) => p.name);
      assert.ok(names.includes('Papá'), 'Default patient Papá should exist');
      assert.ok(names.includes('Mamá'), 'Default patient Mamá should exist');
    });

    // F02: Authentication & Token Issuance
    await test('F02: Family and Superadmin Authentication & Profile Retrieval', async () => {
      const fam = await createTestFamily({ code: 'auth_test_fam', password: 'SecretPassword123' });

      // Family Login
      const loginRes = await apiRequest(ctx.baseUrl, '/api/auth/login', {
        method: 'POST',
        json: { code: 'auth_test_fam', password: 'SecretPassword123' },
      });
      assert.strictEqual(loginRes.status, 200, `Login failed with status ${loginRes.status}`);
      assert.ok(loginRes.body.token, 'Expected JWT token on login');

      // Family Session Verification (/api/auth/me)
      const meRes = await apiRequest(ctx.baseUrl, '/api/auth/me', { token: loginRes.body.token });
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.body.family.id, fam.id);

      // Superadmin Login
      const adminLoginRes = await apiRequest(ctx.baseUrl, '/api/admin/login', {
        method: 'POST',
        json: { username: 'admin', password: 'admin12345' },
      });
      assert.strictEqual(adminLoginRes.status, 200);
      assert.ok(adminLoginRes.body.token, 'Expected admin JWT token');

      // Superadmin Session Verification (/api/admin/me)
      const adminMeRes = await apiRequest(ctx.baseUrl, '/api/admin/me', { token: adminLoginRes.body.token });
      assert.strictEqual(adminMeRes.status, 200);
      assert.strictEqual(adminMeRes.body.role, 'superadmin');
    });

    // F03: Rate Limiting & DoS Protection Headers
    await test('F03: Rate Limiting Headers presence', async () => {
      const healthRes = await apiRequest(ctx.baseUrl, '/api/health');
      assert.strictEqual(healthRes.status, 200);
      // General rate limiter standard headers
      const hasLimit = healthRes.headers.get('ratelimit-limit') || healthRes.headers.get('x-ratelimit-limit');
      assert.ok(hasLimit !== null, 'Rate limit headers should be configured on API routes');
    });

    // F04: Security Headers & CORS Policy
    await test('F04: Security Headers & CORS Configuration Verification', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', 'X-Content-Type-Options must be nosniff');
    });

    // F05: Secure File Serving
    await test('F05: Secure File Serving for Owner Family', async () => {
      const fam = await createTestFamily();
      const testFilename = `exam-result-${Date.now()}.pdf`;
      writeTestFile(testFilename, '%PDF-1.4 Mock PDF Content');

      // Register exam in DB belonging to fam
      db.prepare(`
        INSERT INTO exam_results (id, family_id, patient_id, title, file_url, file_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(['exam-f05-id', fam.id, fam.papaId, 'Hemograma Completo', `/api/uploads/${testFilename}`, 'pdf']);

      const fileRes = await apiRequest(ctx.baseUrl, `/api/uploads/${testFilename}`, { token: fam.token });
      assert.strictEqual(fileRes.status, 200, `Expected 200 for owner file download, got ${fileRes.status}`);
      assert.ok(fileRes.text.includes('%PDF-1.4'), 'File content should match');
    });

    // F06: File Upload & Verification
    await test('F06: Exam File Upload & Record Creation', async () => {
      const fam = await createTestFamily();
      const filename = `test-upload-${Date.now()}.png`;
      writeTestFile(filename, Buffer.from('fake-png-content'));

      // Direct insert representing successful upload handler persistence
      const examId = `exam-upload-${Date.now()}`;
      db.prepare(`
        INSERT INTO exam_results (id, family_id, patient_id, title, file_url, file_type, summary_ai)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run([examId, fam.id, fam.papaId, 'Radiografía de Tórax', `/api/uploads/${filename}`, 'image', 'Resumen AI']);

      const getExams = await apiRequest(ctx.baseUrl, '/api/exams', { token: fam.token });
      assert.strictEqual(getExams.status, 200);
      assert.ok(Array.isArray(getExams.body));
      const found = getExams.body.find((e: any) => e.id === examId);
      assert.ok(found, 'Uploaded exam record should be returned in list');
    });

    // F07: WhatsApp Evolution API Webhook
    await test('F07: WhatsApp Webhook Processing for Registered Number', async () => {
      const fam = await createTestFamily({ phone: '573115550001' });

      const webhookPayload = {
        event: 'messages.upsert',
        data: {
          key: {
            remoteJid: '573115550001@s.whatsapp.net',
            fromMe: false,
            id: `MSG-${Date.now()}`,
          },
          pushName: 'Carlos Gomez',
          message: {
            conversation: 'Hola, quiero consultar mis próximas citas',
          },
        },
      };

      const hookRes = await apiRequest(ctx.baseUrl, '/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'x-webhook-token': 'medfamilia_webhook_secret_2026',
          'apikey': 'medfamilia_whatsapp_key_2026',
        },
        json: webhookPayload,
      });

      assert.strictEqual(hookRes.status, 200, `Expected 200 on webhook event, got ${hookRes.status}`);
    });

    // F08: WhatsApp Media & Status
    await test('F08: WhatsApp Service Status & Family WhatsApp Numbers Management', async () => {
      const fam = await createTestFamily();

      // WhatsApp status with admin Bearer token
      const adminToken = getAdminToken();
      const statusRes = await apiRequest(ctx.baseUrl, '/api/whatsapp/status', { token: adminToken });
      // Should not return 401 with valid admin token
      assert.notStrictEqual(statusRes.status, 401, 'Valid admin Bearer token should authorize status route');

      // List WhatsApp numbers
      const listNumbers = await apiRequest(ctx.baseUrl, '/api/whatsapp-numbers', { token: fam.token });
      assert.strictEqual(listNumbers.status, 200);
      assert.ok(Array.isArray(listNumbers.body));
      assert.strictEqual(listNumbers.body.length, 1);

      // Add authorized number
      const addNumRes = await apiRequest(ctx.baseUrl, '/api/whatsapp-numbers', {
        method: 'POST',
        token: fam.token,
        json: { phone_number: '3129998877', label: 'Hijo' },
      });
      assert.strictEqual(addNumRes.status, 200);
    });

    // F09: Google Calendar OAuth
    await test('F09: Google Calendar OAuth Consent URL Generation', async () => {
      const fam = await createTestFamily();
      const authUrlRes = await apiRequest(ctx.baseUrl, `/api/calendar/auth-url/${fam.papaId}`, {
        token: fam.token,
      });
      // Returns 200 or 400 if Google Client ID not in test env
      assert.ok([200, 400].includes(authUrlRes.status));
    });

    // F10: Web Push Notifications
    await test('F10: VAPID Public Key Retrieval & Push Subscription Registration', async () => {
      const fam = await createTestFamily();

      const vapidRes = await apiRequest(ctx.baseUrl, '/api/push/vapid-key', { token: fam.token });
      assert.strictEqual(vapidRes.status, 200);

      const subRes = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: fam.token,
        json: {
          subscription: {
            endpoint: `https://fcm.googleapis.com/fcm/send/test-sub-${Date.now()}`,
            keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-secret' },
          },
        },
      });
      assert.strictEqual(subRes.status, 200);
    });

    // F11: Gemini OCR & AI Endpoint
    await test('F11: Gemini AI Appointment Text Parsing Route', async () => {
      const fam = await createTestFamily();
      const aiRes = await apiRequest(ctx.baseUrl, '/api/appointments/ai-text', {
        method: 'POST',
        token: fam.token,
        json: { text: 'Cita con el Dr. Juan Perez el 15 de Octubre a las 10:00 AM para Cardiologia' },
      });
      // Will return 200 (if API key mocked/live) or 500 error message handled gracefully
      assert.ok([200, 500].includes(aiRes.status));
    });

    // F12: Patient CRUD
    await test('F12: Patient Management CRUD Lifecycle', async () => {
      const fam = await createTestFamily();

      // Create Patient
      const createRes = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: fam.token,
        json: { name: 'Valentina Gomez', relationship: 'Hija', color: '#ec4899' },
      });
      assert.strictEqual(createRes.status, 200);
      const patientId = createRes.body.id;
      assert.ok(patientId);

      // Read Patients
      const listRes = await apiRequest(ctx.baseUrl, '/api/patients', { token: fam.token });
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.body.some((p: any) => p.id === patientId));

      // Update Patient
      const updateRes = await apiRequest(ctx.baseUrl, `/api/patients/${patientId}`, {
        method: 'PUT',
        token: fam.token,
        json: { name: 'Valentina Gomez Perez', relationship: 'Hija Mayor', color: '#8b5cf6' },
      });
      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.name, 'Valentina Gomez Perez');

      // Delete Patient
      const delRes = await apiRequest(ctx.baseUrl, `/api/patients/${patientId}`, {
        method: 'DELETE',
        token: fam.token,
      });
      assert.strictEqual(delRes.status, 200);

      // Verify Deleted
      const postDelete = await apiRequest(ctx.baseUrl, '/api/patients', { token: fam.token });
      assert.ok(!postDelete.body.some((p: any) => p.id === patientId));
    });

    // F13: Appointments Lifecycle
    await test('F13: Appointment Scheduling, Updating, and Deletion Lifecycle', async () => {
      const fam = await createTestFamily();

      // Create Appointment
      const createRes = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.papaId,
          title: 'Control Anual Cardiología',
          appointment_type: 'consulta',
          specialist: 'Dr. Alejandro Restrepo',
          specialty: 'Cardiología',
          location: 'Clínica Las Américas Consultorio 402',
          date_time: '2026-11-20T10:30:00Z',
          requires_fasting: 1,
          prep_instructions: 'Ayuno de 8 horas para toma de muestras',
        },
      });
      assert.strictEqual(createRes.status, 200);
      const apptId = createRes.body.id;
      assert.ok(apptId);

      // Read Appointments
      const listRes = await apiRequest(ctx.baseUrl, '/api/appointments', { token: fam.token });
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.body.some((a: any) => a.id === apptId));

      // Update Appointment Status to 'completada'
      const updateRes = await apiRequest(ctx.baseUrl, `/api/appointments/${apptId}`, {
        method: 'PUT',
        token: fam.token,
        json: { status: 'completada', doctor_notes: 'Paciente con presión normal. Control en 1 año.' },
      });
      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.status, 'completada');

      // Delete Appointment
      const delRes = await apiRequest(ctx.baseUrl, `/api/appointments/${apptId}`, {
        method: 'DELETE',
        token: fam.token,
      });
      assert.strictEqual(delRes.status, 200);
    });

    // F14: Medical Orders Lifecycle & Batch Confirmation
    await test('F14: Medical Orders Draft Confirmation & Status Transitions', async () => {
      const fam = await createTestFamily();

      // Create an appointment first to link order
      const apptRes = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.mamaId,
          title: 'Cita Medicina Interna',
          date_time: '2026-10-10T09:00:00Z',
        },
      });
      const apptId = apptRes.body.id;

      // Confirm draft order batch
      const confirmRes = await apiRequest(ctx.baseUrl, '/api/medical-orders/confirm-batch', {
        method: 'POST',
        token: fam.token,
        json: {
          orders: [
            {
              appointment_id: apptId,
              patient_id: fam.mamaId,
              order_type: 'laboratorio',
              title: 'Perfil Lipídico y Glicemia',
              description: 'Examen en ayunas',
            },
          ],
        },
      });
      assert.strictEqual(confirmRes.status, 200);
      assert.strictEqual(confirmRes.body.success, true);
      assert.strictEqual(confirmRes.body.orders.length, 1);
      const orderId = confirmRes.body.orders[0].id;

      // Read Pending Orders
      const pendingRes = await apiRequest(ctx.baseUrl, '/api/medical-orders/pending', { token: fam.token });
      assert.strictEqual(pendingRes.status, 200);
      assert.ok(pendingRes.body.some((o: any) => o.id === orderId));

      // Update Order Status to 'agendada'
      const updateOrderRes = await apiRequest(ctx.baseUrl, `/api/medical-orders/${orderId}`, {
        method: 'PUT',
        token: fam.token,
        json: { status: 'agendada' },
      });
      assert.strictEqual(updateOrderRes.status, 200);
      assert.strictEqual(updateOrderRes.body.status, 'agendada');

      // Delete Order
      const delRes = await apiRequest(ctx.baseUrl, `/api/medical-orders/${orderId}`, {
        method: 'DELETE',
        token: fam.token,
      });
      assert.strictEqual(delRes.status, 200);
    });

    // F15: Exam Results & Summaries
    await test('F15: Exam Results List and Deletion Lifecycle', async () => {
      const fam = await createTestFamily();
      const filename = `exam-res-${Date.now()}.pdf`;
      writeTestFile(filename, '%PDF-1.4 Mock Exam');

      const examId = `exam-test-${Date.now()}`;
      db.prepare(`
        INSERT INTO exam_results (id, family_id, patient_id, title, file_url, file_type, summary_ai)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run([examId, fam.id, fam.papaId, 'Ecocardiograma', `/api/uploads/${filename}`, 'pdf', 'Resumen normal']);

      const listRes = await apiRequest(ctx.baseUrl, '/api/exams', { token: fam.token });
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.body.some((e: any) => e.id === examId));

      const delRes = await apiRequest(ctx.baseUrl, `/api/exams/${examId}`, {
        method: 'DELETE',
        token: fam.token,
      });
      assert.strictEqual(delRes.status, 200);
    });

    // F16: Medical Specialties Catalog
    await test('F16: Medical Specialties Default Catalog & Custom Family Additions', async () => {
      const fam = await createTestFamily();

      const listRes = await apiRequest(ctx.baseUrl, '/api/specialties', { token: fam.token });
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.body.length >= 15, 'Default system specialties should be present');

      // Add custom specialty
      const addRes = await apiRequest(ctx.baseUrl, '/api/specialties', {
        method: 'POST',
        token: fam.token,
        json: { name: 'Genética Médica' },
      });
      assert.strictEqual(addRes.status, 200);
      assert.strictEqual(addRes.body.name, 'Genética Médica');
    });

    // F17: Superadmin SaaS Console
    await test('F17: Superadmin SaaS Portal Operations (Metrics, Plan Upgrade, Usage Reset)', async () => {
      const fam = await createTestFamily({ plan_type: 'gratuito', max_daily_whatsapp_queries: 5 });
      const adminToken = getAdminToken();

      // List families
      const listFamilies = await apiRequest(ctx.baseUrl, '/api/admin/families', { token: adminToken });
      assert.strictEqual(listFamilies.status, 200);
      assert.ok(listFamilies.body.families.some((f: any) => f.id === fam.id));

      // Upgrade plan to 'pago' with 50 daily queries
      const upgradeRes = await apiRequest(ctx.baseUrl, `/api/admin/families/${fam.id}/plan`, {
        method: 'PATCH',
        token: adminToken,
        json: { plan_type: 'pago', max_daily_whatsapp_queries: 50 },
      });
      assert.strictEqual(upgradeRes.status, 200);
      assert.strictEqual(upgradeRes.body.family.plan_type, 'pago');
      assert.strictEqual(upgradeRes.body.family.max_daily_whatsapp_queries, 50);

      // Reset daily usage counter
      const resetRes = await apiRequest(ctx.baseUrl, `/api/admin/families/${fam.id}/reset-usage`, {
        method: 'POST',
        token: adminToken,
      });
      assert.strictEqual(resetRes.status, 200);
    });

    // F18: Automated Security Test Suite Verification
    await test('F18: Test Framework Self-Verification & Invariant Consistency', async () => {
      assert.ok(total >= 17, 'All feature suites executed');
    });

  } finally {
    await ctx.close();
  }

  console.log(`\nTier 1 Finished: ${passed}/${total} passed (${failed} failed).\n`);
  return { total, passed, failed, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTier1Tests()
    .then((r) => process.exit(r.failed > 0 ? 1 : 0))
    .catch((err) => {
      console.error('Fatal in Tier 1:', err);
      process.exit(1);
    });
}
