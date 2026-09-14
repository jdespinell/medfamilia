import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import db, { recordStagingUpload } from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { secureUpload, validateUploadedFiles } from '../middleware/upload.js';
import { aiRateLimiter } from '../middleware/rateLimiter.js';
import { validateBody, validateParams, validateQuery, validateRequest, v } from '../middleware/validation.js';
import { summarizeExamResult } from '../services/gemini.js';

const router = Router();
router.use(authMiddleware);

// List exam results
router.get(
  '/',
  validateQuery({
    patient_id: v.string({ min: 1, max: 50, optional: true }),
    specialty: v.string({ min: 1, max: 100, optional: true }),
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { patient_id, specialty } = req.query;

      let query = `
        SELECT e.*, p.name as patient_name, p.color as patient_color
        FROM exam_results e
        JOIN patients p ON e.patient_id = p.id
        WHERE e.family_id = ? AND p.family_id = ?
      `;
      const params: any[] = [familyId, familyId];

      if (patient_id && typeof patient_id === 'string' && patient_id !== 'all') {
        query += ` AND e.patient_id = ?`;
        params.push(patient_id);
      }

      if (specialty && typeof specialty === 'string' && specialty !== 'all') {
        query += ` AND e.specialty = ?`;
        params.push(specialty);
      }

      query += ` ORDER BY e.created_at DESC`;

      const exams = db.prepare(query).all(params) as any[];
      return res.json(exams);
    } catch (error) {
      console.error('Error consultando exámenes:', error);
      return res.status(500).json({ error: 'Error al consultar resultados de exámenes.' });
    }
  }
);

