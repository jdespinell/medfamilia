import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

// List patients for current family
router.get('/', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const patients = db.prepare('SELECT * FROM patients WHERE family_id = ? ORDER BY name ASC').all(familyId) as any[];
  return res.json(patients);
});

// Create new patient
router.post('/', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { name, relationship, color } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'El nombre del paciente es requerido.' });
  }

  const id = uuidv4();
  const patientColor = color || '#3b82f6';

  db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run([
    id, familyId, name, relationship || 'Familiar', patientColor
  ]);

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  return res.json(patient);
});

// Update patient
router.put('/:id', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { id } = req.params;
  const { name, relationship, color } = req.body;

  const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND family_id = ?').get(id, familyId);
  if (!patient) {
    return res.status(404).json({ error: 'Paciente no encontrado.' });
  }

  db.prepare('UPDATE patients SET name = ?, relationship = ?, color = ? WHERE id = ?').run([
    name, relationship, color, id
  ]);

  const updated = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  return res.json(updated);
});

// Delete patient
router.delete('/:id', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { id } = req.params;

  db.prepare('DELETE FROM patients WHERE id = ? AND family_id = ?').run(id, familyId);
  return res.json({ message: 'Paciente eliminado con éxito.' });
});

export default router;
