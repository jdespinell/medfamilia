import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { summarizeExamResult } from '../services/gemini.js';

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
    cb(null, `exam-${Date.now()}-${uuidv4()}${ext}`);
  },
});

const upload = multer({ storage });
const router = Router();
router.use(authMiddleware);

// List exam results
router.get('/', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { patient_id } = req.query;

  let query = `
    SELECT e.*, p.name as patient_name, p.color as patient_color
    FROM exam_results e
    JOIN patients p ON e.patient_id = p.id
    WHERE e.family_id = ?
  `;
  const params: any[] = [familyId];

  if (patient_id && patient_id !== 'all') {
    query += ` AND e.patient_id = ?`;
    params.push(patient_id);
  }

  query += ` ORDER BY e.created_at DESC`;

  const exams = db.prepare(query).all(params) as any[];
  return res.json(exams);
});

// Upload and analyze exam result with Gemini AI
router.post('/upload', upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { patient_id, appointment_id, title } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo de examen.' });
    }
    if (!patient_id || !title) {
      return res.status(400).json({ error: 'Paciente y título del examen son requeridos.' });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    const fileUrl = `/uploads/${req.file.filename}`;
    const fileType = mimeType.includes('pdf') ? 'pdf' : 'image';

    // Summarize using Gemini AI
    let summaryAi = 'No se generó resumen automático.';
    try {
      summaryAi = await summarizeExamResult(filePath, mimeType);
    } catch (aiErr: any) {
      console.error('Error generando resumen de examen con Gemini:', aiErr);
      summaryAi = 'Nota: No se pudo conectar con la API de Gemini para generar el resumen automático. Sin embargo, el archivo se ha guardado correctamente.';
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO exam_results (id, family_id, patient_id, appointment_id, title, file_url, file_type, summary_ai)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run([
      id,
      familyId,
      patient_id,
      appointment_id || null,
      title,
      fileUrl,
      fileType,
      summaryAi
    ]);

    const examResult = db.prepare('SELECT * FROM exam_results WHERE id = ?').get(id);

    // If linked to appointment, update appointment status to 'completada'
    if (appointment_id) {
      db.prepare("UPDATE appointments SET status = 'completada' WHERE id = ?").run(appointment_id);
    }

    return res.json(examResult);
  } catch (error) {
    console.error('Error subiendo resultado de examen:', error);
    return res.status(500).json({ error: 'Error procesando el resultado del examen.' });
  }
});

// Delete exam result
router.delete('/:id', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { id } = req.params;

  db.prepare('DELETE FROM exam_results WHERE id = ? AND family_id = ?').run(id, familyId);
  return res.json({ message: 'Resultado de examen eliminado correctamente.' });
});

export default router;
