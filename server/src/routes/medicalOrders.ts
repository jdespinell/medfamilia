import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { secureUpload } from '../middleware/upload.js';

const router = Router();
router.use(authMiddleware);

// GET / - List orders
router.get('/', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { appointment_id, patient_id } = req.query;

    let query = `
      SELECT mo.*, p.name as patient_name
      FROM medical_orders mo
      JOIN patients p ON mo.patient_id = p.id
      WHERE mo.family_id = ? AND p.family_id = ?
    `;
    const params: any[] = [familyId, familyId];

    if (patient_id && typeof patient_id === 'string' && patient_id !== 'all') {
      query += ` AND mo.patient_id = ?`;
      params.push(patient_id);
    }

    if (appointment_id && typeof appointment_id === 'string') {
      query += ` AND mo.appointment_id = ?`;
      params.push(appointment_id);
    }

    query += ` ORDER BY mo.created_at DESC`;

    const orders = db.prepare(query).all(params) as any[];
    return res.json(orders);
  } catch (error) {
    console.error('Error consultando órdenes médicas:', error);
    return res.status(500).json({ error: 'Error al consultar las órdenes médicas.' });
  }
});

// GET /pending - List only pending orders
router.get('/pending', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { patient_id } = req.query;

    let query = `
      SELECT mo.*, p.name as patient_name, a.title as source_appointment_title
      FROM medical_orders mo
      JOIN patients p ON mo.patient_id = p.id
      JOIN appointments a ON mo.appointment_id = a.id
      WHERE mo.family_id = ? AND p.family_id = ? AND mo.status = 'pendiente'
    `;
    const params: any[] = [familyId, familyId];

    if (patient_id && typeof patient_id === 'string' && patient_id !== 'all') {
      query += ` AND mo.patient_id = ?`;
      params.push(patient_id);
    }

    query += ` ORDER BY mo.created_at DESC`;

    const orders = db.prepare(query).all(params) as any[];
    return res.json(orders);
  } catch (error) {
    console.error('Error consultando órdenes médicas pendientes:', error);
    return res.status(500).json({ error: 'Error al consultar las órdenes médicas pendientes.' });
  }
});

// POST / - Create order
router.post('/', secureUpload.single('file'), (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { appointment_id, patient_id, order_type, title, description } = req.body;

    if (!appointment_id || typeof appointment_id !== 'string' || !patient_id || typeof patient_id !== 'string' || !title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Paciente, cita y título son requeridos.' });
    }

    // Verify patient ownership
    const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND family_id = ?').get(patient_id, familyId);
    if (!patient) {
      return res.status(403).json({ error: 'El paciente no pertenece a su grupo familiar.' });
    }

    // Verify appointment ownership
    const appt = db.prepare('SELECT id FROM appointments WHERE id = ? AND family_id = ?').get(appointment_id, familyId);
    if (!appt) {
      return res.status(403).json({ error: 'La cita asociada no pertenece a su grupo familiar.' });
    }

    let fileUrl = null;
    let fileType = null;
    
    if (req.file) {
      const mimeType = req.file.mimetype;
      const safeFilename = path.basename(req.file.filename);
      fileUrl = `/api/uploads/${safeFilename}`;
      fileType = mimeType.includes('pdf') ? 'pdf' : 'image';
    }

    const id = uuidv4();
    const cleanTitle = title.trim();
    const cleanDesc = description && typeof description === 'string' ? description.trim() : null;
    const cleanType = order_type && typeof order_type === 'string' ? order_type.trim() : 'examen';

    db.prepare(`
      INSERT INTO medical_orders (id, family_id, appointment_id, patient_id, order_type, title, description, file_url, file_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run([
      id,
      familyId,
      appointment_id,
      patient_id,
      cleanType,
      cleanTitle,
      cleanDesc,
      fileUrl,
      fileType,
      'pendiente'
    ]);

    const order = db.prepare('SELECT * FROM medical_orders WHERE id = ? AND family_id = ?').get(id, familyId);
    return res.json(order);
  } catch (error) {
    console.error('Error creando orden médica:', error);
    return res.status(500).json({ error: 'Error al crear la orden médica.' });
  }
});

// PUT /:id - Update order
router.put('/:id', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { id } = req.params;
    const { title, description, status, linked_appointment_id, order_type } = req.body;

    const existing = db.prepare('SELECT * FROM medical_orders WHERE id = ? AND family_id = ?').get(id, familyId) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Orden médica no encontrada o no pertenece a su familia.' });
    }

    let finalStatus = status && typeof status === 'string' ? status.trim() : existing.status;
    let finalLinkedAppt = linked_appointment_id || existing.linked_appointment_id;

    if (linked_appointment_id && linked_appointment_id !== existing.linked_appointment_id) {
      const appt = db.prepare('SELECT id FROM appointments WHERE id = ? AND family_id = ?').get(linked_appointment_id, familyId);
      if (!appt) {
        return res.status(403).json({ error: 'La cita enlazada no pertenece a su grupo familiar.' });
      }
      finalStatus = 'agendada';
    }

    db.prepare(`
      UPDATE medical_orders SET
        title = ?, description = ?, status = ?, linked_appointment_id = ?, order_type = ?
      WHERE id = ? AND family_id = ?
    `).run([
      title && typeof title === 'string' ? title.trim() : existing.title,
      description !== undefined ? (typeof description === 'string' ? description.trim() : null) : existing.description,
      finalStatus,
      finalLinkedAppt,
      order_type && typeof order_type === 'string' ? order_type.trim() : existing.order_type,
      id,
      familyId
    ]);

    if (finalLinkedAppt && (finalStatus === 'agendada' || finalStatus === 'completada')) {
      db.prepare('UPDATE appointments SET origin_order_id = ? WHERE id = ? AND family_id = ?').run([id, finalLinkedAppt, familyId]);
    }

    const updated = db.prepare('SELECT * FROM medical_orders WHERE id = ? AND family_id = ?').get(id, familyId);
    return res.json(updated);
  } catch (error) {
    console.error('Error actualizando orden médica:', error);
    return res.status(500).json({ error: 'Error al actualizar la orden médica.' });
  }
});

// DELETE /:id - Delete order
router.delete('/:id', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { id } = req.params;

    const existing = db.prepare('SELECT file_url FROM medical_orders WHERE id = ? AND family_id = ?').get(id, familyId) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Orden médica no encontrada o no pertenece a su familia.' });
    }

    db.prepare('DELETE FROM medical_orders WHERE id = ? AND family_id = ?').run(id, familyId);

    if (existing.file_url && existing.file_url.includes('/uploads/')) {
      const filename = path.basename(existing.file_url);
      const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
      const targetPath = path.join(uploadsDir, filename);
      if (fs.existsSync(targetPath)) {
        fs.unlink(targetPath, () => {});
      }
    }

    return res.json({ message: 'Orden médica eliminada correctamente.' });
  } catch (error) {
    console.error('Error eliminando orden médica:', error);
    return res.status(500).json({ error: 'Error al eliminar la orden médica.' });
  }
});

export default router;
