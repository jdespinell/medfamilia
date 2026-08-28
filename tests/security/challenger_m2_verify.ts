import './envSetup.js';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  startTestServer,
  resetDatabase,
  createTestFamily,
  apiRequest,
  writeTestFile,
  cleanTestFiles,
  db,
  TestServerContext
} from './testHelper.js';
import { validateMagicBytes } from '../../server/src/middleware/upload.js';
import { isFileOwnedByFamily, recordStagingUpload, cleanupOrphanedStagingFiles } from '../../server/src/database/db.js';
import { TEST_UPLOADS_DIR } from './envSetup.js';

// Ensure Gemini key is present for mock AI calls
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'mock-test-gemini-api-key-2026';

export async function runChallengerM2VerificationSuite() {
  console.log('\n================================================================');
  console.log('🛡️  CHALLENGER 2: EMPIRICAL VERIFICATION & STRESS TEST SUITE (M2)');
  console.log('    Magic-Byte Validation, MIME Spoofing & Temp File Cleanup');
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

  // Helper generators for authentic binary signatures
  const createValidJpeg = (extraBytes = 100) => {
    return Buffer.concat([
      Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]),
      Buffer.alloc(extraBytes, 0xAA)
    ]);
  };

  const createValidPng = (extraBytes = 100) => {
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      Buffer.alloc(extraBytes, 0xBB)
    ]);
  };

  const createValidPdf = (extraBytes = 100) => {
    return Buffer.concat([
      Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
      Buffer.alloc(extraBytes, 0xCC)
    ]);
  };

  const createValidWebp = (extraBytes = 100) => {
    const totalSize = 12 + extraBytes;
    const buf = Buffer.alloc(12 + extraBytes);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(totalSize - 8, 4);
    buf.write('WEBP', 8, 'ascii');
    buf.fill(0xDD, 12);
    return buf;
  };

  const createValidHeic = (brand = 'heic', extraBytes = 100) => {
    const buf = Buffer.alloc(12 + extraBytes);
    buf.writeUInt32BE(12 + extraBytes, 0);
    buf.write('ftyp', 4, 'ascii');
    buf.write(brand, 8, 'ascii');
    buf.fill(0xEE, 12);
    return buf;
  };

  ctx = await startTestServer();

  try {
    cleanTestFiles();
    resetDatabase();

    // =========================================================================
    // SUITE 1: Direct Magic-Byte Header Stress Engine (Unit Level)
    // =========================================================================
    console.log('\n--- SUITE 1: Magic Byte Engine Signature Verification ---');

    await test('1.1: Authentic signatures (JPEG, PNG, PDF, WebP, HEIC/AVIF) pass validation', () => {
      const pJpg = path.join(TEST_UPLOADS_DIR, 'test-auth.jpg');
      fs.writeFileSync(pJpg, createValidJpeg());
      assert.strictEqual(validateMagicBytes(pJpg), true, 'JPEG should pass');

      const pPng = path.join(TEST_UPLOADS_DIR, 'test-auth.png');
      fs.writeFileSync(pPng, createValidPng());
      assert.strictEqual(validateMagicBytes(pPng), true, 'PNG should pass');

      const pPdf = path.join(TEST_UPLOADS_DIR, 'test-auth.pdf');
      fs.writeFileSync(pPdf, createValidPdf());
      assert.strictEqual(validateMagicBytes(pPdf), true, 'PDF should pass');

      const pWebp = path.join(TEST_UPLOADS_DIR, 'test-auth.webp');
      fs.writeFileSync(pWebp, createValidWebp());
      assert.strictEqual(validateMagicBytes(pWebp), true, 'WebP should pass');

      for (const brand of ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'mp42', 'isom']) {
        const pHeic = path.join(TEST_UPLOADS_DIR, `test-${brand}.heic`);
        fs.writeFileSync(pHeic, createValidHeic(brand));
        assert.strictEqual(validateMagicBytes(pHeic), true, `Brand ${brand} should pass`);
        fs.unlinkSync(pHeic);
      }

      // Cleanup
      fs.unlinkSync(pJpg);
      fs.unlinkSync(pPng);
      fs.unlinkSync(pPdf);
      fs.unlinkSync(pWebp);
    });

    await test('1.2: Adversarial malicious payloads (PE, ELF, PHP, Shell, XSS, Zip, SVG) fail validation', () => {
      const testCases: Array<{ name: string; ext: string; buffer: Buffer }> = [
        { name: 'Windows PE Executable', ext: '.png', buffer: Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]) },
        { name: 'Linux ELF Executable', ext: '.pdf', buffer: Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]) },
        { name: 'PHP Webshell Script', ext: '.jpg', buffer: Buffer.from('<?php system($_GET["cmd"]); ?>') },
        { name: 'Bash Script Executable', ext: '.webp', buffer: Buffer.from('#!/bin/bash\nrm -rf /') },
        { name: 'HTML / XSS Payload', ext: '.pdf', buffer: Buffer.from('<script>alert("XSS")</script>') },
        { name: 'SVG with embedded JavaScript', ext: '.png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') },
        { name: 'ZIP Archive', ext: '.jpg', buffer: Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]) },
        { name: 'WAV Audio disguised as WebP', ext: '.webp', buffer: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]) },
        { name: 'MP4 Video disguised as HEIC', ext: '.heic', buffer: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypmp41')]) },
        { name: 'Zero-byte empty file', ext: '.png', buffer: Buffer.alloc(0) },
        { name: 'Single byte file', ext: '.pdf', buffer: Buffer.from([0xFF]) },
        { name: 'Truncated 3-byte file', ext: '.jpg', buffer: Buffer.from([0xFF, 0xD8, 0x00]) },
        { name: 'Truncated WebP (8 bytes)', ext: '.webp', buffer: Buffer.from('RIFF\x00\x00\x00\x00') }
      ];

      for (const tc of testCases) {
        const fPath = path.join(TEST_UPLOADS_DIR, `adv-${Date.now()}-${tc.ext}`);
        fs.writeFileSync(fPath, tc.buffer);
        const isValid = validateMagicBytes(fPath);
        assert.strictEqual(isValid, false, `Adversarial test [${tc.name}] must fail magic-byte validation`);
        if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
      }
    });

    await test('1.3: Non-existent file returns false safely without throwing', () => {
      const nonExistent = path.join(TEST_UPLOADS_DIR, 'non-existent-file-xyz.png');
      assert.strictEqual(validateMagicBytes(nonExistent), false);
    });

    // =========================================================================
    // SUITE 2: HTTP Endpoint MIME Spoofing & Immediate Unlink Verification
    // =========================================================================
    console.log('\n--- SUITE 2: HTTP Route MIME Spoofing & Immediate File Unlink ---');

    const family = await createTestFamily({ code: 'fam_challenger2_test' });

    await test('2.1: POST /api/appointments/ai-photo rejects spoofed script disguised as PNG with 400 and immediately unlinks from disk', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      const maliciousScript = Buffer.from('#!/bin/bash\ncat /etc/passwd');
      const res = await apiRequest(ctx.baseUrl, '/api/appointments/ai-photo', {
        method: 'POST',
        token: family.token,
        multipart: {
          files: [
            {
              name: 'photo',
              filename: 'malicious.png',
              buffer: maliciousScript,
              mimeType: 'image/png'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 400, `Expected status 400, got ${res.status}: ${res.text}`);
      assert.ok(res.body?.error && res.body.error.includes('contenido del archivo no es válido'), 'Expected invalid file content message');

      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(afterFiles.length, beforeFiles.length, 'Disguised uploaded file must be immediately deleted from disk');
    });

    await test('2.2: POST /api/exams/upload rejects spoofed PE executable disguised as PDF with 400 and unlinks from disk', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      const peExe = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
      const res = await apiRequest(ctx.baseUrl, '/api/exams/upload', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            title: 'Examen de Sangre Falso'
          },
          files: [
            {
              name: 'file',
              filename: 'trojan.pdf',
              buffer: peExe,
              mimeType: 'application/pdf'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 400, `Expected status 400, got ${res.status}: ${res.text}`);
      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(afterFiles.length, beforeFiles.length, 'Spoofed PDF executable must be immediately unlinked from disk');
    });

    await test('2.3: POST /api/medical-orders/ai-batch with mixed batch (2 valid PNGs + 1 disguised script) rejects entire request and unlinks ALL batch files', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      // Create appointment
      const appt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family.token,
        json: { patient_id: family.papaId, title: 'Cita Batch', date_time: '2026-12-01T09:00:00Z' }
      });
      assert.strictEqual(appt.status, 200);

      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders/ai-batch', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            appointment_id: appt.body.id
          },
          files: [
            { name: 'files', filename: 'valid1.png', buffer: createValidPng(), mimeType: 'image/png' },
            { name: 'files', filename: 'malicious.png', buffer: Buffer.from('<script>alert("hacked")</script>'), mimeType: 'image/png' },
            { name: 'files', filename: 'valid2.png', buffer: createValidPng(), mimeType: 'image/png' }
          ]
        }
      });

      assert.strictEqual(res.status, 400, `Expected 400 for batch containing spoofed file, got ${res.status}`);
      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(afterFiles.length, beforeFiles.length, 'ALL temporary files from failed batch request must be unlinked');
    });

    await test('2.4: POST /api/medical-orders/ai-analyze-draft rejects disguised text file with 400 and immediately unlinks', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      const appt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family.token,
        json: { patient_id: family.papaId, title: 'Cita Draft', date_time: '2026-12-01T11:00:00Z' }
      });

      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders/ai-analyze-draft', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            appointment_id: appt.body.id
          },
          files: [
            {
              name: 'files',
              filename: 'draft.webp',
              buffer: Buffer.from('Just some plain text pretending to be WebP'),
              mimeType: 'image/webp'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 400);
      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(afterFiles.length, beforeFiles.length, 'Spoofed draft file must be unlinked');
    });

    await test('2.5: POST /api/medical-orders/ (manual) rejects spoofed PDF with 400 and unlinks', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      const appt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family.token,
        json: { patient_id: family.papaId, title: 'Cita Manual', date_time: '2026-12-01T12:00:00Z' }
      });

      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            appointment_id: appt.body.id,
            title: 'Orden Spoofed'
          },
          files: [
            {
              name: 'files',
              filename: 'fake_order.pdf',
              buffer: Buffer.from('MZ\x90\x00\x03\x00\x00\x00'),
              mimeType: 'application/pdf'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 400);
      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(afterFiles.length, beforeFiles.length, 'Spoofed manual order file must be unlinked');
    });

    // =========================================================================
    // SUITE 3: Genuine Multi-Format Upload End-to-End Tests
    // =========================================================================
    console.log('\n--- SUITE 3: Genuine Multi-Format Upload End-to-End ---');

    await test('3.1: Authentic JPEG upload to /api/appointments/ai-photo passes validation and registers staging', async () => {
      const jpegBuf = createValidJpeg(200);
      const res = await apiRequest(ctx.baseUrl, '/api/appointments/ai-photo', {
        method: 'POST',
        token: family.token,
        multipart: {
          files: [
            {
              name: 'photo',
              filename: 'legit_order.jpg',
              buffer: jpegBuf,
              mimeType: 'image/jpeg'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert.ok(res.body?.photo_url, 'Expected photo_url in response');

      const filename = path.basename(res.body.photo_url);
      const physicalPath = path.join(TEST_UPLOADS_DIR, filename);
      assert.strictEqual(fs.existsSync(physicalPath), true, 'Physical file must exist on disk');

      const stagingRecord = db.prepare('SELECT id, family_id FROM upload_staging WHERE filename = ?').get(filename) as any;
      assert.ok(stagingRecord, 'Staging record must be created');
      assert.strictEqual(stagingRecord.family_id, family.id, 'Staging record must belong to family');
    });

    await test('3.2: Authentic PNG upload to /api/exams/upload passes validation and creates exam result', async () => {
      const pngBuf = createValidPng(300);
      const res = await apiRequest(ctx.baseUrl, '/api/exams/upload', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            title: 'Radiografía de Tórax'
          },
          files: [
            {
              name: 'file',
              filename: 'xray.png',
              buffer: pngBuf,
              mimeType: 'image/png'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert.strictEqual(res.body?.title, 'Radiografía de Tórax');
      assert.ok(res.body?.file_url, 'Expected file_url in exam result');

      const filename = path.basename(res.body.file_url);
      assert.strictEqual(fs.existsSync(path.join(TEST_UPLOADS_DIR, filename)), true);
    });

    await test('3.3: Authentic PDF upload to /api/medical-orders/ai-batch passes validation and creates order', async () => {
      const appt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family.token,
        json: { patient_id: family.papaId, title: 'Cita PDF Batch', date_time: '2026-12-02T10:00:00Z' }
      });

      const pdfBuf = createValidPdf(500);
      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders/ai-batch', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            appointment_id: appt.body.id
          },
          files: [
            {
              name: 'files',
              filename: 'orden_laboratorio.pdf',
              buffer: pdfBuf,
              mimeType: 'application/pdf'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert.strictEqual(res.body?.success, true);
      assert.ok(Array.isArray(res.body?.orders) && res.body.orders.length > 0);
    });

    await test('3.4: Authentic WebP upload to /api/medical-orders/ai-analyze-draft passes validation and returns draft', async () => {
      const appt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family.token,
        json: { patient_id: family.papaId, title: 'Cita WebP Draft', date_time: '2026-12-02T11:00:00Z' }
      });

      const webpBuf = createValidWebp(200);
      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders/ai-analyze-draft', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            appointment_id: appt.body.id
          },
          files: [
            {
              name: 'files',
              filename: 'receta.webp',
              buffer: webpBuf,
              mimeType: 'image/webp'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert.strictEqual(res.body?.success, true);
      assert.ok(Array.isArray(res.body?.draft_orders) && res.body.draft_orders.length > 0);
    });

    await test('3.5: Authentic HEIC upload to /api/medical-orders (manual) passes validation', async () => {
      const appt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: family.token,
        json: { patient_id: family.papaId, title: 'Cita HEIC Manual', date_time: '2026-12-02T12:00:00Z' }
      });

      const heicBuf = createValidHeic('heic', 400);
      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            appointment_id: appt.body.id,
            title: 'Orden iPhone HEIC'
          },
          files: [
            {
              name: 'files',
              filename: 'photo.heic',
              buffer: heicBuf,
              mimeType: 'image/heic'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert.strictEqual(res.body?.title, 'Orden iPhone HEIC');
    });

    // =========================================================================
    // SUITE 4: Route Error Handling & Temporary File Cleanup Empirical Tests
    // =========================================================================
    console.log('\n--- SUITE 4: Route Error Handling & Temp File Cleanup Verification ---');

    const foreignFamily = await createTestFamily({ code: 'fam_foreign_cleanup' });

    await test('4.1: Missing / invalid patient in /api/exams/upload unlinks uploaded file immediately', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      const res = await apiRequest(ctx.baseUrl, '/api/exams/upload', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: foreignFamily.papaId, // Foreign patient -> 403
            title: 'Examen con Paciente Ajeno'
          },
          files: [
            {
              name: 'file',
              filename: 'clean_up_test.png',
              buffer: createValidPng(),
              mimeType: 'image/png'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 403, `Expected 403 for foreign patient, got ${res.status}`);
      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(afterFiles.length, beforeFiles.length, 'Uploaded file must be unlinked when patient validation fails');
    });

    await test('4.2: Foreign appointment in /api/exams/upload unlinks uploaded file immediately', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      const foreignAppt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: foreignFamily.token,
        json: { patient_id: foreignFamily.papaId, title: 'Cita Foreign', date_time: '2026-12-03T10:00:00Z' }
      });

      const res = await apiRequest(ctx.baseUrl, '/api/exams/upload', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            patient_id: family.papaId,
            appointment_id: foreignAppt.body.id, // Foreign appointment -> 403
            title: 'Examen con Cita Ajena'
          },
          files: [
            {
              name: 'file',
              filename: 'clean_up_foreign_appt.pdf',
              buffer: createValidPdf(),
              mimeType: 'application/pdf'
            }
          ]
        }
      });

      assert.strictEqual(res.status, 403);
      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(afterFiles.length, beforeFiles.length, 'Uploaded file must be unlinked when appointment validation fails');
    });

    await test('4.3: Missing required parameters in /api/medical-orders/ai-batch unlinks all batch files', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      const res = await apiRequest(ctx.baseUrl, '/api/medical-orders/ai-batch', {
        method: 'POST',
        token: family.token,
        multipart: {
          fields: {
            // Missing appointment_id and patient_id -> 400
          },
          files: [
            { name: 'files', filename: 'file1.png', buffer: createValidPng(), mimeType: 'image/png' },
            { name: 'files', filename: 'file2.png', buffer: createValidPng(), mimeType: 'image/png' }
          ]
        }
      });

      assert.strictEqual(res.status, 400);
      const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
      assert.strictEqual(afterFiles.length, beforeFiles.length, 'All batch files must be unlinked when params are missing');
    });

    await test('4.4: Intentional Gemini AI extraction error in /api/appointments/ai-photo triggers catch block and unlinks file', async () => {
      const beforeFiles = fs.readdirSync(TEST_UPLOADS_DIR);

      // Temporarily mock global fetch to fail Gemini API with 500 error
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
          if (url.includes('generativelanguage.googleapis.com')) {
            return new Response(JSON.stringify({ error: { code: 500, message: 'Internal AI Server Crash' } }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return origFetch(input, init);
        };

        const res = await apiRequest(ctx.baseUrl, '/api/appointments/ai-photo', {
          method: 'POST',
          token: family.token,
          multipart: {
            files: [
              {
                name: 'photo',
                filename: 'ai_error_test.jpg',
                buffer: createValidJpeg(),
                mimeType: 'image/jpeg'
              }
            ]
          }
        });

        assert.strictEqual(res.status, 500, `Expected 500 on AI processing crash, got ${res.status}`);
        assert.ok(res.body?.error && res.body.error.includes('Inteligencia Artificial'));

        const afterFiles = fs.readdirSync(TEST_UPLOADS_DIR);
        assert.strictEqual(afterFiles.length, beforeFiles.length, 'Uploaded file must be unlinked upon AI failure in catch block');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    await test('4.5: 24-Hour staging cleanup purges orphaned disk files while preserving confirmed files', async () => {
      const famCleanup = await createTestFamily({ code: 'fam_cleanup_lifecycle' });

      // 1. Orphaned staging file older than 24 hours
      const oldOrphanFilename = `orphan-old-${Date.now()}.pdf`;
      const oldOrphanPath = path.join(TEST_UPLOADS_DIR, oldOrphanFilename);
      fs.writeFileSync(oldOrphanPath, createValidPdf());
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      db.prepare('INSERT INTO upload_staging (id, family_id, filename, created_at) VALUES (?, ?, ?, ?)').run(
        'stage-orphan-old', famCleanup.id, oldOrphanFilename, oldTime
      );

      // 2. Confirmed file older than 24 hours (linked in exam_results)
      const oldConfirmedFilename = `confirmed-old-${Date.now()}.pdf`;
      const oldConfirmedPath = path.join(TEST_UPLOADS_DIR, oldConfirmedFilename);
      fs.writeFileSync(oldConfirmedPath, createValidPdf());
      db.prepare('INSERT INTO upload_staging (id, family_id, filename, created_at) VALUES (?, ?, ?, ?)').run(
        'stage-confirmed-old', famCleanup.id, oldConfirmedFilename, oldTime
      );
      db.prepare(`
        INSERT INTO exam_results (id, family_id, patient_id, title, file_url, file_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('exam-confirmed-id', famCleanup.id, famCleanup.papaId, 'Examen Confirmado', `/api/uploads/${oldConfirmedFilename}`, 'pdf', oldTime);

      // 3. Fresh staging file (<24 hours old)
      const freshFilename = `fresh-draft-${Date.now()}.pdf`;
      const freshPath = path.join(TEST_UPLOADS_DIR, freshFilename);
      fs.writeFileSync(freshPath, createValidPdf());
      recordStagingUpload(famCleanup.id, freshFilename);

      // Execute cleanup
      cleanupOrphanedStagingFiles(TEST_UPLOADS_DIR);

      // 1. Orphaned old file should be deleted from disk and DB
      assert.strictEqual(fs.existsSync(oldOrphanPath), false, 'Orphaned staging file older than 24h must be deleted from disk');
      const orphanDb = db.prepare('SELECT id FROM upload_staging WHERE id = ?').get('stage-orphan-old');
      assert.strictEqual(orphanDb, undefined, 'Orphaned staging record must be deleted from DB');

      // 2. Confirmed old file must NOT be deleted from disk
      assert.strictEqual(fs.existsSync(oldConfirmedPath), true, 'Confirmed old file must remain on disk');

      // 3. Fresh staging file must NOT be deleted from disk or DB
      assert.strictEqual(fs.existsSync(freshPath), true, 'Fresh staging file must remain on disk');
      const freshDb = db.prepare('SELECT id FROM upload_staging WHERE filename = ?').get(freshFilename);
      assert.ok(freshDb, 'Fresh staging record must remain in DB');
    });

    // =========================================================================
    // SUITE 5: Multi-Tenant File Authorization & Anti-Hijacking Verification
    // =========================================================================
    console.log('\n--- SUITE 5: Multi-Tenant File Authorization & Anti-Hijacking ---');

    await test('5.1: Zero temporal grace window: recently created file returns 403 to foreign family immediately', async () => {
      const famA = await createTestFamily({ code: 'fam_auth_zero_a' });
      const famB = await createTestFamily({ code: 'fam_auth_zero_b' });

      const stagedName = `tenant-a-draft-${Date.now()}.png`;
      writeTestFile(stagedName, createValidPng());
      recordStagingUpload(famA.id, stagedName);

      // Family A can access
      const resA = await apiRequest(ctx.baseUrl, `/api/uploads/${stagedName}`, { token: famA.token });
      assert.strictEqual(resA.status, 200);

      // Family B is blocked with 403 Forbidden
      const resB = await apiRequest(ctx.baseUrl, `/api/uploads/${stagedName}`, { token: famB.token });
      assert.strictEqual(resB.status, 403, 'Cross-tenant access to freshly uploaded file must return 403 immediately');
      assert.ok(
        (resB.body?.error && resB.body.error.includes('Acceso denegado')) ||
        (resB.body?.error && resB.body.error.includes('grupo familiar')),
        'Expected forbidden tenant error message'
      );
    });

    await test('5.2: Batch order confirmation rejects foreign / unowned file_url with 403', async () => {
      const famA = await createTestFamily({ code: 'fam_hijack_a' });
      const famB = await createTestFamily({ code: 'fam_hijack_b' });

      const fileA = `file-victim-order-${Date.now()}.pdf`;
      writeTestFile(fileA, createValidPdf());
      recordStagingUpload(famA.id, fileA);

      const apptB = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: famB.token,
        json: { patient_id: famB.papaId, title: 'Cita B', date_time: '2026-12-10T10:00:00Z' }
      });

      const hijackRes = await apiRequest(ctx.baseUrl, '/api/medical-orders/confirm-batch', {
        method: 'POST',
        token: famB.token,
        json: {
          orders: [
            {
              appointment_id: apptB.body.id,
              patient_id: famB.papaId,
              order_type: 'examen',
              title: 'Attempted Hijack',
              file_url: `/api/uploads/${fileA}`
            }
          ]
        }
      });

      assert.strictEqual(hijackRes.status, 403, 'Submitting unowned file_url in confirm-batch must return 403');
    });

    await test('5.3: Appointment creation and update reject unowned photo_url with 403', async () => {
      const famA = await createTestFamily({ code: 'fam_appt_hijack_a' });
      const famB = await createTestFamily({ code: 'fam_appt_hijack_b' });

      const photoA = `photo-victim-appt-${Date.now()}.jpg`;
      writeTestFile(photoA, createValidJpeg());
      recordStagingUpload(famA.id, photoA);

      // Create appointment with stolen photo_url
      const createRes = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: famB.token,
        json: {
          patient_id: famB.papaId,
          title: 'Cita Hijacker',
          date_time: '2026-12-10T15:00:00Z',
          photo_url: `/api/uploads/${photoA}`
        }
      });
      assert.strictEqual(createRes.status, 403, 'Creating appointment with unowned photo_url must return 403');

      // Create valid appointment
      const legitAppt = await apiRequest(ctx.baseUrl, '/api/appointments', {
        method: 'POST',
        token: famB.token,
        json: {
          patient_id: famB.papaId,
          title: 'Cita Legitima B',
          date_time: '2026-12-10T16:00:00Z'
        }
      });
      assert.strictEqual(legitAppt.status, 200);

      // Update appointment with stolen photo_url
      const updateRes = await apiRequest(ctx.baseUrl, `/api/appointments/${legitAppt.body.id}`, {
        method: 'PUT',
        token: famB.token,
        json: {
          photo_url: `/api/uploads/${photoA}`
        }
      });
      assert.strictEqual(updateRes.status, 403, 'Updating appointment with unowned photo_url must return 403');
    });

  } finally {
    cleanTestFiles();
    await ctx.close();
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log(`🏁 CHALLENGER 2 VERIFICATION SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error('Failure Details:');
    failureDetails.forEach((f) => {
      console.error(`- ${f.test}: ${f.error}`);
    });
    process.exit(1);
  } else {
    console.log('🎉 ALL EMPIRICAL CHALLENGER TESTS PASSED WITH ZERO ERRORS! 🎉\n');
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runChallengerM2VerificationSuite().catch((err) => {
    console.error('Fatal error in Challenger 2 test suite:', err);
    process.exit(1);
  });
}
