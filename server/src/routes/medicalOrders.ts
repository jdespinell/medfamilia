import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { secureUpload } from '../middleware/upload.js';
import { aiRateLimiter } from '../middleware/rateLimiter.js';
import { extractMedicalOrdersFromFile } from '../services/gemini.js';

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
      LEFT JOIN appointments a ON mo.appointment_id = a.id
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

// POST /ai-batch - Process multi-file uploads with AI and create pending orders
router.post('/ai-batch', aiRateLimiter, secureUpload.array('files', 10), async (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { appointment_id, patient_id } = req.body;

    if (!appointment_id || typeof appointment_id !== 'string' || !patient_id || typeof patient_id !== 'string') {
      return res.status(400).json({ error: 'Paciente y cita son requeridos.' });
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Debe adjuntar al menos un archivo para analizar con IA.' });
    }

    // Verify patient ownership
    const patient = db.prepare('SELECT id, name FROM patients WHERE id = ? AND family_id = ?').get(patient_id, familyId) as any;
    if (!patient) {
      return res.status(403).json({ error: 'El paciente no pertenece a su grupo familiar.' });
    }

    // Verify appointment ownership
    const appt = db.prepare('SELECT id, title FROM appointments WHERE id = ? AND family_id = ?').get(appointment_id, familyId) as any;
    if (!appt) {
      return res.status(403).json({ error: 'La cita asociada no pertenece a su grupo familiar.' });
    }

    const createdOrders: any[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = file.path;
      const mimeType = file.mimetype;
      const safeFilename = path.basename(file.filename);
      const fileUrl = `/api/uploads/${safeFilename}`;
      const fileType = mimeType.includes('pdf') ? 'pdf' : 'image';

      let extracted: any[] = [];
      try {
        extracted = await extractMedicalOrdersFromFile(filePath, mimeType);
      } catch (aiErr) {
        console.error('Error extrayendo orden con Gemini:', aiErr);
      }

      if (!extracted || extracted.length === 0) {
        extracted = [{
          title: `Orden Médica ${files.length > 1 ? `#${i + 1}` : ''}`,
          order_type: 'examen',
          description: 'Documento adjuntado pendiente de agendar/efectuar.'
        }];
      }

      for (const item of extracted) {
        const id = uuidv4();
        const cleanTitle = item.title ? String(item.title).trim() : `Orden Médica ${i + 1}`;
        const cleanType = ['examen', 'especialista', 'laboratorio', 'procedimiento'].includes(item.order_type) ? item.order_type : 'examen';
        const cleanDesc = item.description ? String(item.description).trim() : 'Pendiente de agendar / efectuar';

        db.prepare(`
          INSERT INTO medical_orders (id, family_id, appointment_id, patient_id, order_type, title, description, file_url, file_type, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
        `).run([
          id,
          familyId,
          appointment_id,
          patient_id,
          cleanType,
          cleanTitle,
          cleanDesc,
          fileUrl,
          fileType
        ]);

        const order = db.prepare('SELECT mo.*, p.name as patient_name FROM medical_orders mo JOIN patients p ON mo.patient_id = p.id WHERE mo.id = ? AND mo.family_id = ?').get(id, familyId);
        createdOrders.push(order);
      }
    }

    return res.json({
      success: true,
      orders: createdOrders,
      message: `Se analizó(aron) ${files.length} archivo(s) y se creó(aron) ${createdOrders.length} orden(es) médica(s) pendientes de agendar.`
    });
  } catch (error: any) {
    console.error('Error procesando lote de órdenes médicas con IA:', error);
    return res.status(500).json({ error: error?.message || 'Error al procesar los archivos con Inteligencia Artificial.' });
  }
});

// POST /ai-analyze-draft - Extract draft orders with AI for user confirmation BEFORE saving
router.post('/ai-analyze-draft', aiRateLimiter, secureUpload.array('files', 10), async (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { appointment_id, patient_id } = req.body;

    if (!appointment_id || typeof appointment_id !== 'string' || !patient_id || typeof patient_id !== 'string') {
      return res.status(400).json({ error: 'Paciente y cita son requeridos.' });
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Debe adjuntar al menos un archivo para analizar con IA.' });
    }

    // Verify patient ownership
    const patient = db.prepare('SELECT id, name FROM patients WHERE id = ? AND family_id = ?').get(patient_id, familyId) as any;
    if (!patient) {
      return res.status(403).json({ error: 'El paciente no pertenece a su grupo familiar.' });
    }

    // Verify appointment ownership
    const appt = db.prepare('SELECT id, title FROM appointments WHERE id = ? AND family_id = ?').get(appointment_id, familyId) as any;
    if (!appt) {
      return res.status(403).json({ error: 'La cita asociada no pertenece a su grupo familiar.' });
    }

    const draftOrders: any[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = file.path;
      const mimeType = file.mimetype;
      const safeFilename = path.basename(file.filename);
      const fileUrl = `/api/uploads/${safeFilename}`;
      const fileType = mimeType.includes('pdf') ? 'pdf' : 'image';

      let extracted: any[] = [];
      try {
        extracted = await extractMedicalOrdersFromFile(filePath, mimeType);
      } catch (aiErr) {
        console.error('Error extrayendo borrador de orden con Gemini:', aiErr);
      }

      if (!extracted || extracted.length === 0) {
        extracted = [{
          title: `Orden Médica ${files.length > 1 ? `#${i + 1}` : ''}`,
          order_type: 'examen',
          description: 'Documento adjuntado pendiente de agendar/efectuar.'
        }];
      }

      for (const item of extracted) {
        const tempId = uuidv4();
        const cleanTitle = item.title ? String(item.title).trim() : `Orden Médica ${i + 1}`;
        const cleanType = ['examen', 'especialista', 'laboratorio', 'procedimiento'].includes(item.order_type) ? item.order_type : 'examen';
        const cleanDesc = item.description ? String(item.description).trim() : '';

        draftOrders.push({
          temp_id: tempId,
          appointment_id,
          patient_id,
          patient_name: patient.name,
          order_type: cleanType,
          title: cleanTitle,
          description: cleanDesc,
          file_url: fileUrl,
          file_type: fileType,
        });
      }
    }

    return res.json({
      success: true,
      draft_orders: draftOrders,
    });
  } catch (error: any) {
    console.error('Error analizando borradores de órdenes con IA:', error);
    return res.status(500).json({ error: error?.message || 'Error analizando los archivos con Inteligencia Artificial.' });
  }
});

