import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getVapidPublicKey } from '../services/pushNotifications.js';

const router = Router();
router.use(authMiddleware);

// Get VAPID Public Key for client subscription
router.get('/vapid-key', (req, res) => {
  return res.json({ publicKey: getVapidPublicKey() });
});

// Save client subscription
router.post('/subscribe', (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { subscription } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Suscripción Push inválida.' });
  }

  const endpoint = subscription.endpoint;
  const keysJson = JSON.stringify(subscription);

  // Check if exists
  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);

  if (!existing) {
    const id = uuidv4();
    db.prepare('INSERT INTO push_subscriptions (id, family_id, endpoint, keys_json) VALUES (?, ?, ?, ?)').run(
      id,
      familyId,
      endpoint,
      keysJson
    );
  }

  return res.json({ message: 'Suscripción Push registrada con éxito.' });
});

export default router;
