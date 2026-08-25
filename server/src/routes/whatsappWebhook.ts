import { Router, Request, Response } from 'express';
import { sendWhatsAppMessage } from '../services/whatsapp.js';
import { extractAppointmentFromText } from '../services/gemini.js';
import db from '../database/db.js';

const router = Router();

const MAX_DAILY_AI_REQUESTS = 15; // Maximum AI processing requests per family per day via WhatsApp

function checkAndIncrementAiUsage(familyId: string): boolean {
  try {
    const today = new Date().toISOString().split('T')[0];
    const existing = db.prepare('SELECT request_count FROM whatsapp_ai_usage WHERE family_id = ? AND request_date = ?').get(familyId, today) as any;

    if (!existing) {
      db.prepare('INSERT INTO whatsapp_ai_usage (id, family_id, request_date, request_count) VALUES (?, ?, ?, 1)').run(
        `${familyId}-${today}`, familyId, today
      );
      return true;
    }

    if (existing.request_count >= MAX_DAILY_AI_REQUESTS) {
      return false; // Limit reached!
    }

    db.prepare('UPDATE whatsapp_ai_usage SET request_count = request_count + 1 WHERE family_id = ? AND request_date = ?').run(familyId, today);
    return true;
  } catch (err) {
    console.error('Error verificando límite de uso IA en WhatsApp:', err);
    return true; // Fallback to allow if error
  }
}

/**
 * Visual QR Display Route for scanning WhatsApp in browser
 */
