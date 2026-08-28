import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import db, { recordStagingUpload } from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { secureUpload, validateUploadedFiles } from '../middleware/upload.js';
import { aiRateLimiter } from '../middleware/rateLimiter.js';
import { validateBody, validateParams, validateQuery, v } from '../middleware/validation.js';
import { summarizeExamResult } from '../services/gemini.js';

const router = Router();
router.use(authMiddleware);

// List exam results
router.get(
  '/',
  validateQuery({
    patient_id: v.string({ min: 1, max: 50, optional: true }),
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { patient_id } = req.query;

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
  }),
  async (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { patient_id, appointment_id, title } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo de examen.' });
      }

      // Verify patient ownership
      const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND family_id = ?').get(patient_id, familyId);
      if (!patient) {
        if (req.file && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(403).json({ error: 'El paciente no pertenece a su grupo familiar.' });
      }

      // If appointment_id is supplied, verify appointment ownership
      let validAppointmentId: string | null = null;
      if (appointment_id && typeof appointment_id === 'string' && appointment_id.trim()) {
        const appt = db.prepare('SELECT id FROM appointments WHERE id = ? AND family_id = ?').get(appointment_id, familyId);
        if (!appt) {
          if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
          }
          return res.status(403).json({ error: 'La cita asociada no pertenece a su grupo familiar.' });
        }
        validAppointmentId = appointment_id;
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

      db.prepare(`
        INSERT INTO exam_results (id, family_id, patient_id, appointment_id, title, file_url, file_type, summary_ai)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run([
        id,
        familyId,
        patient_id,
        validAppointmentId,
        cleanTitle,
        fileUrl,
        fileType,
        summaryAi
      ]);

      const examResult = db.prepare('SELECT * FROM exam_results WHERE id = ? AND family_id = ?').get(id, familyId);

      // If linked to appointment, update appointment status to 'completada' (ensuring family_id scoping)
      if (validAppointmentId) {
        db.prepare("UPDATE appointments SET status = 'completada' WHERE id = ? AND family_id = ?").run(validAppointmentId, familyId);
      }

      return res.json(examResult);
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      console.error('Error subiendo resultado de examen:', error);
      return res.status(500).json({ error: 'Error procesando el resultado del examen.' });
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

export default router;


