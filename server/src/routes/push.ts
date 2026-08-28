import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getVapidPublicKey } from '../services/pushNotifications.js';
import { validateBody, v } from '../middleware/validation.js';

const router = Router();
router.use(authMiddleware);

// Get VAPID Public Key for client subscription
router.get('/vapid-key', (req, res) => {
  return res.json({ publicKey: getVapidPublicKey() });
});

// Save client subscription
router.post(
  '/subscribe',
  validateBody({
    subscription: v.object({
      endpoint: v.url(),
      keys: v.object({
        p256dh: v.string({ min: 1, max: 500 }),
        auth: v.string({ min: 1, max: 500 }),
      }),
    }),
  }),
  (req: AuthRequest, res) => {
    const familyId = req.family!.id;
    const { subscription } = req.body;

    const endpoint = subscription.endpoint.trim();
    const keysJson = JSON.stringify(subscription);

    // Upsert on push_subscriptions: if endpoint exists, re-bind family_id and keys to current authenticated family
    const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as any;

    if (existing) {
      db.prepare('UPDATE push_subscriptions SET family_id = ?, keys_json = ? WHERE id = ?').run(
        familyId,
        keysJson,
        existing.id
      );
    } else {
      const id = uuidv4();
      db.prepare('INSERT INTO push_subscriptions (id, family_id, endpoint, keys_json) VALUES (?, ?, ?, ?)').run(
        id,
        familyId,
        endpoint,
        keysJson
      );
    }

    return res.json({ message: 'Suscripción Push registrada con éxito.' });
  }
);

export default router;
