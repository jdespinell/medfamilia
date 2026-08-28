import './envSetup.js';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import {
  startTestServer,
  resetDatabase,
  createTestFamily,
  apiRequest,
  writeTestFile,
  db,
  TestServerContext
} from './testHelper.js';
import { validateMagicBytes } from '../../server/src/middleware/upload.js';
import { isFileOwnedByFamily, recordStagingUpload, cleanupOrphanedStagingFiles } from '../../server/src/database/db.js';
import { TEST_UPLOADS_DIR } from './envSetup.js';

export async function runM2AdversarialStressSuite() {
  console.log('\n============================================================');
  console.log('⚔️  CHALLENGER 2: M2 EMPIRICAL ADVERSARIAL STRESS TEST SUITE');
  console.log('============================================================\n');

  let ctx: TestServerContext;
  let total = 0;
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
    }
  };

  ctx = await startTestServer();

  try {
    resetDatabase();

    // 1. Magic-Byte Unit Validation
    await test('M2.1: Magic Byte validation correctly identifies valid and invalid file headers', () => {
      const tempDir = TEST_UPLOADS_DIR;
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      // JPEG
      const jpegPath = path.join(tempDir, 'valid.jpg');
      fs.writeFileSync(jpegPath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]));
      assert.strictEqual(validateMagicBytes(jpegPath), true, 'Valid JPEG must pass');

      // PNG
      const pngPath = path.join(tempDir, 'valid.png');
      fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
      assert.strictEqual(validateMagicBytes(pngPath), true, 'Valid PNG must pass');

      // PDF
      const pdfPath = path.join(tempDir, 'valid.pdf');
      fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4 Valid PDF file content'));
      assert.strictEqual(validateMagicBytes(pdfPath), true, 'Valid PDF must pass');

      // WebP
      const webpPath = path.join(tempDir, 'valid.webp');
      const webpBuf = Buffer.alloc(16);
      webpBuf.write('RIFF', 0, 'ascii');
      webpBuf.writeUInt32LE(100, 4);
      webpBuf.write('WEBP', 8, 'ascii');
      fs.writeFileSync(webpPath, webpBuf);
      assert.strictEqual(validateMagicBytes(webpPath), true, 'Valid WebP must pass');

      // HEIC
      const heicPath = path.join(tempDir, 'valid.heic');
      const heicBuf = Buffer.alloc(16);
      heicBuf.writeUInt32BE(0, 0);
      heicBuf.write('ftyp', 4, 'ascii');
      heicBuf.write('heic', 8, 'ascii');
      fs.writeFileSync(heicPath, heicBuf);
      assert.strictEqual(validateMagicBytes(heicPath), true, 'Valid HEIC must pass');

      // Forged Fake File (HTML/Script pretending to be PNG)
      const fakePath = path.join(tempDir, 'fake.png');
      fs.writeFileSync(fakePath, Buffer.from('<script>alert("XSS")</script>'));
      assert.strictEqual(validateMagicBytes(fakePath), false, 'Forged HTML in PNG must fail');

      // Zero-byte / tiny file
      const emptyPath = path.join(tempDir, 'empty.pdf');
      fs.writeFileSync(emptyPath, Buffer.from('ab'));
      assert.strictEqual(validateMagicBytes(emptyPath), false, 'File smaller than 4 bytes must fail');
    });

    // 2. Upload Staging Tracking & Access Control
    await test('M2.2: Upload staging records ownership and permits access only to uploading family', async () => {
      const familyA = await createTestFamily({ code: 'fam_stage_a' });
      const familyB = await createTestFamily({ code: 'fam_stage_b' });

      const stagingFile = `staged-draft-${Date.now()}.pdf`;
      writeTestFile(stagingFile, '%PDF-1.4 STAGED DRAFT FOR FAMILY A');

      // Record in staging for Family A
      recordStagingUpload(familyA.id, stagingFile);

      // Family A should be able to access the unconfirmed staging file
      const accessA = await apiRequest(ctx.baseUrl, `/api/uploads/${stagingFile}`, { token: familyA.token });
      assert.strictEqual(accessA.status, 200, 'Uploading family must have access to their staging file');

      // Family B must be denied with 403 Forbidden
      const accessB = await apiRequest(ctx.baseUrl, `/api/uploads/${stagingFile}`, { token: familyB.token });
      assert.strictEqual(accessB.status, 403, 'Other families must NOT have access to staging files');
    });

    // 3. Batch Order Confirmation File Hijacking Prevention
    await test('M2.3: Confirm-batch strictly rejects unowned / cross-tenant file URLs with 403', async () => {
      const familyA = await createTestFamily({ code: 'fam_confirm_a' });
      const familyB = await createTestFamily({ code: 'fam_confirm_b' });

      const victimFile = `confidential-order-${Date.now()}.pdf`;
      writeTestFile(victimFile, '%PDF-1.4 CONFIDENTIAL ORDER FAMILY A');
      recordStagingUpload(familyA.id, victimFile);

      // Family B attempts to hijack Family A's file in confirm-batch
      const apptB = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: familyB.token,
        json: { patient_id: familyB.papaId, title: 'Cita B', date_time: '2026-12-01T10:00:00Z' },
      });

      const hijackRes = await apiRequest(ctx.baseUrl, '/api/medical-orders/confirm-batch', {
        method: 'POST',
        token: familyB.token,
        json: {
          orders: [
            {
              appointment_id: apptB.body.id,
              patient_id: familyB.papaId,
              order_type: 'examen',
              title: 'Attempted Hijack',
              file_url: `/api/uploads/${victimFile}`,
            },
          ],
        },
      });

      assert.strictEqual(hijackRes.status, 403, 'Confirm batch with unowned file must return 403');

      // Verify no order was inserted with victimFile under Family B
      const checkOrder = db.prepare('SELECT id FROM medical_orders WHERE family_id = ? AND file_url LIKE ?').get(familyB.id, `%${victimFile}`);
      assert.strictEqual(checkOrder, undefined, 'No order must be created for Family B with victim file');
    });

    // 4. Appointment photo_url Cross-Tenant Hijacking Prevention
    await test('M2.4: Appointment creation and update reject unowned photo_url with 403', async () => {
      const familyA = await createTestFamily({ code: 'fam_appt_a' });
      const familyB = await createTestFamily({ code: 'fam_appt_b' });

      const victimPhoto = `photo-victim-${Date.now()}.jpg`;
      writeTestFile(victimPhoto, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]));
      recordStagingUpload(familyA.id, victimPhoto);

      // Family B creates appointment referencing Family A's photo
      const createRes = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: familyB.token,
        json: {
          patient_id: familyB.papaId,
          title: 'Cita Attacker',
          date_time: '2026-12-05T14:00:00Z',
          photo_url: `/api/uploads/${victimPhoto}`,
        },
      });
      assert.strictEqual(createRes.status, 403, 'Appointment create with unowned photo must return 403');

      // Family B legitimate appointment
      const legitimateAppt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: familyB.token,
        json: {
          patient_id: familyB.papaId,
          title: 'Cita Legitima B',
          date_time: '2026-12-05T15:00:00Z',
        },
      });
      assert.strictEqual(legitimateAppt.status, 200);

      // Family B updates appointment to hijack Family A's photo
      const updateRes = await apiRequest(ctx.baseUrl, `/api/appointments/${legitimateAppt.body.id}`, {
        method: 'PUT',
        token: familyB.token,
        json: {
          photo_url: `/api/uploads/${victimPhoto}`,
        },
      });
      assert.strictEqual(updateRes.status, 403, 'Appointment update with unowned photo must return 403');
    });

    // 5. Staging Cleanup Routine
    await test('M2.5: Cleanup routine purges unlinked staging entries and physical files older than 24h', async () => {
      const fam = await createTestFamily({ code: 'fam_cleanup_test' });
      const familyA = fam.id;
      const oldFilename = `old-unlinked-${Date.now()}.pdf`;
      const oldFilePath = path.join(TEST_UPLOADS_DIR, oldFilename);
      fs.writeFileSync(oldFilePath, '%PDF-1.4 OLD UNLINKED FILE');

      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
      db.prepare('INSERT INTO upload_staging (id, family_id, filename, created_at) VALUES (?, ?, ?, ?)').run(
        'staging-old-id', familyA, oldFilename, oldDate
      );

      // Fresh staging file (should NOT be purged)
      const freshFilename = `fresh-staging-${Date.now()}.pdf`;
      const freshFilePath = path.join(TEST_UPLOADS_DIR, freshFilename);
      fs.writeFileSync(freshFilePath, '%PDF-1.4 FRESH STAGING FILE');
      recordStagingUpload(familyA, freshFilename);

      // Run cleanup
      cleanupOrphanedStagingFiles(TEST_UPLOADS_DIR);

      // Old unlinked file should be deleted from disk and DB
      assert.strictEqual(fs.existsSync(oldFilePath), false, 'Old unlinked file should be removed from disk');
      const oldDbCheck = db.prepare('SELECT id FROM upload_staging WHERE id = ?').get('staging-old-id');
      assert.strictEqual(oldDbCheck, undefined, 'Old staging record should be removed from DB');

      // Fresh file should remain intact
      assert.strictEqual(fs.existsSync(freshFilePath), true, 'Fresh staging file must remain on disk');
      const freshDbCheck = db.prepare('SELECT id FROM upload_staging WHERE filename = ?').get(freshFilename);
      assert.ok(freshDbCheck, 'Fresh staging record must remain in DB');
    });


    // 6. Elimination of isRecent Grace Window
    await test('M2.6: Zero temporal grace window: recently created unowned file returns 403 immediately', async () => {
      const familyA = await createTestFamily({ code: 'fam_zero_a' });
      const familyB = await createTestFamily({ code: 'fam_zero_b' });

      // Physical file written 1 second ago
      const recentFilename = `just-uploaded-${Date.now()}.pdf`;
      writeTestFile(recentFilename, '%PDF-1.4 JUST UPLOADED 1 SECOND AGO');
      recordStagingUpload(familyA.id, recentFilename);

      // Family B immediately queries
      const resB = await apiRequest(ctx.baseUrl, `/api/uploads/${recentFilename}`, { token: familyB.token });
      assert.strictEqual(resB.status, 403, 'Recent file must NOT allow cross-tenant access even for 1 second');
    });

  } finally {
    await ctx.close();
  }

  console.log(`\nM2 Adversarial Stress Suite Finished: ${passed}/${total} passed (${failed} failed).\n`);
  return { total, passed, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runM2AdversarialStressSuite()
    .then((r) => process.exit(r.failed > 0 ? 1 : 0))
    .catch((err) => {
      console.error('Fatal error in M2 stress suite:', err);
      process.exit(1);
    });
}
