import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { extractAppointmentFromText, extractAppointmentFromImage } from '../services/gemini.js';
import { syncAppointmentToGoogleCalendar } from '../services/googleCalendar.js';
import { sendNotificationToFamily } from '../services/pushNotifications.js';

const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `appointment-${Date.now()}-${uuidv4()}${ext}`);
  },
});

const upload = multer({ storage });

const router = Router();
router.use(authMiddleware);

// Get list of appointments
router.get('/', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { patient_id } = req.query;

  let query = `
    SELECT a.*, p.name as patient_name, p.color as patient_color
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.family_id = ?
  `;
  const params: any[] = [familyId];

  if (patient_id && patient_id !== 'all') {
    query += ` AND a.patient_id = ?`;
    params.push(patient_id);
  }

  query += ` ORDER BY a.date_time ASC`;

  const appointments = db.prepare(query).all(params) as any[];
  return res.json(appointments);
});

// AI Processing: Extract appointment info from Text
router.post('/ai-text', async (req: AuthRequest, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Proporcione un texto descriptivo para procesar con IA.' });
    }

    const extracted = await extractAppointmentFromText(text);
    return res.json(extracted);
  } catch (error: any) {
    console.error('Error procesando texto con Gemini:', error);
    return res.status(500).json({ error: error.message || 'Error procesando el texto con la IA.' });
  }
});

// AI Processing: Upload photo & Extract appointment info with Gemini Vision
router.post('/ai-photo', upload.single('photo'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ninguna imagen.' });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    const photoUrl = `/uploads/${req.file.filename}`;

    const extracted = await extractAppointmentFromImage(filePath, mimeType);

    return res.json({
      extracted,
      photo_url: photoUrl,
    });
  } catch (error: any) {
    console.error('Error procesando foto con Gemini Vision:', error);
    return res.status(500).json({ error: error.message || 'Error analizando la foto con Gemini.' });
  }
});

// Create appointment
router.post('/', (req: AuthRequest, res) => {
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
    } = req.body;

    if (!patient_id || !title || !date_time) {
      return res.status(400).json({ error: 'Paciente, título y fecha/hora son obligatorios.' });
    }

    const id = uuidv4();
    const fastingInt = requires_fasting ? 1 : 0;

    db.prepare(`
      INSERT INTO appointments (
        id, family_id, patient_id, title, appointment_type, specialist, specialty,
        location, date_time, requires_fasting, prep_instructions, photo_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
    `).run([
      id,
      familyId,
      patient_id,
      title,
      appointment_type || 'consulta',
      specialist || null,
      specialty || null,
      location || null,
      date_time,
      fastingInt,
      prep_instructions || null,
      photo_url || null
    ]);

    const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as any;
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patient_id) as any;

    if (patient) {
      appointment.patient_name = patient.name;
    }

    // Automatic Google Calendar Sync for ALL connected family accounts (Async in background)
    const connectedPatients = db.prepare('SELECT * FROM patients WHERE family_id = ? AND google_refresh_token IS NOT NULL').all(familyId) as any[];
    for (const cp of connectedPatients) {
      syncAppointmentToGoogleCalendar(cp.google_refresh_token, appointment).then((eventId) => {
        if (eventId) {
          db.prepare('UPDATE appointments SET google_event_id = ? WHERE id = ?').run([eventId, id]);
        }
      });
    }

    // Push notification to family
    sendNotificationToFamily(familyId, {
      title: `🩺 Nueva Cita Registrada: [${patient?.name || 'Paciente'}] ${title}`,
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
router.put('/:id', (req: AuthRequest, res) => {
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
    } = req.body;

    const existing = db.prepare('SELECT * FROM appointments WHERE id = ? AND family_id = ?').get(id, familyId) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Cita no encontrada.' });
    }

    const fastingInt = requires_fasting ? 1 : 0;

    db.prepare(`
      UPDATE appointments SET
        patient_id = ?, title = ?, appointment_type = ?, specialist = ?, specialty = ?,
        location = ?, date_time = ?, requires_fasting = ?, prep_instructions = ?,
        photo_url = ?, status = ?
      WHERE id = ? AND family_id = ?
    `).run([
      patient_id || existing.patient_id,
      title || existing.title,
      appointment_type || existing.appointment_type,
      specialist ?? existing.specialist,
      specialty ?? existing.specialty,
      location ?? existing.location,
      date_time || existing.date_time,
      fastingInt,
      prep_instructions ?? existing.prep_instructions,
      photo_url ?? existing.photo_url,
      status || existing.status,
      id,
      familyId
    ]);

    const updated = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as any;
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(updated.patient_id) as any;
    if (patient) {
      updated.patient_name = patient.name;
    }

    const connectedPatients = db.prepare('SELECT * FROM patients WHERE family_id = ? AND google_refresh_token IS NOT NULL').all(familyId) as any[];
    for (const cp of connectedPatients) {
      syncAppointmentToGoogleCalendar(cp.google_refresh_token, updated);
    }

    return res.json(updated);
  } catch (error) {
    console.error('Error actualizando cita:', error);
    return res.status(500).json({ error: 'Error al actualizar la cita.' });
  }
});

// Delete appointment
router.delete('/:id', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { id } = req.params;

  db.prepare('DELETE FROM appointments WHERE id = ? AND family_id = ?').run(id, familyId);
  return res.json({ message: 'Cita eliminada correctamente.' });
});

export default router;
