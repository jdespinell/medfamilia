import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Register new family group
router.post('/register', async (req, res) => {
  try {
    const { name, code, password } = req.body;

    if (!name || typeof name !== 'string' || !code || typeof code !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Nombre de familia, código y contraseña son requeridos y deben ser textos válidos.' });
    }

    const cleanName = name.trim();
    const cleanCode = code.toLowerCase().trim();

    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'El nombre de la familia debe tener al menos 2 caracteres.' });
    }

    if (cleanCode.length < 3 || !/^[a-z0-9_-]+$/.test(cleanCode)) {
      return res.status(400).json({ error: 'El código de familia debe tener al menos 3 caracteres alfanuméricos.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // Check if code exists
    const existing = db.prepare('SELECT id FROM families WHERE code = ?').get(cleanCode);
    if (existing) {
      return res.status(400).json({ error: 'Este código de familia ya está registrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const familyId = uuidv4();

    db.prepare('INSERT INTO families (id, code, name, password_hash) VALUES (?, ?, ?, ?)').run([
      familyId,
      cleanCode,
      cleanName,
      passwordHash
    ]);

    // Create default initial patients: Papá y Mamá
    const papaId = uuidv4();
    const mamaId = uuidv4();
    db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run(
      papaId, familyId, 'Papá', 'Padre', '#3b82f6'
    );
    db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run(
      mamaId, familyId, 'Mamá', 'Madre', '#10b981'
    );

    const token = generateToken({ id: familyId, code: cleanCode, name: cleanName });

    return res.json({
      message: 'Familia registrada con éxito.',
      token,
      family: { id: familyId, code: cleanCode, name: cleanName }
    });
  } catch (error) {
    console.error('Error registrando familia:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { code, password } = req.body;

    if (!code || typeof code !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Código de familia y contraseña requeridos.' });
    }

    const cleanCode = code.toLowerCase().trim();
    const family = db.prepare('SELECT * FROM families WHERE code = ?').get(cleanCode) as any;

    if (!family) {
      return res.status(401).json({ error: 'Código de familia o contraseña incorrectos.' });
    }

    const validPassword = await bcrypt.compare(password, family.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Código de familia o contraseña incorrectos.' });
    }

    const token = generateToken({ id: family.id, code: family.code, name: family.name });

    return res.json({
      token,
      family: { id: family.id, code: family.code, name: family.name }
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Get current session info
router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  return res.json({ family: req.family });
});

export default router;