// Upload and analyze exam result with Gemini AI
router.post(
  '/upload',
  aiRateLimiter,
  secureUpload.single('file'),
  validateUploadedFiles,
  validateBody({
    patient_id: v.uuid(),
    title: v.string({ min: 1, max: 200 }),
    appointment_id: v.uuid({ optional: true }),
    specialty: v.string({ min: 1, max: 100, optional: true }),
    notes: v.string({ min: 1, max: 2000, optional: true }),
    exam_date: v.string({ min: 1, max: 64, optional: true }),
  }),
  async (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { patient_id, appointment_id, title, specialty, notes, exam_date } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo de examen.' });
      }

      // Verify patient ownership
      const patient = db.prepare('SELECT id, name FROM patients WHERE id = ? AND family_id = ?').get(patient_id, familyId) as any;
      if (!patient) {
        if (req.file && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(403).json({ error: 'El paciente no pertenece a su grupo familiar.' });
      }

      // If appointment_id is supplied, verify appointment ownership
      let validExamAppointmentId: string | null = null;
      if (appointment_id && typeof appointment_id === 'string' && appointment_id.trim()) {
        const appt = db.prepare('SELECT id, appointment_type FROM appointments WHERE id = ? AND family_id = ?').get(appointment_id, familyId) as any;
        if (!appt) {
          if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
          }
          return res.status(403).json({ error: 'La cita asociada no pertenece a su grupo familiar.' });
        }
        validExamAppointmentId = appointment_id;
      }

      const filePath = req.file.path;
      const mimeType = req.file.mimetype;
      const safeFilename = path.basename(req.file.filename);
      const fileUrl = `/api/uploads/${safeFilename}`;
      const fileType = mimeType.includes('pdf') ? 'pdf' : 'image';

      // Record upload in staging table linked to familyId
      recordStagingUpload(familyId, safeFilename);

      // Summarize using Gemini AI
      let summaryAi = 'No se generó resumen automático.';
      try {
        summaryAi = await summarizeExamResult(filePath, mimeType);
      } catch (aiErr: any) {
        console.error('Error generando resumen de examen con Gemini:', aiErr);
        summaryAi = 'Nota: No se pudo conectar con el servicio de IA para generar el resumen automático. Sin embargo, el archivo se ha guardado correctamente.';
      }

      const id = uuidv4();
      const cleanTitle = title.trim();
      const cleanSpecialty = specialty && typeof specialty === 'string' ? specialty.trim() : null;
      const cleanNotes = notes && typeof notes === 'string' ? notes.trim() : null;

      // Determine exam date: use provided exam_date, else use now
      const effectiveExamDate = exam_date && typeof exam_date === 'string' ? exam_date.trim() : new Date().toISOString();

      // Ensure columns exist just in case
      try { db.exec('ALTER TABLE exam_results ADD COLUMN exam_appointment_id TEXT;'); } catch(e) {}
      try { db.exec('ALTER TABLE exam_results ADD COLUMN specialty TEXT;'); } catch(e) {}
      try { db.exec('ALTER TABLE exam_results ADD COLUMN notes TEXT;'); } catch(e) {}
      try { db.exec('ALTER TABLE exam_results ADD COLUMN exam_date TEXT;'); } catch(e) {}

      // If no exam appointment was provided, create one automatically
      if (!validExamAppointmentId) {
        const autoApptId = uuidv4();
        const autoTitle = `Examen: ${cleanTitle}`;
        db.prepare(`
          INSERT INTO appointments (
            id, family_id, patient_id, title, appointment_type, specialty,
            date_time, requires_fasting, status
          ) VALUES (?, ?, ?, ?, 'examen', ?, ?, 0, 'realizada')
        `).run([
          autoApptId,
          familyId,
          patient_id,
          autoTitle,
          cleanSpecialty,
          effectiveExamDate,
        ]);
        validExamAppointmentId = autoApptId;
      }

      try {
        db.prepare(`
          INSERT INTO exam_results (id, family_id, patient_id, exam_appointment_id, appointment_id, title, file_url, file_type, summary_ai, specialty, notes, exam_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run([
          id,
          familyId,
          patient_id,
          validExamAppointmentId,
          validExamAppointmentId,
          cleanTitle,
          fileUrl,
          fileType,
          summaryAi,
          cleanSpecialty,
          cleanNotes,
          effectiveExamDate,
        ]);
      } catch (insertErr: any) {
        // Fallback for older schemas
        console.warn('Fallback insert into exam_results:', insertErr.message);
        db.prepare(`
          INSERT INTO exam_results (id, family_id, patient_id, appointment_id, title, file_url, file_type, summary_ai)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run([
          id,
          familyId,
          patient_id,
          validExamAppointmentId,
          cleanTitle,
          fileUrl,
          fileType,
          summaryAi,
        ]);
      }

      // Automatically link to appointment in appointment_exam_links
      if (validExamAppointmentId) {
        try {
          db.prepare(`
            INSERT OR IGNORE INTO appointment_exam_links (id, appointment_id, exam_result_id, family_id)
            VALUES (?, ?, ?, ?)
          `).run(uuidv4(), validExamAppointmentId, id, familyId);
        } catch (linkErr) {
          console.warn('Advertencia enlazando resultado con cita:', linkErr);
        }
      }

      const examResult = db.prepare('SELECT e.*, p.name as patient_name, p.color as patient_color FROM exam_results e JOIN patients p ON e.patient_id = p.id WHERE e.id = ? AND e.family_id = ?').get(id, familyId);
      return res.json(examResult);
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      console.error('Error subiendo resultado de examen:', error);
      return res.status(500).json({ error: error?.message || 'Error procesando el resultado del examen.' });
    }
  }
);

