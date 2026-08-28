import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import db, { recordStagingUpload, isFileOwnedByFamily } from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { secureUpload, validateUploadedFiles } from '../middleware/upload.js';
import { aiRateLimiter } from '../middleware/rateLimiter.js';
import { validateBody, validateParams, validateQuery, validateRequest, v } from '../middleware/validation.js';
import { extractAppointmentFromText, extractAppointmentFromFile } from '../services/gemini.js';
import { syncAppointmentToGoogleCalendar } from '../services/googleCalendar.js';
import { sendNotificationToFamily } from '../services/pushNotifications.js';

const router = Router();
router.use(authMiddleware);

// Get list of appointments (including attached results)
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
        SELECT a.*, p.name as patient_name, p.color as patient_color
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.family_id = ? AND p.family_id = ?
      `;
      const params: any[] = [familyId, familyId];

      if (patient_id && typeof patient_id === 'string' && patient_id !== 'all') {
        query += ` AND a.patient_id = ?`;
        params.push(patient_id);
      }

      if (specialty && typeof specialty === 'string' && specialty !== 'all') {
        query += ` AND a.specialty = ?`;
        params.push(specialty);
      }

      query += ` ORDER BY a.date_time ASC`;

      const appointments = db.prepare(query).all(params) as any[];

      // Attach exam results linked to each appointment (isolated by family_id)
      for (const app of appointments) {
        const results = db.prepare('SELECT * FROM exam_results WHERE appointment_id = ? AND family_id = ? ORDER BY created_at DESC').all([app.id, familyId]) as any[];
        app.attached_results = results;

        const orders = db.prepare('SELECT mo.*, p.name as patient_name FROM medical_orders mo JOIN patients p ON mo.patient_id = p.id WHERE mo.appointment_id = ? AND mo.family_id = ? ORDER BY mo.created_at ASC').all([app.id, familyId]) as any[];
        app.medical_orders = orders;

        if (app.origin_order_id) {
          const originOrder = db.prepare('SELECT mo.*, a.title as source_appointment_title FROM medical_orders mo LEFT JOIN appointments a ON mo.appointment_id = a.id WHERE mo.id = ? AND mo.family_id = ?').get([app.origin_order_id, familyId]) as any;
          app.origin_order = originOrder || null;
        }
      }

      return res.json(appointments);
    } catch (error) {
      console.error('Error listando citas:', error);
      return res.status(500).json({ error: 'Error al consultar las citas médicas.' });
    }
  }
);

// AI Processing: Extract appointment info from Text
router.post(
  '/ai-text',
  aiRateLimiter,
  validateBody({
    text: v.string({ min: 1, max: 5000 }),
  }),
  async (req: AuthRequest, res) => {
    try {
      const { text } = req.body;

      const extracted = await extractAppointmentFromText(text);
      return res.json(extracted);
    } catch (error: any) {
      console.error('Error procesando texto con Gemini:', error);
      return res.status(500).json({ error: 'Error procesando el texto con la Inteligencia Artificial.' });
    }
  }
);

// AI Processing: Upload photo or PDF & Extract appointment info with Gemini
router.post('/ai-photo', aiRateLimiter, secureUpload.single('photo'), validateUploadedFiles, async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo.' });
    }

    const familyId = req.family!.id;
    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    const photoUrl = `/api/uploads/${req.file.filename}`;

    // Record upload in staging table linked to familyId
    recordStagingUpload(familyId, req.file.filename);

    const extracted = await extractAppointmentFromFile(filePath, mimeType);

    return res.json({
      extracted,
      photo_url: photoUrl,
    });
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    console.error('Error procesando archivo con Gemini:', error);
    return res.status(500).json({ error: 'Error analizando el archivo con la Inteligencia Artificial.' });
  }
});

// Create appointment
router.post(
  '/',
  validateBody({
    patient_id: v.uuid(),
    title: v.string({ min: 1, max: 200 }),
    date_time: v.isoDate(),
    appointment_type: v.enum(['consulta', 'examen', 'laboratorio', 'procedimiento'], { optional: true, default: 'consulta' }),
    specialist: v.string({ min: 1, max: 100, optional: true }),
    specialty: v.string({ min: 1, max: 100, optional: true }),
    location: v.string({ min: 1, max: 200, optional: true }),
    requires_fasting: v.boolean({ optional: true, default: false }),
    prep_instructions: v.string({ min: 1, max: 2000, optional: true }),
    photo_url: v.string({ min: 1, max: 500, optional: true }),
    doctor_notes: v.string({ min: 1, max: 5000, optional: true }),
    origin_order_id: v.uuid({ optional: true }),
  }),
  (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const {
      patient_id,
      title,
      appointment_type,
      specialist,
      specialty,
      location,
      date_time,
      requires_fasting,
      prep_instructions,
      photo_url,
      doctor_notes,
      origin_order_id,
    } = req.body;

    if (!patient_id || typeof patient_id !== 'string' || !title || typeof title !== 'string' || !date_time) {
      return res.status(400).json({ error: 'Paciente, título y fecha/hora son obligatorios y deben ser válidos.' });
    }

    // Strictly check patient ownership
    const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND family_id = ?').get(patient_id, familyId) as any;
    if (!patient) {
      return res.status(403).json({ error: 'El paciente no pertenece a su grupo familiar.' });
    }

    // Validate photo_url ownership if provided
    if (photo_url && typeof photo_url === 'string' && photo_url.trim()) {
      if (!isFileOwnedByFamily(familyId, photo_url)) {
        return res.status(403).json({ error: 'El archivo de foto no pertenece a su grupo familiar.' });
      }
    }

    const id = uuidv4();
    const fastingInt = requires_fasting ? 1 : 0;
    const cleanTitle = title.trim();
    const cleanAppType = typeof appointment_type === 'string' ? appointment_type : 'consulta';

    db.prepare(`
      INSERT INTO appointments (
        id, family_id, patient_id, title, appointment_type, specialist, specialty,
        location, date_time, requires_fasting, prep_instructions, photo_url, status, doctor_notes, origin_order_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)
    `).run([
      id,
      familyId,
      patient_id,
      cleanTitle,
      cleanAppType,
      typeof specialist === 'string' ? specialist.trim() : null,
      typeof specialty === 'string' ? specialty.trim() : null,
      typeof location === 'string' ? location.trim() : null,
      String(date_time),
      fastingInt,
      typeof prep_instructions === 'string' ? prep_instructions.trim() : null,
      typeof photo_url === 'string' ? photo_url.trim() : null,
      typeof doctor_notes === 'string' ? doctor_notes.trim() : null,
      typeof origin_order_id === 'string' ? origin_order_id.trim() : null
    ]);


    if (origin_order_id) {
      db.prepare('UPDATE medical_orders SET linked_appointment_id = ?, status = ? WHERE id = ? AND family_id = ?').run([id, 'agendada', origin_order_id, familyId]);
    }

    const appointment = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
    if (patient) {
      appointment.patient_name = patient.name;
    }
    appointment.attached_results = [];

    // Automatic Google Calendar Sync for ALL connected family accounts (Async in background)
    const connectedPatients = db.prepare('SELECT * FROM patients WHERE family_id = ? AND google_refresh_token IS NOT NULL').all(familyId) as any[];
    for (const cp of connectedPatients) {
      syncAppointmentToGoogleCalendar(cp.google_refresh_token, appointment).then((eventId) => {
        if (eventId) {
          db.prepare('UPDATE appointments SET google_event_id = ? WHERE id = ? AND family_id = ?').run([eventId, id, familyId]);
        }
      }).catch((err) => console.error('Error sincronizando cita con Google Calendar:', err));
    }

    // Push notification to family
    sendNotificationToFamily(familyId, {
      title: `🩺 Nueva Cita Registrada: [${patient?.name || 'Paciente'}] ${cleanTitle}`,
      body: `${patient?.name || 'Paciente'} - ${new Date(date_time).toLocaleString('es-ES')}`,
      url: '/',
    });

    return res.json(appointment);
  } catch (error) {
    console.error('Error creando cita:', error);
    return res.status(500).json({ error: 'Error al crear la cita médica.' });
  }
});

// Update appointment
router.put(
  '/:id',
  validateRequest({
    params: {
      id: v.uuid(),
    },
    body: {
      patient_id: v.uuid({ optional: true }),
      title: v.string({ min: 1, max: 200, optional: true }),
      date_time: v.isoDate({ optional: true }),
      appointment_type: v.enum(['consulta', 'examen', 'laboratorio', 'procedimiento'], { optional: true }),
      specialist: v.string({ min: 1, max: 100, optional: true }),
      specialty: v.string({ min: 1, max: 100, optional: true }),
      location: v.string({ min: 1, max: 200, optional: true }),
      requires_fasting: v.boolean({ optional: true }),
      prep_instructions: v.string({ min: 1, max: 2000, optional: true }),
      photo_url: v.string({ min: 1, max: 500, optional: true }),
      status: v.enum(['pendiente', 'completada', 'cancelada'], { optional: true }),
      doctor_notes: v.string({ min: 1, max: 5000, optional: true }),
      origin_order_id: v.uuid({ optional: true }),
    },
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id } = req.params;
      const {
        patient_id,
        title,
        appointment_type,
        specialist,
        specialty,
        location,
        date_time,
        requires_fasting,
        prep_instructions,
        photo_url,
        status,
        doctor_notes,
        origin_order_id,
      } = req.body;

      const existing = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      if (!existing) {
        return res.status(404).json({ error: 'Cita no encontrada o no pertenece a su familia.' });
      }

      const targetPatientId = patient_id || existing.patient_id;
      // Verify target patient ownership
      const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND family_id = ?').get(targetPatientId, familyId) as any;
      if (!patient) {
        return res.status(403).json({ error: 'El paciente asignado no pertenece a su grupo familiar.' });
      }

      // Validate photo_url ownership if updated
      if (photo_url && typeof photo_url === 'string' && photo_url.trim() && photo_url !== existing.photo_url) {
        if (!isFileOwnedByFamily(familyId, photo_url)) {
          return res.status(403).json({ error: 'El archivo de foto no pertenece a su grupo familiar.' });
        }
      }

      const fastingInt = requires_fasting !== undefined ? (requires_fasting ? 1 : 0) : existing.requires_fasting;

      db.prepare(`
        UPDATE appointments SET
          patient_id = ?, title = ?, appointment_type = ?, specialist = ?, specialty = ?,
          location = ?, date_time = ?, requires_fasting = ?, prep_instructions = ?,
          photo_url = ?, status = ?, doctor_notes = ?, origin_order_id = ?
        WHERE id = ? AND family_id = ?
      `).run([
        targetPatientId,
        typeof title === 'string' ? title.trim() : existing.title,
        typeof appointment_type === 'string' ? appointment_type.trim() : existing.appointment_type,
        specialist !== undefined ? (typeof specialist === 'string' ? specialist.trim() : null) : existing.specialist,
        specialty !== undefined ? (typeof specialty === 'string' ? specialty.trim() : null) : existing.specialty,
        location !== undefined ? (typeof location === 'string' ? location.trim() : null) : existing.location,
        date_time ? String(date_time) : existing.date_time,
        fastingInt,
        prep_instructions !== undefined ? (typeof prep_instructions === 'string' ? prep_instructions.trim() : null) : existing.prep_instructions,
        photo_url !== undefined ? (typeof photo_url === 'string' ? photo_url.trim() : null) : existing.photo_url,
        typeof status === 'string' ? status.trim() : existing.status,
        doctor_notes !== undefined ? (typeof doctor_notes === 'string' ? doctor_notes.trim() : null) : existing.doctor_notes,
        typeof origin_order_id === 'string' ? origin_order_id.trim() : existing.origin_order_id,
        id,
        familyId
      ]);

      const updated = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      if (patient) {
        updated.patient_name = patient.name;
      }

      const results = db.prepare('SELECT * FROM exam_results WHERE appointment_id = ? AND family_id = ? ORDER BY created_at DESC').all([id, familyId]) as any[];
      updated.attached_results = results;

      const connectedPatients = db.prepare('SELECT * FROM patients WHERE family_id = ? AND google_refresh_token IS NOT NULL').all(familyId) as any[];
      for (const cp of connectedPatients) {
        syncAppointmentToGoogleCalendar(cp.google_refresh_token, updated).catch((err) => console.error('Error sincronizando cita actualizada con Google Calendar:', err));
      }

      return res.json(updated);
    } catch (error) {
      console.error('Error actualizando cita:', error);
      return res.status(500).json({ error: 'Error al actualizar la cita.' });
    }
  }
);

// Delete appointment
router.delete(
  '/:id',
  validateParams({
    id: v.uuid(),
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id } = req.params;

      const result = db.prepare('DELETE FROM appointments WHERE id = ? AND family_id = ?').run([id, familyId]);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Cita no encontrada o no pertenece a su familia.' });
      }

      return res.json({ message: 'Cita eliminada correctamente.' });
    } catch (error) {
      console.error('Error eliminando cita:', error);
      return res.status(500).json({ error: 'Error al eliminar la cita.' });
    }
  }
);

export default router;

