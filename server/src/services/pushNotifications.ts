import webpush from 'web-push';
import db from '../database/db.js';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:contacto@medfamilia.app';

let isPushConfigured = false;

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
    isPushConfigured = true;
  } catch (err) {
    console.warn('⚠️ Error configurando VAPID keys para notificaciones Push:', err);
  }
} else {
  console.warn('⚠️ Notificaciones Push deshabilitadas: VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY no están definidas en las variables de entorno.');
}

export function getVapidPublicKey() {
  return isPushConfigured ? vapidPublicKey : null;
}

export async function sendNotificationToFamily(familyId: string, payload: { title: string; body: string; icon?: string; url?: string }) {
  if (!isPushConfigured) return;

  const subscriptions = db.prepare('SELECT * FROM push_subscriptions WHERE family_id = ?').all(familyId) as any[];

  for (const sub of subscriptions) {
    try {
      const subscriptionObj = JSON.parse(sub.keys_json);
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: subscriptionObj.keys,
        },
        JSON.stringify(payload)
      );
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND family_id = ?').run(sub.id, familyId);
      } else {
        console.error('Error enviando notificación push:', err);
      }
    }
  }
}