// Update exam result (edit title, specialty, notes)
router.put(
  '/:id',
  validateRequest({
    params: { id: v.uuid() },
    body: {
      title: v.string({ min: 1, max: 200, optional: true }),
      specialty: v.string({ min: 1, max: 100, optional: true }),
      notes: v.string({ min: 1, max: 2000, optional: true }),
    },
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id } = req.params;
      const { title, specialty, notes } = req.body;

      const existing = db.prepare('SELECT * FROM exam_results WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      if (!existing) {
        return res.status(404).json({ error: 'Resultado de examen no encontrado o no pertenece a su familia.' });
      }

      db.prepare(`
        UPDATE exam_results SET
          title = ?, specialty = ?, notes = ?
        WHERE id = ? AND family_id = ?
      `).run([
        title && typeof title === 'string' ? title.trim() : existing.title,
        specialty !== undefined ? (typeof specialty === 'string' ? specialty.trim() : null) : existing.specialty,
        notes !== undefined ? (typeof notes === 'string' ? notes.trim() : null) : existing.notes,
        id,
        familyId,
      ]);

      const updated = db.prepare('SELECT e.*, p.name as patient_name, p.color as patient_color FROM exam_results e JOIN patients p ON e.patient_id = p.id WHERE e.id = ? AND e.family_id = ?').get(id, familyId);
      return res.json(updated);
    } catch (error) {
      console.error('Error actualizando resultado de examen:', error);
      return res.status(500).json({ error: 'Error al actualizar el resultado.' });
    }
  }
);

// Delete exam result
router.delete(
  '/:id',
  validateParams({
    id: v.uuid(),
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id } = req.params;

      const existing = db.prepare('SELECT file_url FROM exam_results WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      if (!existing) {
        return res.status(404).json({ error: 'Resultado de examen no encontrado o no pertenece a su familia.' });
      }

      // Clean up appointment_exam_links
      try { db.prepare('DELETE FROM appointment_exam_links WHERE exam_result_id = ? AND family_id = ?').run(id, familyId); } catch(e) {}

      // Delete DB record
      db.prepare('DELETE FROM exam_results WHERE id = ? AND family_id = ?').run(id, familyId);

      // Delete underlying physical file if possible
      if (existing.file_url && existing.file_url.includes('/uploads/')) {
        const filename = path.basename(existing.file_url.split('?')[0]);
        const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
        const targetPath = path.join(uploadsDir, filename);
        if (fs.existsSync(targetPath)) {
          try { fs.unlinkSync(targetPath); } catch (e) {}
        }
        db.prepare('DELETE FROM upload_staging WHERE family_id = ? AND filename = ?').run(familyId, filename);
      }

      return res.json({ message: 'Resultado de examen eliminado correctamente.' });
    } catch (error) {
      console.error('Error eliminando resultado de examen:', error);
      return res.status(500).json({ error: 'Error al eliminar el examen.' });
    }
  }
);

// Link an exam result to a consultation appointment for review
router.post(
  '/:id/link',
  validateRequest({
    params: { id: v.uuid() },
    body: { appointment_id: v.uuid() },
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id } = req.params;
      const { appointment_id } = req.body;

      const exam = db.prepare('SELECT id FROM exam_results WHERE id = ? AND family_id = ?').get(id, familyId);
      if (!exam) return res.status(404).json({ error: 'Resultado no encontrado.' });

      const appt = db.prepare('SELECT id FROM appointments WHERE id = ? AND family_id = ?').get(appointment_id, familyId);
      if (!appt) return res.status(404).json({ error: 'Cita no encontrada.' });

      const linkId = uuidv4();
      try {
        db.prepare('INSERT INTO appointment_exam_links (id, appointment_id, exam_result_id, family_id) VALUES (?, ?, ?, ?)').run(linkId, appointment_id, id, familyId);
      } catch (e: any) {
        if (e.message?.includes('UNIQUE')) {
          return res.json({ message: 'Ya vinculado.' });
        }
        throw e;
      }

      return res.json({ message: 'Resultado vinculado a la cita correctamente.' });
    } catch (error) {
      console.error('Error vinculando resultado a cita:', error);
      return res.status(500).json({ error: 'Error al vincular el resultado.' });
    }
  }
);

// Unlink an exam result from a consultation appointment
router.delete(
  '/:id/link/:appointment_id',
  validateParams({ id: v.uuid(), appointment_id: v.uuid() }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id, appointment_id } = req.params;
      db.prepare('DELETE FROM appointment_exam_links WHERE exam_result_id = ? AND appointment_id = ? AND family_id = ?').run(id, appointment_id, familyId);
      return res.json({ message: 'Vínculo eliminado.' });
    } catch (error) {
      return res.status(500).json({ error: 'Error al desvincular.' });
    }
  }
);

export default router;
