import webpush from 'web-push';
import path from 'path';
import fs from 'fs';
import db from '../database/db.js';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const vapidFilePath = path.join(dataDir, 'vapid.json');
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:contacto@medfamilia.app';

let activePublicKey: string | null = null;
let activePrivateKey: string | null = null;
let isPushConfigured = false;

function initVapidKeys() {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();

  // Try environment variables first
  if (envPub && envPriv) {
    try {
      webpush.setVapidDetails(vapidEmail, envPub, envPriv);
      activePublicKey = envPub;
      activePrivateKey = envPriv;
      isPushConfigured = true;
      console.log('✅ Notificaciones Push configuradas desde variables de entorno.');
      return;
    } catch (err: any) {
      console.warn('⚠️ Claves VAPID en variables de entorno no válidas:', err.message);
    }
  }

  // Fallback: check or generate persisted keys in data/vapid.json
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(vapidFilePath)) {
      const saved = JSON.parse(fs.readFileSync(vapidFilePath, 'utf8'));
      if (saved.publicKey && saved.privateKey) {
        webpush.setVapidDetails(vapidEmail, saved.publicKey, saved.privateKey);
        activePublicKey = saved.publicKey;
        activePrivateKey = saved.privateKey;
        isPushConfigured = true;
        console.log('✅ Notificaciones Push cargadas desde archivo persistente (data/vapid.json).');
        return;
      }
    }

    // Auto-generate fresh valid VAPID keys
    const generated = webpush.generateVAPIDKeys();
    fs.writeFileSync(vapidFilePath, JSON.stringify(generated, null, 2), 'utf8');
    webpush.setVapidDetails(vapidEmail, generated.publicKey, generated.privateKey);
    activePublicKey = generated.publicKey;
    activePrivateKey = generated.privateKey;
    isPushConfigured = true;
    console.log('✨ Claves VAPID auto-generadas y guardadas en data/vapid.json con éxito.');
  } catch (err: any) {
    console.warn('⚠️ Error auto-generando/cargando VAPID keys en data/vapid.json:', err.message);
  }
}

initVapidKeys();

export function getVapidPublicKey() {
  return isPushConfigured ? activePublicKey : null;
}

export async function sendNotificationToFamily(
  familyId: string,
  payload: { title: string; body: string; icon?: string; url?: string }
): Promise<{ sent: number; failed: number }> {
  if (!isPushConfigured) {
    return { sent: 0, failed: 0 };
  }

  const subscriptions = db.prepare('SELECT * FROM push_subscriptions WHERE family_id = ?').all(familyId) as any[];
  let sent = 0;
  let failed = 0;

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
      sent++;
    } catch (err: any) {
      failed++;
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND family_id = ?').run(sub.id, familyId);
      } else {
        console.error('Error enviando notificación push:', err.message || err);
      }
    }
  }

  return { sent, failed };
}


