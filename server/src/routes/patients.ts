import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

// List patients for current family
router.get('/', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const patients = db.prepare('SELECT id, family_id, name, relationship, color, google_calendar_id, created_at FROM patients WHERE family_id = ? ORDER BY name ASC').all(familyId) as any[];
    return res.json(patients);
  } catch (error) {
    console.error('Error listando pacientes:', error);
    return res.status(500).json({ error: 'Error al consultar pacientes.' });
  }
});

// Create new patient
router.post('/', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { name, relationship, color } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'El nombre del paciente es requerido y debe ser un texto válido.' });
    }

    const cleanName = name.trim();
    const cleanRelationship = typeof relationship === 'string' && relationship.trim() ? relationship.trim() : 'Familiar';
    const patientColor = typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#3b82f6';

    const id = uuidv4();

    db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run([
      id, familyId, cleanName, cleanRelationship, patientColor
    ]);

    const patient = db.prepare('SELECT id, family_id, name, relationship, color, google_calendar_id, created_at FROM patients WHERE id = ? AND family_id = ?').get(id, familyId);
    return res.json(patient);
  } catch (error) {
    console.error('Error creando paciente:', error);
    return res.status(500).json({ error: 'Error al registrar paciente.' });
  }
});

// Update patient
router.put('/:id', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { id } = req.params;
    const { name, relationship, color } = req.body;

    const existing = db.prepare('SELECT * FROM patients WHERE id = ? AND family_id = ?').get(id, familyId) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Paciente no encontrado o no pertenece a esta familia.' });
    }

    const cleanName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
    const cleanRelationship = typeof relationship === 'string' && relationship.trim() ? relationship.trim() : existing.relationship;
    const patientColor = typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : existing.color;

    db.prepare('UPDATE patients SET name = ?, relationship = ?, color = ? WHERE id = ? AND family_id = ?').run([
      cleanName, cleanRelationship, patientColor, id, familyId
    ]);

    const updated = db.prepare('SELECT id, family_id, name, relationship, color, google_calendar_id, created_at FROM patients WHERE id = ? AND family_id = ?').get(id, familyId);
    return res.json(updated);
  } catch (error) {
    console.error('Error actualizando paciente:', error);
    return res.status(500).json({ error: 'Error al actualizar información del paciente.' });
  }
});

// Delete patient
router.delete('/:id', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { id } = req.params;

    const result = db.prepare('DELETE FROM patients WHERE id = ? AND family_id = ?').run(id, familyId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado o no pertenece a esta familia.' });
    }

    return res.json({ message: 'Paciente eliminado con éxito.' });
  } catch (error) {
    console.error('Error eliminando paciente:', error);
    return res.status(500).json({ error: 'Error al eliminar paciente.' });
  }
});

export default router;