router.get('/qr', async (req: Request, res: Response) => {
  try {
    const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
    const adminKey = req.query.key;

    if (!EVOLUTION_API_KEY || adminKey !== EVOLUTION_API_KEY) {
      return res.status(401).send('<h2>🛑 Acceso No Autorizado</h2><p>Proporcione la clave secreta de administración configurada en la URL: <code>?key=TU_CLAVE_ADMIN</code></p>');
    }

    const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
    const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

    const response = await fetch(`${EVOLUTION_API_URL}/instance/connect/${INSTANCE_NAME}`, {
      headers: { apikey: EVOLUTION_API_KEY }
    });

    const data = await response.json() as any;
    const base64Img = data?.base64 || data?.qrcode?.base64 || data?.code;

    if (base64Img) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Vincular WhatsApp - MedFamilia</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #f3f4f6; margin: 0; padding: 20px; text-align: center; }
            .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); max-width: 400px; }
            img { max-width: 280px; height: auto; border-radius: 8px; border: 1px solid #e5e7eb; padding: 10px; }
            h2 { color: #1e40af; margin-top: 0; }
            p { color: #4b5563; font-size: 14px; line-height: 1.5; }
            .btn { display: inline-block; margin-top: 15px; padding: 10px 20px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>🩺 MedFamilia SaaS</h2>
            <p>Escanea este Código QR desde WhatsApp ➔ <b>Dispositivos vinculados</b> en tu celular:</p>
            <img src="${base64Img.startsWith('data:') ? base64Img : 'data:image/png;base64,' + base64Img}" alt="Código QR de WhatsApp" />
            <br/>
            <a href="javascript:location.reload()" class="btn">🔄 Actualizar QR</a>
          </div>
        </body>
        </html>
      `);
    }

    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Vincular WhatsApp - MedFamilia</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #f3f4f6; margin: 0; padding: 20px; text-align: center; }
          .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); max-width: 400px; }
          h2 { color: #059669; margin-top: 0; }
          p { color: #4b5563; font-size: 14px; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>✅ WhatsApp Conectado</h2>
          <p>La instancia de WhatsApp ya se encuentra vinculada y activa para MedFamilia.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    console.error('Error conectando con Evolution API:', err);
    return res.status(500).send('<h2>Error interno conectando con el servicio de WhatsApp.</h2>');
  }
});

/**
 * Pairing Code Route (No Camera Needed - Numeric/Text Code)
 */
router.get('/pairing-code', async (req: Request, res: Response) => {
  try {
    const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
    const adminKey = req.query.key;
    const phone = (req.query.number as string || '').replace(/\D/g, '');

    if (!EVOLUTION_API_KEY || adminKey !== EVOLUTION_API_KEY) {
      return res.status(401).send('<h2>🛑 Acceso No Autorizado</h2><p>Proporcione la clave secreta de administración configurada en la URL: <code>?key=TU_CLAVE_ADMIN&number=57300...</code></p>');
    }

    if (!phone) {
      return res.status(400).send('<h2>⚠️ Falta el número de celular</h2><p>Agregue su número con código de país en la URL: <code>&number=573001234567</code></p>');
    }

    const formattedPhone = phone.startsWith('57') ? phone : `57${phone}`;
    const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
    const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

    let response = await fetch(`${EVOLUTION_API_URL}/instance/connect/${INSTANCE_NAME}?number=${formattedPhone}`, {
      headers: { apikey: EVOLUTION_API_KEY }
    });

    let data = await response.json() as any;
    let pairingCode = data?.pairingCode || data?.qrcode?.pairingCode;

    // Si la instancia estaba creada en modo QR puro, forzar re-creación con el número telefónico para generar pairingCode
    if (!pairingCode) {
      await fetch(`${EVOLUTION_API_URL}/instance/delete/${INSTANCE_NAME}`, {
        method: 'DELETE',
        headers: { apikey: EVOLUTION_API_KEY }
      }).catch(() => {});

      await new Promise((r) => setTimeout(r, 1500));

      response = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY
        },
        body: JSON.stringify({
          instanceName: INSTANCE_NAME,
          number: formattedPhone,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: false
        })
      });

      data = await response.json() as any;
      pairingCode = data?.pairingCode || data?.qrcode?.pairingCode || data?.code;
    }

    if (!pairingCode && typeof data?.code === 'string' && data.code.length <= 16) {
      pairingCode = data.code;
    }

    if (pairingCode) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Código de Emparejamiento - MedFamilia</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #f3f4f6; margin: 0; padding: 20px; text-align: center; }
            .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); max-width: 420px; }
            .code-box { font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #1e40af; background: #eff6ff; border: 2px dashed #3b82f6; padding: 15px 20px; border-radius: 12px; margin: 20px 0; font-family: monospace; }
            h2 { color: #1e40af; margin-top: 0; }
            ol { text-align: left; color: #374151; font-size: 14px; line-height: 1.6; padding-left: 20px; }
            .btn { display: inline-block; margin-top: 15px; padding: 10px 20px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>🩺 Código de Emparejamiento (Sin Cámara)</h2>
            <p>Escribe este código de 8 caracteres directamente en tu celular:</p>
            <div class="code-box">${pairingCode}</div>
            <ol>
              <li>Abre <b>WhatsApp</b> en tu celular (${formattedPhone}).</li>
              <li>Ve a <b>Dispositivos vinculados</b> ➔ <b>Vincular un dispositivo</b>.</li>
              <li>Toca en <b>"Vincular con número de teléfono"</b> abajo en la pantalla.</li>
              <li>Ingresa el código mostrado arriba.</li>
            </ol>
            <a href="javascript:location.reload()" class="btn">🔄 Generar nuevo código</a>
          </div>
        </body>
        </html>
      `);
    }

    return res.status(400).send(`<h2>No se pudo generar el código. ¿Ya está vinculado?</h2>`);
  } catch (err: any) {
    console.error('Error generando código de emparejamiento WhatsApp:', err);
    return res.status(500).send(`<h2>Error generando el código de emparejamiento.</h2>`);
  }
});

