import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// Get list of authorized WhatsApp numbers for the current family (Max 4)
router.get('/', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    // SQLite / PostgreSQL compatible query depending on engine
    let numbers: any[] = [];
    try {
      numbers = db.prepare('SELECT * FROM family_whatsapp_numbers WHERE family_id = ? ORDER BY created_at ASC').all(familyId) as any[];
    } catch {
      numbers = [];
    }
    return res.json(numbers);
  } catch (error) {
    console.error('Error obteniendo números de WhatsApp:', error);
    return res.status(500).json({ error: 'Error al consultar números de WhatsApp.' });
  }
});

// Add a new authorized WhatsApp number to the family (Max 4 numbers limit)
router.post('/', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { phone_number, label } = req.body;

    if (!phone_number) {
      return res.status(400).json({ error: 'El número de teléfono celular es requerido.' });
    }

    const cleanPhone = phone_number.replace(/\D/g, '');
    const formattedPhone = cleanPhone.startsWith('57') ? cleanPhone : `57${cleanPhone}`;

    // Check count (Max 4 limit enforcement)
    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM family_whatsapp_numbers WHERE family_id = ?').get(familyId) as any)?.count || 0;
    if (existingCount >= 4) {
      return res.status(400).json({ error: 'Has alcanzado el límite máximo de 4 números de WhatsApp registrados por familia.' });
    }

    // Check if phone already registered by another family
    const exists = db.prepare('SELECT id FROM family_whatsapp_numbers WHERE phone_number = ?').get(formattedPhone);
    if (exists) {
      return res.status(400).json({ error: 'Este número de WhatsApp ya se encuentra registrado en otra familia.' });
    }

    const id = uuidv4();
    const numLabel = label || `Celular ${existingCount + 1}`;

    db.prepare('INSERT INTO family_whatsapp_numbers (id, family_id, phone_number, label) VALUES (?, ?, ?, ?)').run([
      id,
      familyId,
      formattedPhone,
      numLabel
    ]);

    return res.json({
      message: 'Número de WhatsApp registrado con éxito.',
      number: { id, family_id: familyId, phone_number: formattedPhone, label: numLabel }
    });
  } catch (error) {
    console.error('Error registrando número de WhatsApp:', error);
    return res.status(500).json({ error: 'Error al guardar el número de WhatsApp.' });
  }
});

// Remove an authorized WhatsApp number
router.delete('/:id', (req: AuthRequest, res) => {
  try {
    const familyId = req.family!.id;
    const { id } = req.params;

    db.prepare('DELETE FROM family_whatsapp_numbers WHERE id = ? AND family_id = ?').run([id, familyId]);
    return res.json({ message: 'Número de WhatsApp eliminado correctamente.' });
  } catch (error) {
    console.error('Error eliminando número de WhatsApp:', error);
    return res.status(500).json({ error: 'Error al eliminar el número de WhatsApp.' });
  }
});

export default router;
