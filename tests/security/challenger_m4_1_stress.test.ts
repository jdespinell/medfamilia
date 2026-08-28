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
  db,
  TestServerContext,
} from './testHelper.js';
import { TEST_UPLOADS_DIR } from './envSetup.js';

export async function runChallengerM4StressSuite() {
  console.log('\n================================================================');
  console.log('🛡️  CHALLENGER 1: M4 INPUT BOUNDARIES, DOS FLOODING & FUZZING');
  console.log('    Oversized Strings, Malformed Injections & Multipart Cleanup');
  console.log('================================================================\n');

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

  // Helper generators
  const generateOversizedString = (sizeKb: number = 50): string => {
    return 'A'.repeat(sizeKb * 1024);
  };

  const createValidJpegBuffer = (size = 128): Buffer => {
    return Buffer.concat([
      Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]),
      Buffer.alloc(size, 0xAA),
    ]);
  };

  const createValidPdfBuffer = (size = 128): Buffer => {
    return Buffer.concat([
      Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
      Buffer.alloc(size, 0xBB),
    ]);
  };

  ctx = await startTestServer();

  try {
    resetDatabase();
    const family1 = await createTestFamily({ code: 'm4_fam_stress', name: 'Familia M4 Stress' });
    const adminToken = getAdminToken();

    // =========================================================================
    // 1. OVERSIZED STRING DOS FLOODING TESTS (50KB+)
    // =========================================================================
    console.log('\n--- 1. Oversized String DoS Stress Testing (50KB Payloads) ---');

    const str50kb = generateOversizedString(50);

    await runTest('1.1: POST /api/patients rejects 50KB name with HTTP 400 and zero DB insertion', async () => {
      const initialCount = (db.prepare('SELECT COUNT(*) as cnt FROM patients WHERE family_id = ?').get(family1.id) as any).cnt;

      const res = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: family1.token,
        json: {
          name: str50kb,
          relationship: 'Hijo',
          color: '#3b82f6',
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
      assert.ok(res.body.error, 'Response must contain error message');

      const afterCount = (db.prepare('SELECT COUNT(*) as cnt FROM patients WHERE family_id = ?').get(family1.id) as any).cnt;
      assert.strictEqual(afterCount, initialCount, 'Database count must not increase after rejected oversized input');
    });

    await runTest('1.2: PUT /api/patients/:id rejects 50KB name with HTTP 400 and preserves existing value', async () => {
      const originalPatient = db.prepare('SELECT name FROM patients WHERE id = ?').get(family1.papaId) as any;

      const res = await apiRequest(ctx.baseUrl, `/api/patients/${family1.papaId}`, {
        method: 'PUT',
        token: family1.token,
        json: {
          name: str50kb,
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);

      const currentPatient = db.prepare('SELECT name FROM patients WHERE id = ?').get(family1.papaId) as any;
      assert.strictEqual(currentPatient.name, originalPatient.name, 'Patient name must remain unchanged in database');
    });

    await runTest('1.3: POST /api/specialties rejects 50KB name with HTTP 400 and zero DB insertion', async () => {
      const initialCount = (db.prepare('SELECT COUNT(*) as cnt FROM specialties WHERE family_id = ?').get(family1.id) as any).cnt;

      const res = await apiRequest(ctx.baseUrl, '/api/specialties', {
        method: 'POST',
        token: family1.token,
        json: {
          name: str50kb,
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
      const afterCount = (db.prepare('SELECT COUNT(*) as cnt FROM specialties WHERE family_id = ?').get(family1.id) as any).cnt;
      assert.strictEqual(afterCount, initialCount, 'Specialty count must not increase');
    });

    await runTest('1.4: POST /api/appointments rejects 50KB title with HTTP 400 and zero DB insertion', async () => {
      const initialCount = (db.prepare('SELECT COUNT(*) as cnt FROM appointments WHERE family_id = ?').get(family1.id) as any).cnt;

      const res = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family1.token,
        json: {
          patient_id: family1.papaId,
          title: str50kb,
          date_time: '2026-09-01T10:00:00.000Z',
          appointment_type: 'consulta',
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
      const afterCount = (db.prepare('SELECT COUNT(*) as cnt FROM appointments WHERE family_id = ?').get(family1.id) as any).cnt;
      assert.strictEqual(afterCount, initialCount, 'Appointment count must not increase');
    });

    await runTest('1.5: POST /api/appointments rejects 50KB doctor_notes with HTTP 400', async () => {
      const initialCount = (db.prepare('SELECT COUNT(*) as cnt FROM appointments WHERE family_id = ?').get(family1.id) as any).cnt;

      const res = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family1.token,
        json: {
          patient_id: family1.papaId,
          title: 'Consulta Cardiología',
          date_time: '2026-09-01T10:00:00.000Z',
          doctor_notes: str50kb,
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
      const afterCount = (db.prepare('SELECT COUNT(*) as cnt FROM appointments WHERE family_id = ?').get(family1.id) as any).cnt;
      assert.strictEqual(afterCount, initialCount, 'Appointment count must not increase');
    });

    await runTest('1.6: POST /api/appointments rejects 50KB prep_instructions with HTTP 400', async () => {
      const initialCount = (db.prepare('SELECT COUNT(*) as cnt FROM appointments WHERE family_id = ?').get(family1.id) as any).cnt;

      const res = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family1.token,
        json: {
          patient_id: family1.papaId,
          title: 'Examen de Sangre',
          date_time: '2026-09-01T10:00:00.000Z',
          prep_instructions: str50kb,
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
      const afterCount = (db.prepare('SELECT COUNT(*) as cnt FROM appointments WHERE family_id = ?').get(family1.id) as any).cnt;
      assert.strictEqual(afterCount, initialCount, 'Appointment count must not increase');
    });

    await runTest('1.7: POST /api/medical-orders rejects 50KB description with HTTP 400', async () => {
      // First create a valid appointment to test against
      const apptId = uuidv4();
      db.prepare(`
        INSERT INTO appointments (id, family_id, patient_id, title, date_time, status)
        VALUES (?, ?, ?, 'Cita Base Test', '2026-09-01T10:00:00.000Z', 'pendiente')
      `).run([apptId, family1.id, family1.papaId]);

      const initialCount = (db.prepare('SELECT COUNT(*) as cnt FROM medical_orders WHERE family_id = ?').get(family1.id) as any).cnt;

      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders', {
        method: 'POST',
        token: family1.token,
        json: {
          appointment_id: apptId,
          patient_id: family1.papaId,
          title: 'Orden Médica Normal',
          description: str50kb,
          order_type: 'examen',
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
      const afterCount = (db.prepare('SELECT COUNT(*) as cnt FROM medical_orders WHERE family_id = ?').get(family1.id) as any).cnt;
      assert.strictEqual(afterCount, initialCount, 'Medical orders count must not increase');
    });

    await runTest('1.8: POST /api/medical-orders/confirm-batch rejects 50KB title in order item with HTTP 400', async () => {
      const appt = db.prepare('SELECT id FROM appointments WHERE family_id = ? LIMIT 1').get(family1.id) as any;
      const initialCount = (db.prepare('SELECT COUNT(*) as cnt FROM medical_orders WHERE family_id = ?').get(family1.id) as any).cnt;

      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders/confirm-batch', {
        method: 'POST',
        token: family1.token,
        json: {
          orders: [
            {
              appointment_id: appt.id,
              patient_id: family1.papaId,
              title: str50kb,
              order_type: 'examen',
              description: 'Valid description',
            },
          ],
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
      const afterCount = (db.prepare('SELECT COUNT(*) as cnt FROM medical_orders WHERE family_id = ?').get(family1.id) as any).cnt;
      assert.strictEqual(afterCount, initialCount, 'Medical orders count must not increase');
    });

    await runTest('1.9: POST /api/auth/send-whatsapp-otp rejects 50KB phone number string with HTTP 400', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/auth/send-whatsapp-otp', {
        method: 'POST',
        json: {
          phone: str50kb,
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
    });

    await runTest('1.10: POST /api/appointments/ai-text rejects 50KB text with HTTP 400 (max 5000 chars)', async () => {
      const res = await apiRequest(ctx.baseUrl, '/api/appointments/ai-text', {
        method: 'POST',
        token: family1.token,
        json: {
          text: str50kb,
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);
    });

    // =========================================================================
    // 2. MALFORMED TYPES, INJECTIONS & ENUM BOUNDARIES
    // =========================================================================
    console.log('\n--- 2. Malformed Types & Injection Fuzzing ---');

    await runTest('2.1: Rejection of Arrays where Strings/Primitives expected (HTTP 400)', async () => {
      const malformedPayloads = [
        {
          endpoint: '/api/patients',
          method: 'POST',
          token: family1.token,
          json: { name: ['Hacked', 'Array', 'Name'], relationship: 'Hijo', color: '#3b82f6' },
        },
        {
          endpoint: '/api/appointments',
          method: 'POST',
          token: family1.token,
          json: {
            patient_id: family1.papaId,
            title: ['Nested', 'Title', 'Array'],
            date_time: '2026-09-01T10:00:00.000Z',
          },
        },
        {
          endpoint: '/api/specialties',
          method: 'POST',
          token: family1.token,
          json: { name: ['ArraySpecialty'] },
        },
        {
          endpoint: '/api/admin/login',
          method: 'POST',
          json: { username: ['admin'], password: ['pwd'] },
        },
      ];

      for (const item of malformedPayloads) {
        const res = await apiRequest(ctx.baseUrl, item.endpoint, {
          method: item.method,
          token: item.token,
          json: item.json,
        });
        assert.strictEqual(res.status, 400, `Endpoint ${item.endpoint} must reject array with 400, got ${res.status}`);
      }
    });

    await runTest('2.2: Rejection of Objects where Primitives expected (NoSQL injection vectors) (HTTP 400)', async () => {
      const injectionPayloads = [
        {
          endpoint: '/api/patients',
          method: 'POST',
          token: family1.token,
          json: { name: { $gt: '' }, relationship: { $ne: null }, color: '#3b82f6' },
        },
        {
          endpoint: '/api/appointments',
          method: 'POST',
          token: family1.token,
          json: {
            patient_id: { $ne: '' },
            title: { evil: true },
            date_time: '2026-09-01T10:00:00.000Z',
          },
        },
        {
          endpoint: '/api/admin/login',
          method: 'POST',
          json: { username: { $regex: '.*' }, password: { $gt: '' } },
        },
        {
          endpoint: '/api/whatsapp-numbers',
          method: 'POST',
          token: family1.token,
          json: { phone_number: { num: 12345 } },
        },
      ];

      for (const item of injectionPayloads) {
        const res = await apiRequest(ctx.baseUrl, item.endpoint, {
          method: item.method,
          token: item.token,
          json: item.json,
        });
        assert.strictEqual(res.status, 400, `Endpoint ${item.endpoint} must reject object injection with 400, got ${res.status}`);
      }
    });

    await runTest('2.3: Rejection of Invalid Enum values across all endpoints (HTTP 400)', async () => {
      const appt = db.prepare('SELECT id FROM appointments WHERE family_id = ? LIMIT 1').get(family1.id) as any;

      // 1. appointment_type: 'hacked' on POST /api/appointments
      const res1 = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family1.token,
        json: {
          patient_id: family1.papaId,
          title: 'Consulta General',
          date_time: '2026-09-01T10:00:00.000Z',
          appointment_type: 'hacked_malicious_type',
        },
      });
      assert.strictEqual(res1.status, 400, `Invalid appointment_type must return 400, got ${res1.status}`);

      // 2. status: 'destroy_all' on PUT /api/appointments/:id
      const res2 = await apiRequest(ctx.baseUrl, `/api/appointments/${appt.id}`, {
        method: 'PUT',
        token: family1.token,
        json: {
          status: 'destroy_all_records',
        },
      });
      assert.strictEqual(res2.status, 400, `Invalid appointment status must return 400, got ${res2.status}`);

      // 3. order_type: 'invalid_order_type' on POST /api/medical-orders
      const res3 = await apiRequest(ctx.baseUrl, '/api/medical-orders', {
        method: 'POST',
        token: family1.token,
        json: {
          appointment_id: appt.id,
          patient_id: family1.papaId,
          title: 'Orden Test',
          order_type: 'arbitrary_injection',
        },
      });
      assert.strictEqual(res3.status, 400, `Invalid order_type must return 400, got ${res3.status}`);

      // 4. plan_type: 'free_admin_hack' on PATCH /api/admin/families/:id/plan
      const res4 = await apiRequest(ctx.baseUrl, `/api/admin/families/${family1.id}/plan`, {
        method: 'PATCH',
        token: adminToken,
        json: {
          plan_type: 'free_admin_hack',
        },
      });
      assert.strictEqual(res4.status, 400, `Invalid plan_type enum must return 400, got ${res4.status}`);
    });

    await runTest('2.4: Rejection of Invalid / Malformed Dates across endpoints (HTTP 400)', async () => {
      const invalidDates = [
        'not-a-date',
        '2026-99-99T99:99:99Z',
        'yesterday',
        '0000-00-00',
        'undefined',
        'null',
      ];

      for (const dateVal of invalidDates) {
        const res = await apiRequest(ctx.baseUrl, '/api/appointments', {
          method: 'POST',
          token: family1.token,
          json: {
            patient_id: family1.papaId,
            title: 'Consulta Cita',
            date_time: dateVal,
          },
        });
        assert.strictEqual(res.status, 400, `Invalid date_time "${dateVal}" must return 400, got ${res.status}`);
      }
    });

    await runTest('2.5: Rejection of Invalid Hex Colors (HTTP 400)', async () => {
      const invalidColors = [
        'red',
        '#12345',         // 5 hex chars
        '#1234567',       // 7 hex chars
        '#GGGGGG',        // Non-hex chars
        'rgb(255,0,0)',   // CSS function
        'rgba(0,0,0,0)',
        'blue',
        '#12 345',
        '<script>',
      ];

      for (const color of invalidColors) {
        const res = await apiRequest(ctx.baseUrl, '/api/patients', {
          method: 'POST',
          token: family1.token,
          json: {
            name: `Patient Color Test ${color}`,
            relationship: 'Familiar',
            color: color,
          },
        });
        assert.strictEqual(res.status, 400, `Invalid color "${color}" must return 400, got ${res.status}`);
      }
    });

    await runTest('2.6: Rejection of Malformed UUID / Entity ID URL Parameters (HTTP 400)', async () => {
      const malformedParams = [
        { path: '/api/patients/not--valid%%--uuid', method: 'DELETE' },
        { path: '/api/appointments/bad@@id!!', method: 'DELETE' },
        { path: '/api/exams/invalid--param--^^', method: 'DELETE' },
        { path: '/api/medical-orders/bad..order$$', method: 'DELETE' },
        { path: '/api/whatsapp-numbers/bad&&num', method: 'DELETE' },
        { path: '/api/calendar/auth-url/malformed**patient', method: 'GET' },
      ];

      for (const item of malformedParams) {
        const res = await apiRequest(ctx.baseUrl, item.path, {
          method: item.method,
          token: family1.token,
        });
        assert.strictEqual(res.status, 400, `Malformed param URL ${item.path} must return 400, got ${res.status}`);
      }
    });

    await runTest('2.7: Rejection of Malformed Push Subscription Payloads (HTTP 400)', async () => {
      // 1. Primitive string instead of object
      const res1 = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: family1.token,
        json: { subscription: 'string-not-object' },
      });
      assert.strictEqual(res1.status, 400, `Non-object subscription must return 400, got ${res1.status}`);

      // 2. Invalid URL protocol (javascript: or ftp:)
      const res2 = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: family1.token,
        json: {
          subscription: {
            endpoint: 'javascript:alert(1)',
            keys: { p256dh: 'testkey', auth: 'testauth' },
          },
        },
      });
      assert.strictEqual(res2.status, 400, `Invalid protocol endpoint must return 400, got ${res2.status}`);

      // 3. Missing keys object
      const res3 = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: family1.token,
        json: {
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/sample',
            keys: null,
          },
        },
      });
      assert.strictEqual(res3.status, 400, `Missing keys must return 400, got ${res3.status}`);
    });

    // =========================================================================
    // 3. MULTIPART ERROR CLEANUP VERIFICATION
    // =========================================================================
    console.log('\n--- 3. Multipart Error Staging & File Cleanup ---');

    await runTest('3.1: POST /api/exams/upload with valid file but malformed body cleans up uploaded file immediately', async () => {
      const filesBefore = fs.existsSync(TEST_UPLOADS_DIR) ? fs.readdirSync(TEST_UPLOADS_DIR) : [];
      const jpegBuf = createValidJpegBuffer(512);

      const res = await apiRequest(ctx.baseUrl, '/api/exams/upload', {
        method: 'POST',
        token: family1.token,
        multipart: {
          fields: {
            patient_id: 'invalid-patient-uuid-%%',
            title: 'Examen de Sangre',
          },
          files: [
            {
              name: 'file',
              filename: 'test_lab_result.jpg',
              buffer: jpegBuf,
              mimeType: 'image/jpeg',
            },
          ],
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);

      const filesAfter = fs.existsSync(TEST_UPLOADS_DIR) ? fs.readdirSync(TEST_UPLOADS_DIR) : [];
      assert.strictEqual(
        filesAfter.length,
        filesBefore.length,
        `Orphaned upload file was not unlinked! Before: ${filesBefore.length}, After: ${filesAfter.length}`
      );

      // Verify no staging DB records left behind
      const stagingCount = (db.prepare('SELECT COUNT(*) as cnt FROM upload_staging WHERE family_id = ?').get(family1.id) as any).cnt;
      assert.strictEqual(stagingCount, 0, 'No upload_staging entries should exist for failed validation');
    });

    await runTest('3.2: POST /api/exams/upload with valid file and oversized title cleans up uploaded file immediately', async () => {
      const filesBefore = fs.existsSync(TEST_UPLOADS_DIR) ? fs.readdirSync(TEST_UPLOADS_DIR) : [];
      const jpegBuf = createValidJpegBuffer(512);

      const res = await apiRequest(ctx.baseUrl, '/api/exams/upload', {
        method: 'POST',
        token: family1.token,
        multipart: {
          fields: {
            patient_id: family1.papaId,
            title: str50kb,
          },
          files: [
            {
              name: 'file',
              filename: 'oversized_title_exam.jpg',
              buffer: jpegBuf,
              mimeType: 'image/jpeg',
            },
          ],
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request for oversized title, got ${res.status}`);

      const filesAfter = fs.existsSync(TEST_UPLOADS_DIR) ? fs.readdirSync(TEST_UPLOADS_DIR) : [];
      assert.strictEqual(
        filesAfter.length,
        filesBefore.length,
        `Orphaned file remained after validation error! Before: ${filesBefore.length}, After: ${filesAfter.length}`
      );
    });

    await runTest('3.3: POST /api/medical-orders with valid file but invalid appointment_id cleans up file', async () => {
      const filesBefore = fs.existsSync(TEST_UPLOADS_DIR) ? fs.readdirSync(TEST_UPLOADS_DIR) : [];
      const pdfBuf = createValidPdfBuffer(512);

      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders', {
        method: 'POST',
        token: family1.token,
        multipart: {
          fields: {
            appointment_id: 'bad@@appt%%id',
            patient_id: family1.papaId,
            title: 'Orden Médica PDF',
          },
          files: [
            {
              name: 'files',
              filename: 'orden_medica.pdf',
              buffer: pdfBuf,
              mimeType: 'application/pdf',
            },
          ],
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);

      const filesAfter = fs.existsSync(TEST_UPLOADS_DIR) ? fs.readdirSync(TEST_UPLOADS_DIR) : [];
      assert.strictEqual(
        filesAfter.length,
        filesBefore.length,
        `Orphaned file remained after validation error! Before: ${filesBefore.length}, After: ${filesAfter.length}`
      );
    });

    await runTest('3.4: POST /api/medical-orders/ai-batch with valid files but invalid UUID cleans up all files', async () => {
      const filesBefore = fs.existsSync(TEST_UPLOADS_DIR) ? fs.readdirSync(TEST_UPLOADS_DIR) : [];
      const pdfBuf1 = createValidPdfBuffer(256);
      const pdfBuf2 = createValidPdfBuffer(256);

      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders/ai-batch', {
        method: 'POST',
        token: family1.token,
        multipart: {
          fields: {
            appointment_id: 'bad@@appointment##uuid',
            patient_id: family1.papaId,
          },
          files: [
            { name: 'files', filename: 'order1.pdf', buffer: pdfBuf1, mimeType: 'application/pdf' },
            { name: 'files', filename: 'order2.pdf', buffer: pdfBuf2, mimeType: 'application/pdf' },
          ],
        },
      });

      assert.strictEqual(res.status, 400, `Expected 400 Bad Request, got ${res.status}`);

      const filesAfter = fs.existsSync(TEST_UPLOADS_DIR) ? fs.readdirSync(TEST_UPLOADS_DIR) : [];
      assert.strictEqual(
        filesAfter.length,
        filesBefore.length,
        `Orphaned files remained after batch validation error! Before: ${filesBefore.length}, After: ${filesAfter.length}`
      );
    });

    // =========================================================================
    // 4. DATABASE INTEGRITY & CONTAMINATION VERIFICATION
    // =========================================================================
    console.log('\n--- 4. Database Integrity Verification ---');

    await runTest('4.1: Verify no orphaned, corrupt or injected data exists across all database tables', async () => {
      // 1. Verify no patient has a name longer than 100 characters
      const longPatients = db.prepare('SELECT id, name, LENGTH(name) as len FROM patients WHERE LENGTH(name) > 100').all();
      assert.strictEqual(longPatients.length, 0, 'No patient may have a name exceeding 100 characters');

      // 2. Verify no appointment has a title longer than 200 characters
      const longAppts = db.prepare('SELECT id, title, LENGTH(title) as len FROM appointments WHERE LENGTH(title) > 200').all();
      assert.strictEqual(longAppts.length, 0, 'No appointment may have a title exceeding 200 characters');

      // 3. Verify all appointment status values are within enum set
      const invalidApptStatus = db.prepare("SELECT id, status FROM appointments WHERE status NOT IN ('pendiente', 'completada', 'cancelada')").all();
      assert.strictEqual(invalidApptStatus.length, 0, 'All appointment statuses must belong to allowed enum set');

      // 4. Verify all medical order types are within enum set
      const invalidOrderTypes = db.prepare("SELECT id, order_type FROM medical_orders WHERE order_type NOT IN ('examen', 'especialista', 'laboratorio', 'procedimiento')").all();
      assert.strictEqual(invalidOrderTypes.length, 0, 'All medical order types must belong to allowed enum set');

      // 5. Verify all patient colors are valid 7-character hex colors (#RRGGBB)
      const invalidColors = db.prepare("SELECT id, color FROM patients WHERE color NOT GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'").all();
      assert.strictEqual(invalidColors.length, 0, 'All patient colors must match strict 7-character hex color format');
    });

  } finally {
    await ctx.close();
  }

  console.log('\n================================================================');
  console.log(`📊 CHALLENGER 1 (M4) STRESS TEST RESULTS: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`Challenger M4 Stress Test failed with ${failed} failure(s).`);
  }

  return { total, passed, failed, testResults };
}

// Standalone execution support
if (process.argv[1] && process.argv[1].endsWith('challenger_m4_1_stress.test.ts')) {
  runChallengerM4StressSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal execution error:', err);
      process.exit(1);
    });
}
