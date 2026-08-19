import webpush from 'web-push';
import db from '../database/db.js';

const defaultPublicKey = 'BL8k_YAaGFnZCGrTtzyR8ZUwex8epkyC-rrtY7nkZPL2EoFXv1Nt8mZIyNoL67X10YWOReNmQgUg7bGk34PgV6Q';
const defaultPrivateKey = 'rRlt4TVJp4vRnl4XmnKIdfYwJ_qofzrG9lleFYmWiDM';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || defaultPublicKey;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || defaultPrivateKey;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:contacto@medfamilia.app';

let isPushConfigured = false;

try {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
  isPushConfigured = true;
} catch (err) {
  console.warn('⚠️ Error configurando VAPID keys para notificaciones Push:', err);
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
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        console.error('Error enviando notificacion push:', err);
      }
    }
  }
}