/**
 * Webhook Endpoint para recibir eventos y mensajes entrantes de Evolution API
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    // Validate Webhook Token Header
    const token = (req.headers['x-webhook-token'] || req.headers['apikey'] || req.query.token) as string;
    const expectedToken = process.env.WHATSAPP_WEBHOOK_SECRET || process.env.EVOLUTION_API_KEY;

    if (expectedToken && token !== expectedToken) {
      return res.status(401).json({ error: 'Acceso no autorizado al Webhook.' });
    }

    const eventData = req.body;

    if (eventData?.event === 'messages.upsert') {
      const messageObj = eventData.data;
      const remoteJid = messageObj?.key?.remoteJid;
      const fromMe = messageObj?.key?.fromMe;

      if (fromMe || !remoteJid) {
        return res.sendStatus(200);
      }

      const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      const formattedPhone = senderPhone.startsWith('57') ? senderPhone : `57${senderPhone}`;
      const userText = messageObj?.message?.conversation || messageObj?.message?.extendedTextMessage?.text;

      // Lookup family by multi-number table or main family phone
      let familyMatch = db.prepare('SELECT family_id FROM family_whatsapp_numbers WHERE phone_number = ?').get(formattedPhone) as any;
      if (!familyMatch) {
        familyMatch = db.prepare('SELECT id as family_id FROM families WHERE phone_number = ?').get(formattedPhone) as any;
      }

      if (!familyMatch) {
        if (userText) {
          await sendWhatsAppMessage(
            senderPhone,
            `👋 *¡Hola! MedFamilia le da la bienvenida.*\n\nEste número de WhatsApp (${formattedPhone}) no se encuentra registrado en ninguna cuenta activa de MedFamilia.\n\nPara agendar citas o analizar exámenes con IA por WhatsApp, agregue este celular en la sección de números autorizados en su cuenta web.`
          );
        }
        return res.sendStatus(200);
      }

      const familyId = familyMatch.family_id;

      // 1. Check text commands
      if (userText) {
        const textLower = userText.toLowerCase().trim();

        if (textLower === 'hola' || textLower === 'ayuda' || textLower === 'menu') {
          await sendWhatsAppMessage(
            senderPhone,
            `🩺 *¡Hola! Bienvenido a MedFamilia*\n\nSoy tu asistente médico familiar de IA.\n\n*¿Qué puedes hacer por aquí?*\n1️⃣ Envíame una **foto o archivo PDF** de una orden médica y la agendaré automáticamente.\n2️⃣ Envíame una foto de un **resultado de examen de laboratorio** y te enviaré un resumen amigable.\n3️⃣ Escríbeme detalles de una cita (ej: *"Cita con el Cardiólogo mañana a las 8am"*).`
          );
        } else {
          // Check rate limit for AI processing
          const allowed = checkAndIncrementAiUsage(familyId);
          if (!allowed) {
            await sendWhatsAppMessage(
              senderPhone,
              `⚠️ *Límite diario de IA alcanzado*\n\nHas alcanzado el límite máximo diario de ${MAX_DAILY_AI_REQUESTS} consultas por IA en WhatsApp para tu cuenta familiar hoy.`
            );
            return res.sendStatus(200);
          }

          try {
            const extracted = await extractAppointmentFromText(userText);
            await sendWhatsAppMessage(
              senderPhone,
              `✅ *Cita Identificada con Éxito*\n\n📌 *Título:* ${extracted.title}\n👩‍⚕️ *Especialidad:* ${extracted.specialty || 'General'}\n📅 *Fecha:* ${extracted.date_time || 'Por confirmar'}\n📍 *Lugar:* ${extracted.location || 'No especificado'}\n\n*MedFamilia*`
            );
          } catch (aiErr) {
            await sendWhatsAppMessage(senderPhone, 'Recibí tu mensaje. Si deseas agendar una cita o analizar un examen, por favor envíame la foto o PDF correspondiente.');
          }
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Error procesando Webhook de WhatsApp:', error);
    return res.sendStatus(500);
  }
});

export default router;

