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

export async function runTier4Tests(): Promise<{ total: number; passed: number; failed: number; errors: any[] }> {
  console.log('\n============================================================');
  console.log('🧪 RUNNING TIER 4: REAL-WORLD APPLICATION SCENARIOS');
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

    // T4.1: Multi-Tenant Complete Family & Patient Lifecycle
    await test('T4.1: Multi-Tenant Complete Family & Patient Isolation Lifecycle', async () => {
      // 1. Setup Family Alpha and Family Beta
      const familyAlpha = await createTestFamily({ code: 'alpha_tenant', name: 'Familia Alpha' });
      const familyBeta = await createTestFamily({ code: 'beta_tenant', name: 'Familia Beta' });

      // 2. Family Alpha adds patients Carlos and Sofia
      const pCarlos = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: familyAlpha.token,
        json: { name: 'Carlos Alpha', relationship: 'Hijo', color: '#3b82f6' },
      });
      assert.strictEqual(pCarlos.status, 200);

      const pSofia = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: familyAlpha.token,
        json: { name: 'Sofia Alpha', relationship: 'Hija', color: '#ec4899' },
      });
      assert.strictEqual(pSofia.status, 200);

      // 3. Family Beta adds patient Mateo
      const pMateo = await apiRequest(ctx.baseUrl, '/api/patients', {
        method: 'POST',
        token: familyBeta.token,
        json: { name: 'Mateo Beta', relationship: 'Hijo Unico', color: '#10b981' },
      });
      assert.strictEqual(pMateo.status, 200);

      // 4. Alpha creates Appointment for Carlos
      const apptAlpha = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: familyAlpha.token,
        json: {
          patient_id: pCarlos.body.id,
          title: 'Consulta Pediatría Carlos',
          date_time: '2026-11-15T15:00:00Z',
          specialty: 'Pediatría',
        },
      });
      assert.strictEqual(apptAlpha.status, 200);

      // 5. Beta lists patients and appointments -> MUST see ONLY Beta records
      const betaPatients = await apiRequest(ctx.baseUrl, '/api/patients', { token: familyBeta.token });
      assert.strictEqual(betaPatients.status, 200);
      assert.ok(betaPatients.body.every((p: any) => p.family_id === familyBeta.id));
      assert.ok(!betaPatients.body.some((p: any) => p.name.includes('Alpha')));

      const betaAppts = await apiRequest(ctx.baseUrl, '/api/appointments', { token: familyBeta.token });
      assert.strictEqual(betaAppts.status, 200);
      assert.strictEqual(betaAppts.body.length, 0, 'Beta must have 0 appointments');

      // 6. Alpha updates Carlos and deletes Sofia
      const updateCarlos = await apiRequest(ctx.baseUrl, `/api/patients/${pCarlos.body.id}`, {
        method: 'PUT',
        token: familyAlpha.token,
        json: { name: 'Carlos Eduardo Alpha', relationship: 'Hijo Mayor', color: '#2563eb' },
      });
      assert.strictEqual(updateCarlos.status, 200);
      assert.strictEqual(updateCarlos.body.name, 'Carlos Eduardo Alpha');

      const deleteSofia = await apiRequest(ctx.baseUrl, `/api/patients/${pSofia.body.id}`, {
        method: 'DELETE',
        token: familyAlpha.token,
      });
      assert.strictEqual(deleteSofia.status, 200);

      // 7. Verify Beta remains 100% intact
      const betaCheck = await apiRequest(ctx.baseUrl, '/api/patients', { token: familyBeta.token });
      assert.ok(betaCheck.body.some((p: any) => p.id === pMateo.body.id));
    });

    // T4.2: Medical Order Draft, Review, Batch Confirmation & Appointment Linking Workflow
    await test('T4.2: End-to-End Medical Order Review, Confirmation, and Appointment Linking', async () => {
      const fam = await createTestFamily({ code: 'orders_workflow_fam' });

      // 1. Schedule initial doctor consultation
      const appt1 = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.papaId,
          title: 'Consulta Neurología Inicial',
          date_time: '2026-10-01T09:00:00Z',
          specialist: 'Dr. Roberto Mendoza',
          specialty: 'Neurología',
        },
      });
      assert.strictEqual(appt1.status, 200);
      const appt1Id = appt1.body.id;

      // 2. Doctor prescribes orders -> Confirmed via batch review
      const confirmBatch = await apiRequest(ctx.baseUrl, '/api/medical-orders/confirm-batch', {
        method: 'POST',
        token: fam.token,
        json: {
          orders: [
            {
              appointment_id: appt1Id,
              patient_id: fam.papaId,
              order_type: 'examen',
              title: 'Resonancia Magnética Cerebral',
              description: 'Con contraste gadolinio',
            },
            {
              appointment_id: appt1Id,
              patient_id: fam.papaId,
              order_type: 'laboratorio',
              title: 'Cuadro Hemático y Química Sanguínea',
              description: 'Ayuno estricto',
            },
          ],
        },
      });
      assert.strictEqual(confirmBatch.status, 200);
      assert.strictEqual(confirmBatch.body.orders.length, 2);
      const orderResonancia = confirmBatch.body.orders[0];
      const orderSangre = confirmBatch.body.orders[1];

      // 3. Verify pending orders list
      const pendingList = await apiRequest(ctx.baseUrl, '/api/medical-orders/pending', { token: fam.token });
      assert.strictEqual(pendingList.status, 200);
      assert.strictEqual(pendingList.body.length, 2);

      // 4. Schedule second appointment specifically for the Resonancia Magnética
      const appt2 = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.papaId,
          title: 'Toma de Resonancia Magnética Cerebral',
          appointment_type: 'examen',
          date_time: '2026-10-20T14:00:00Z',
          location: 'Imágenes Diagnósticas Torre Médica',
        },
      });
      assert.strictEqual(appt2.status, 200);
      const appt2Id = appt2.body.id;

      // 5. Link Resonancia order to scheduled appointment (status -> 'agendada')
      const updateOrder = await apiRequest(ctx.baseUrl, `/api/medical-orders/${orderResonancia.id}`, {
        method: 'PUT',
        token: fam.token,
        json: {
          status: 'agendada',
          linked_appointment_id: appt2Id,
        },
      });
      assert.strictEqual(updateOrder.status, 200);
      assert.strictEqual(updateOrder.body.status, 'agendada');

      // 6. Complete the examination -> Upload exam result linking to appointment and complete
      const filename = `mri-result-${Date.now()}.pdf`;
      writeTestFile(filename, '%PDF-1.4 MRI RESULT NORMAL');

      const examId = `exam-mri-${Date.now()}`;
      db.prepare(`
        INSERT INTO exam_results (id, family_id, patient_id, appointment_id, title, file_url, file_type, summary_ai)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run([examId, fam.id, fam.papaId, appt2Id, 'Resultado Resonancia', `/api/uploads/${filename}`, 'pdf', 'Sin hallazgos patológicos']);

      // Update order to 'completada'
      const completeOrder = await apiRequest(ctx.baseUrl, `/api/medical-orders/${orderResonancia.id}`, {
        method: 'PUT',
        token: fam.token,
        json: { status: 'completada' },
      });
      assert.strictEqual(completeOrder.status, 200);
      assert.strictEqual(completeOrder.body.status, 'completada');

      // 7. Verify pending list now only has 1 order remaining (orderSangre)
      const finalPending = await apiRequest(ctx.baseUrl, '/api/medical-orders/pending', { token: fam.token });
      assert.strictEqual(finalPending.body.length, 1);
      assert.strictEqual(finalPending.body[0].id, orderSangre.id);
    });

    // T4.3: Appointment Scheduling & Web Push Notification Flow
    await test('T4.3: Appointment Lifecycle, Push Notification Trigger, and Notes Aggregation', async () => {
      const fam = await createTestFamily({ code: 'push_workflow_fam' });

      // 1. Subscribe to Web Push
      const pushSub = await apiRequest(ctx.baseUrl, '/api/push/subscribe', {
        method: 'POST',
        token: fam.token,
        json: {
          subscription: {
            endpoint: `https://fcm.googleapis.com/fcm/send/flow-test-${Date.now()}`,
            keys: { p256dh: 'mock-p256dh', auth: 'mock-auth' },
          },
        },
      });
      assert.strictEqual(pushSub.status, 200);

      // 2. Create complex appointment
      const apptRes = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: fam.token,
        json: {
          patient_id: fam.mamaId,
          title: 'Endoscopia Digestiva Alta',
          appointment_type: 'procedimiento',
          specialist: 'Dra. Patricia Ortiz',
          specialty: 'Gastroenterología',
          location: 'Hospital Universitario Sede Norte',
          date_time: '2026-11-28T07:30:00Z',
          requires_fasting: 1,
          prep_instructions: 'Ayuno total de 12 horas. Asistir con acompañante adulto.',
        },
      });
      assert.strictEqual(apptRes.status, 200);
      const apptId = apptRes.body.id;

      // 3. Update appointment with post-procedure doctor notes
      const updateNotes = await apiRequest(ctx.baseUrl, `/api/appointments/${apptId}`, {
        method: 'PUT',
        token: fam.token,
        json: {
          status: 'completada',
          doctor_notes: 'Procedimiento exitoso sin complicaciones. Dieta blanda por 48 horas.',
        },
      });
      assert.strictEqual(updateNotes.status, 200);

      // 4. Verify aggregated appointment retrieval
      const getAppts = await apiRequest(ctx.baseUrl, '/api/appointments', { token: fam.token });
      const found = getAppts.body.find((a: any) => a.id === apptId);
      assert.ok(found);
      assert.strictEqual(found.status, 'completada');
      assert.strictEqual(found.requires_fasting, 1);
      assert.strictEqual(found.doctor_notes, 'Procedimiento exitoso sin complicaciones. Dieta blanda por 48 horas.');
    });

    // T4.4: Superadmin SaaS Plan Quota Enforcement & Management
    await test('T4.4: Superadmin SaaS Plan Tiering, AI Usage Quota Tracking, and Reset Operations', async () => {
      const fam = await createTestFamily({ code: 'saas_quota_fam', plan_type: 'gratuito', max_daily_whatsapp_queries: 5 });
      const adminToken = getAdminToken();

      // 1. Superadmin checks dashboard
      const dash = await apiRequest(ctx.baseUrl, '/api/admin/families', { token: adminToken });
      assert.strictEqual(dash.status, 200);
      const target = dash.body.families.find((f: any) => f.id === fam.id);
      assert.ok(target);
      assert.strictEqual(target.plan_type, 'gratuito');
      assert.strictEqual(target.max_daily_whatsapp_queries, 5);

      // 2. Superadmin upgrades family to 'pago' with 50 daily queries limit
      const upgrade = await apiRequest(ctx.baseUrl, `/api/admin/families/${fam.id}/plan`, {
        method: 'PATCH',
        token: adminToken,
        json: {
          plan_type: 'pago',
          max_daily_whatsapp_queries: 50,
          subscription_status: 'active',
        },
      });
      assert.strictEqual(upgrade.status, 200);
      assert.strictEqual(upgrade.body.family.plan_type, 'pago');
      assert.strictEqual(upgrade.body.family.max_daily_whatsapp_queries, 50);

      // 3. Simulate usage counter records
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO whatsapp_ai_usage (id, family_id, request_date, request_count)
        VALUES (?, ?, ?, 48)
      `).run([`${fam.id}-${today}`, fam.id, today]);

      // 4. Verify usage in admin
      const dashWithUsage = await apiRequest(ctx.baseUrl, '/api/admin/families', { token: adminToken });
      const updatedFam = dashWithUsage.body.families.find((f: any) => f.id === fam.id);
      assert.strictEqual(updatedFam.queries_used_today, 48);

      // 5. Superadmin resets today's usage counter
      const reset = await apiRequest(ctx.baseUrl, `/api/admin/families/${fam.id}/reset-usage`, {
        method: 'POST',
        token: adminToken,
      });
      assert.strictEqual(reset.status, 200);

      // 6. Verify counter is 0
      const dashAfterReset = await apiRequest(ctx.baseUrl, '/api/admin/families', { token: adminToken });
      const resetFam = dashAfterReset.body.families.find((f: any) => f.id === fam.id);
      assert.strictEqual(resetFam.queries_used_today, 0);
    });

  } finally {
    await ctx.close();
  }

  console.log(`\nTier 4 Finished: ${passed}/${total} passed (${failed} failed).\n`);
  return { total, passed, failed, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTier4Tests()
    .then((r) => process.exit(r.failed > 0 ? 1 : 0))
    .catch((err) => {
      console.error('Fatal in Tier 4:', err);
      process.exit(1);
    });
}
