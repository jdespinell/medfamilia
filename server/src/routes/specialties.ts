import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// Get list of specialties (defaults + family custom)
router.get('/', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const specialties = db.prepare(`
      SELECT * FROM specialties
      WHERE family_id IS NULL OR family_id = ?
      ORDER BY name ASC
    `).all([familyId]) as any[];

    return res.json(specialties);
  } catch (error) {
    console.error('Error listando especialidades:', error);
    return res.status(500).json({ error: 'Error al consultar especialidades.' });
  }
});

// Add new custom specialty for the family
router.post('/', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'El nombre de la especialidad es requerido y debe ser un texto válido.' });
    }

    const cleanName = name.trim();
    if (cleanName.length > 100) {
      return res.status(400).json({ error: 'El nombre de la especialidad es demasiado largo.' });
    }

    // Check if exists
    const existing = db.prepare(`
      SELECT * FROM specialties
      WHERE (family_id IS NULL OR family_id = ?) AND LOWER(name) = LOWER(?)
    `).get([familyId, cleanName]);

    if (existing) {
      return res.json(existing);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO specialties (id, family_id, name) VALUES (?, ?, ?)').run([id, familyId, cleanName]);

    const newSpec = db.prepare('SELECT * FROM specialties WHERE id = ?').get(id);
    return res.json(newSpec);
  } catch (error) {
    console.error('Error agregando especialidad:', error);
    return res.status(500).json({ error: 'Error al guardar la especialidad.' });
  }
});

export default router;

