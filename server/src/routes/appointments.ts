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

/** Helper: compute the effective status considering the date.
 * If DB status is 'pendiente' and the date has already passed, return 'realizada'.
 * Otherwise return the stored status. This is read-only — it never mutates the DB.
 */
function computeStatus(dbStatus: string, dateTime: string): string {
  if (dbStatus === 'pendiente') {
    const apptDate = new Date(dateTime);
    if (!isNaN(apptDate.getTime()) && apptDate < new Date()) {
      return 'realizada';
    }
  }
  return dbStatus;
}

/** Record an appointment status/datetime change in appointment_history */
function recordHistory(
  appointmentId: string,
  familyId: string,
  previousStatus: string | null,
  newStatus: string,
  previousDateTime: string | null,
  newDateTime: string | null,
  reason: string | null,
  changedBy: string | null
) {
  try {
    const histId = uuidv4();
    db.prepare(`
      INSERT INTO appointment_history
        (id, appointment_id, family_id, previous_status, new_status, previous_date_time, new_date_time, reason, changed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run([histId, appointmentId, familyId, previousStatus, newStatus, previousDateTime, newDateTime, reason, changedBy]);
  } catch (e) {
    console.error('Error recording appointment history:', e);
  }
}

// Get list of appointments (including linked exam results and history)
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

      for (const app of appointments) {
        // Compute effective status based on date (never mutates DB)
        app.computed_status = computeStatus(app.status, app.date_time);

        // Attach exam results linked via direct appointment_id, exam_appointment_id, or appointment_exam_links
        try {
          const attached = db.prepare(`
            SELECT DISTINCT e.*, p.name as patient_name, p.color as patient_color
            FROM exam_results e
            JOIN patients p ON e.patient_id = p.id
            WHERE e.family_id = ? AND (
              e.appointment_id = ?
              OR e.exam_appointment_id = ?
              OR e.id IN (SELECT ael.exam_result_id FROM appointment_exam_links ael WHERE ael.appointment_id = ? AND ael.family_id = ?)
            )
            ORDER BY e.created_at DESC
          `).all([familyId, app.id, app.id, app.id, familyId]) as any[];
          app.attached_results = attached;
        } catch (e) {
          const results = db.prepare('SELECT * FROM exam_results WHERE (appointment_id = ? OR exam_appointment_id = ?) AND family_id = ? ORDER BY created_at DESC').all([app.id, app.id, familyId]) as any[];
          app.attached_results = results;
        }

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

// Get appointment history
router.get(
  '/:id/history',
  validateParams({ id: v.uuid() }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id } = req.params;

      const appt = db.prepare('SELECT id FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId);
      if (!appt) return res.status(404).json({ error: 'Cita no encontrada.' });

      const history = db.prepare('SELECT * FROM appointment_history WHERE appointment_id = ? AND family_id = ? ORDER BY created_at ASC').all([id, familyId]) as any[];
      return res.json(history);
    } catch (error) {
      console.error('Error consultando historial de cita:', error);
      return res.status(500).json({ error: 'Error al consultar el historial.' });
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
      patient_id, title, appointment_type, specialist, specialty,
      location, date_time, requires_fasting, prep_instructions,
      photo_url, doctor_notes, origin_order_id,
    } = req.body;

    if (!patient_id || typeof patient_id !== 'string' || !title || typeof title !== 'string' || !date_time) {
      return res.status(400).json({ error: 'Paciente, título y fecha/hora son obligatorios y deben ser válidos.' });
    }

    const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND family_id = ?').get(patient_id, familyId) as any;
    if (!patient) {
      return res.status(403).json({ error: 'El paciente no pertenece a su grupo familiar.' });
    }

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
      id, familyId, patient_id, cleanTitle, cleanAppType,
      typeof specialist === 'string' ? specialist.trim() : null,
      typeof specialty === 'string' ? specialty.trim() : null,
      typeof location === 'string' ? location.trim() : null,
      String(date_time), fastingInt,
      typeof prep_instructions === 'string' ? prep_instructions.trim() : null,
      typeof photo_url === 'string' ? photo_url.trim() : null,
      typeof doctor_notes === 'string' ? doctor_notes.trim() : null,
      typeof origin_order_id === 'string' ? origin_order_id.trim() : null,
    ]);

    if (origin_order_id) {
      db.prepare('UPDATE medical_orders SET linked_appointment_id = ?, status = ? WHERE id = ? AND family_id = ?').run([id, 'agendada', origin_order_id, familyId]);
    }

    const appointment = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
    if (patient) appointment.patient_name = patient.name;
    appointment.attached_results = [];
    appointment.medical_orders = [];
    appointment.computed_status = computeStatus(appointment.status, appointment.date_time);

    // Google Calendar sync (background)
    const connectedPatients = db.prepare('SELECT * FROM patients WHERE family_id = ? AND google_refresh_token IS NOT NULL').all(familyId) as any[];
    for (const cp of connectedPatients) {
      syncAppointmentToGoogleCalendar(cp.google_refresh_token, appointment).then((eventId) => {
        if (eventId) db.prepare('UPDATE appointments SET google_event_id = ? WHERE id = ? AND family_id = ?').run([eventId, id, familyId]);
      }).catch((err) => console.error('Error sincronizando cita con Google Calendar:', err));
    }

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
    params: { id: v.uuid() },
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
      status: v.enum(['pendiente', 'realizada', 'cancelada', 'reprogramada'], { optional: true }),
      doctor_notes: v.string({ min: 1, max: 5000, optional: true }),
      origin_order_id: v.uuid({ optional: true }),
      reason: v.string({ min: 1, max: 1000, optional: true }),
    },
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id } = req.params;
      const {
        patient_id, title, appointment_type, specialist, specialty,
        location, date_time, requires_fasting, prep_instructions,
        photo_url, status, doctor_notes, origin_order_id, reason,
      } = req.body;

      const existing = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      if (!existing) {
        return res.status(404).json({ error: 'Cita no encontrada o no pertenece a su familia.' });
      }

      const targetPatientId = patient_id || existing.patient_id;
      const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND family_id = ?').get(targetPatientId, familyId) as any;
      if (!patient) {
        return res.status(403).json({ error: 'El paciente asignado no pertenece a su grupo familiar.' });
      }

      if (photo_url && typeof photo_url === 'string' && photo_url.trim() && photo_url !== existing.photo_url) {
        if (!isFileOwnedByFamily(familyId, photo_url)) {
          return res.status(403).json({ error: 'El archivo de foto no pertenece a su grupo familiar.' });
        }
      }

      const newStatus = typeof status === 'string' ? status.trim() : existing.status;
      const newDateTime = date_time ? String(date_time) : existing.date_time;
      const fastingInt = requires_fasting !== undefined ? (requires_fasting ? 1 : 0) : existing.requires_fasting;

      // Record history if status or date changed
      const statusChanged = newStatus !== existing.status;
      const dateChanged = newDateTime !== existing.date_time;
      if (statusChanged || dateChanged) {
        recordHistory(
          id, familyId,
          existing.status, newStatus,
          existing.date_time, newDateTime,
          reason || null,
          null
        );
      }

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
        newDateTime, fastingInt,
        prep_instructions !== undefined ? (typeof prep_instructions === 'string' ? prep_instructions.trim() : null) : existing.prep_instructions,
        photo_url !== undefined ? (typeof photo_url === 'string' ? photo_url.trim() : null) : existing.photo_url,
        newStatus,
        doctor_notes !== undefined ? (typeof doctor_notes === 'string' ? doctor_notes.trim() : null) : existing.doctor_notes,
        typeof origin_order_id === 'string' ? origin_order_id.trim() : existing.origin_order_id,
        id, familyId,
      ]);

      const updated = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      if (patient) updated.patient_name = patient.name;
      updated.computed_status = computeStatus(updated.status, updated.date_time);

      try {
        const attached = db.prepare(`
          SELECT DISTINCT e.*, p.name as patient_name, p.color as patient_color
          FROM exam_results e
          JOIN patients p ON e.patient_id = p.id
          WHERE e.family_id = ? AND (
            e.appointment_id = ?
            OR e.exam_appointment_id = ?
            OR e.id IN (SELECT ael.exam_result_id FROM appointment_exam_links ael WHERE ael.appointment_id = ? AND ael.family_id = ?)
          )
          ORDER BY e.created_at DESC
        `).all([familyId, id, id, id, familyId]) as any[];
        updated.attached_results = attached;
      } catch (e) {
        const results = db.prepare('SELECT * FROM exam_results WHERE (appointment_id = ? OR exam_appointment_id = ?) AND family_id = ? ORDER BY created_at DESC').all([id, id, familyId]) as any[];
        updated.attached_results = results;
      }

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

// Cancel appointment with reason
router.post(
  '/:id/cancel',
  validateRequest({
    params: { id: v.uuid() },
    body: { reason: v.string({ min: 1, max: 1000, optional: true }) },
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { id } = req.params;
      const { reason } = req.body;

      const existing = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      if (!existing) return res.status(404).json({ error: 'Cita no encontrada.' });
      if (existing.status === 'cancelada') return res.status(400).json({ error: 'La cita ya está cancelada.' });

      recordHistory(id, familyId, existing.status, 'cancelada', existing.date_time, null, reason || 'Cancelada por el usuario', null);
      db.prepare("UPDATE appointments SET status = 'cancelada' WHERE id = ? AND family_id = ?").run([id, familyId]);

      const updated = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      updated.computed_status = 'cancelada';
      return res.json(updated);
    } catch (error) {
      console.error('Error cancelando cita:', error);
      return res.status(500).json({ error: 'Error al cancelar la cita.' });
    }
  }
);

// Delete appointment
router.delete(
  '/:id',
  validateParams({ id: v.uuid() }),
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