// POST /confirm-batch - Save user-confirmed orders after review
router.post('/confirm-batch', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { orders } = req.body;

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'No se recibieron órdenes para confirmar.' });
    }

    const createdOrders: any[] = [];

    for (const item of orders) {
      const { appointment_id, patient_id, order_type, title, description, file_url, file_type } = item;

      if (!appointment_id || !patient_id || !title) continue;

      // Verify ownership
      const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND family_id = ?').get(patient_id, familyId);
      if (!patient) continue;

      const appt = db.prepare('SELECT id FROM appointments WHERE id = ? AND family_id = ?').get(appointment_id, familyId);
      if (!appt) continue;

      const id = uuidv4();
      const cleanTitle = String(title).trim();
      const cleanType = ['examen', 'especialista', 'laboratorio', 'procedimiento'].includes(order_type) ? order_type : 'examen';
      const cleanDesc = description ? String(description).trim() : null;

      db.prepare(`
        INSERT INTO medical_orders (id, family_id, appointment_id, patient_id, order_type, title, description, file_url, file_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
      `).run([
        id,
        familyId,
        appointment_id,
        patient_id,
        cleanType,
        cleanTitle,
        cleanDesc,
        file_url || null,
        file_type || null
      ]);

      const order = db.prepare('SELECT mo.*, p.name as patient_name FROM medical_orders mo JOIN patients p ON mo.patient_id = p.id WHERE mo.id = ? AND mo.family_id = ?').get(id, familyId);
      createdOrders.push(order);
    }

    return res.json({
      success: true,
      orders: createdOrders,
      message: `Se confirmaron y guardaron ${createdOrders.length} orden(es) médica(s) pendientes de agendar.`
    });
  } catch (error: any) {
    console.error('Error confirmando órdenes médicas:', error);
    return res.status(500).json({ error: 'Error guardando las órdenes médicas confirmadas.' });
  }
});

// POST / - Create order (manual or with files)
router.post('/', secureUpload.array('files', 10), (req: AuthRequest, res) => {
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

    const files = (req.files as Express.Multer.File[]) || [];
    const cleanTitle = title.trim();
    const cleanDesc = description && typeof description === 'string' ? description.trim() : null;
    const cleanType = order_type && typeof order_type === 'string' ? order_type.trim() : 'examen';

    const createdOrders: any[] = [];

    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const mimeType = file.mimetype;
        const safeFilename = path.basename(file.filename);
        const fileUrl = `/api/uploads/${safeFilename}`;
        const fileType = mimeType.includes('pdf') ? 'pdf' : 'image';

        const id = uuidv4();
        const orderTitle = files.length > 1 ? `${cleanTitle} (${i + 1})` : cleanTitle;

        db.prepare(`
          INSERT INTO medical_orders (id, family_id, appointment_id, patient_id, order_type, title, description, file_url, file_type, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
        `).run([
          id,
          familyId,
          appointment_id,
          patient_id,
          cleanType,
          orderTitle,
          cleanDesc,
          fileUrl,
          fileType
        ]);

        const order = db.prepare('SELECT mo.*, p.name as patient_name FROM medical_orders mo JOIN patients p ON mo.patient_id = p.id WHERE mo.id = ? AND mo.family_id = ?').get(id, familyId);
        createdOrders.push(order);
      }
    } else {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO medical_orders (id, family_id, appointment_id, patient_id, order_type, title, description, file_url, file_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pendiente')
      `).run([
        id,
        familyId,
        appointment_id,
        patient_id,
        cleanType,
        cleanTitle,
        cleanDesc
      ]);

      const order = db.prepare('SELECT mo.*, p.name as patient_name FROM medical_orders mo JOIN patients p ON mo.patient_id = p.id WHERE mo.id = ? AND mo.family_id = ?').get(id, familyId);
      createdOrders.push(order);
    }

    return res.json(createdOrders.length === 1 ? createdOrders[0] : createdOrders);
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
