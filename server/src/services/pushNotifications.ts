import webpush from 'web-push';
import db from '../database/db.js';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-m9GYv50D-1Wq_S8gP0hM-tG73V5xN3mE73v2x';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'uK7V26372_8123h12k3j7123981273912389123891';
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:contacto@medfamilia.app';

webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);

export function getVapidPublicKey() {
  return vapidPublicKey;
}

export async function sendNotificationToFamily(familyId: string, payload: { title: string; body: string; icon?: string; url?: string }) {
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
        // Expired subscription, remove from DB
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        console.error('Error enviando notificacion push:', err);
      }
    }
  }
}
