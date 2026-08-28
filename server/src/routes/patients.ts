import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { validateBody, validateParams, validateRequest, v } from '../middleware/validation.js';

const router = Router();

router.use(authMiddleware);

// List patients for current family
router.get('/', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const patients = db.prepare('SELECT id, family_id, name, relationship, color, google_calendar_id, google_refresh_token, created_at FROM patients WHERE family_id = ? ORDER BY name ASC').all(familyId) as any[];
    const sanitized = patients.map((p) => {
      const { google_refresh_token, ...rest } = p;
      return {
        ...rest,
        is_google_connected: Boolean(google_refresh_token),
      };
    });
    return res.json(sanitized);
  } catch (error) {
    console.error('Error listando pacientes:', error);
    return res.status(500).json({ error: 'Error al consultar pacientes.' });
  }
});

// Create new patient
router.post(
  '/',
  validateBody({
    name: v.string({ min: 1, max: 100 }),
    relationship: v.string({ min: 1, max: 50, optional: true, default: 'Familiar' }),
    color: v.hexColor({ optional: true, default: '#3b82f6' }),
  }),
  (req: AuthRequest, res) => {
    try {
      const familyId = req.family!.id;
      const { name, relationship, color } = req.body;

      const cleanName = name.trim();
      const cleanRelationship = typeof relationship === 'string' && relationship.trim() ? relationship.trim() : 'Familiar';
      const patientColor = typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#3b82f6';

      const id = uuidv4();

      db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run([
        id, familyId, cleanName, cleanRelationship, patientColor
      ]);

      const patient = db.prepare('SELECT id, family_id, name, relationship, color, google_calendar_id, google_refresh_token, created_at FROM patients WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      const { google_refresh_token, ...rest } = patient || {};
      return res.json({
        ...rest,
        is_google_connected: Boolean(google_refresh_token),
      });
    } catch (error) {
      console.error('Error creando paciente:', error);
      return res.status(500).json({ error: 'Error al registrar paciente.' });
    }
  }
);

// Update patient
router.put(
  '/:id',
  validateRequest({
    params: {
      id: v.uuid(),
    },
    body: {
      name: v.string({ min: 1, max: 100, optional: true }),
      relationship: v.string({ min: 1, max: 50, optional: true }),
      color: v.hexColor({ optional: true }),
    },
  }),
  (req: AuthRequest, res) => {
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

      const updated = db.prepare('SELECT id, family_id, name, relationship, color, google_calendar_id, google_refresh_token, created_at FROM patients WHERE id = ? AND family_id = ?').get(id, familyId) as any;
      const { google_refresh_token, ...rest } = updated || {};
      return res.json({
        ...rest,
        is_google_connected: Boolean(google_refresh_token),
      });
    } catch (error) {
      console.error('Error actualizando paciente:', error);
      return res.status(500).json({ error: 'Error al actualizar información del paciente.' });
    }
  }
);

// Delete patient
router.delete(
  '/:id',
  validateParams({
    id: v.uuid(),
  }),
  (req: AuthRequest, res) => {
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
  }
);

export default router;

