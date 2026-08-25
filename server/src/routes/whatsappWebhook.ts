import { Router, Request, Response } from 'express';
import { sendWhatsAppMessage, ensureWhatsAppWebhook } from '../services/whatsapp.js';
import { extractAppointmentFromText } from '../services/gemini.js';
import db from '../database/db.js';

const router = Router();

function getLocalTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString('es-CO', { hour12: false, timeZone: 'America/Bogota' });
}

router.use((req, res, next) => {
  if (req.url !== '/webhook') {
    console.log(`[${getLocalTimestamp()}] 🌐 [WhatsApp Route Hit] ${req.method} ${req.originalUrl || req.url}`);
  }
  next();
});

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
 * Connection Status Route
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'medfamilia_whatsapp_key_2026';
    const adminKey = req.query.key;

    if (adminKey !== EVOLUTION_API_KEY) {
      return res.status(401).json({ error: 'Acceso no autorizado.' });
    }

    const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
    const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

    const response = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${INSTANCE_NAME}`, {
      headers: { apikey: EVOLUTION_API_KEY }
    });

    const data = await response.json() as any;
    const state = data?.instance?.state || data?.state || 'unknown';

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Estado de WhatsApp - MedFamilia</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #f3f4f6; margin: 0; padding: 20px; text-align: center; }
          .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); max-width: 400px; }
          .status { font-size: 20px; font-weight: bold; padding: 10px 20px; border-radius: 8px; margin: 15px 0; text-transform: uppercase; }
          .open { background: #dcfce7; color: #15803d; }
          .close { background: #fee2e2; color: #b91c1c; }
          .connecting { background: #fef3c7; color: #b45309; }
          .btn { display: inline-block; margin-top: 15px; padding: 10px 20px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: bold; }
          .btn-danger { background: #dc2626; margin-left: 10px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🩺 Estado de WhatsApp</h2>
          <div class="status ${state}">${state === 'open' ? '✅ CONECTADO Y ACTIVO' : state === 'connecting' ? '🔄 CONECTANDO...' : '🛑 DESCONECTADO'}</div>
          <p>Estado actual de la sesión: <b>${state}</b></p>
          ${state !== 'open' ? '<a href="/api/whatsapp/pairing-code?key=' + EVOLUTION_API_KEY + '&number=573001234567" class="btn">📲 Vincular Nuevamente</a> <a href="/api/whatsapp/reset?key=' + EVOLUTION_API_KEY + '" class="btn btn-danger">🧹 Limpiar Sesión</a>' : ''}
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    return res.status(500).send(`<h2>Error consultando estado:</h2><p>${err.message}</p>`);
  }
});

/**
 * Clean Reset Instance Route (Purges stale Baileys session keys)
 */
router.get('/reset', async (req: Request, res: Response) => {
  try {
    const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'medfamilia_whatsapp_key_2026';
    const adminKey = req.query.key;

    if (adminKey !== EVOLUTION_API_KEY) {
      return res.status(401).send('<h2>🛑 Acceso No Autorizado</h2>');
    }

    const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
    const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

    // 1. Logout & Delete old instance session
    await fetch(`${EVOLUTION_API_URL}/instance/logout/${INSTANCE_NAME}`, {
      method: 'DELETE',
      headers: { apikey: EVOLUTION_API_KEY }
    }).catch(() => {});

    await fetch(`${EVOLUTION_API_URL}/instance/delete/${INSTANCE_NAME}`, {
      method: 'DELETE',
      headers: { apikey: EVOLUTION_API_KEY }
    }).catch(() => {});

    await new Promise((r) => setTimeout(r, 2000));

    // 2. Re-create clean instance
    await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        instanceName: INSTANCE_NAME,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true
      })
    });

    // 3. Re-configure webhook
    await ensureWhatsAppWebhook();

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Reset Exitoso - MedFamilia</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #f3f4f6; margin: 0; padding: 20px; text-align: center; }
          .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); max-width: 420px; }
          h2 { color: #059669; margin-top: 0; }
          p { color: #4b5563; font-size: 14px; line-height: 1.5; }
          .btn { display: inline-block; margin-top: 15px; padding: 12px 24px; background: #2563eb; color: white; border-radius: 8px; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>✅ Sesión Limpiada Correctamente</h2>
          <p>Se eliminaron las claves temporales viejas que causaban el conflicto de conexión en WhatsApp.</p>
          <a href="/api/whatsapp/pairing-code?key=${EVOLUTION_API_KEY}&number=573001234567" class="btn">📲 Generar Nuevo Código</a>
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    return res.status(500).send(`<h2>Error reiniciando:</h2><p>${err.message}</p>`);
  }
});

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

const processedMessageIds = new Set<string>();

function isDuplicateMessage(msgId?: string): boolean {
  if (!msgId) return false;
  if (processedMessageIds.has(msgId)) {
    return true;
  }
  processedMessageIds.add(msgId);
  setTimeout(() => processedMessageIds.delete(msgId), 5 * 60 * 1000);
  return false;
}

/**
 * Webhook Endpoint para recibir eventos y mensajes entrantes de Evolution API
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const eventData = req.body;
    const eventType = (eventData?.event || '').toString().toLowerCase();

    if (eventType === 'messages.upsert' || eventType === 'messages_upsert') {
      const messageObj = eventData.data;
      const remoteJid = messageObj?.key?.remoteJid;
      const fromMe = messageObj?.key?.fromMe;
      const messageId = messageObj?.key?.id;
      const pushName = messageObj?.pushName || 'Usuario';

      if (fromMe || !remoteJid) {
        return res.sendStatus(200);
      }

      if (isDuplicateMessage(messageId)) {
        return res.sendStatus(200);
      }

      const senderJid = messageObj?.key?.remoteJid || messageObj?.key?.remoteJidAlt || '';
      const cleanDigits = senderJid.replace(/@.*$/, '').replace(/\D/g, '');
      const formattedPhone = cleanDigits.length === 10 ? `57${cleanDigits}` : cleanDigits;

      const userText = messageObj?.message?.conversation || 
                       messageObj?.message?.extendedTextMessage?.text ||
                       messageObj?.message?.imageMessage?.caption ||
                       messageObj?.message?.documentMessage?.caption ||
                       '[Archivo Adjunto / Imagen / PDF]';

      console.log(`\n[${getLocalTimestamp()}] 💬 [WhatsApp Entrante] De: +${formattedPhone} (${pushName}) | Mensaje: "${userText}"`);

      // 1. PASO 1 (0 TOKENS): Buscar si el número emisor está registrado en alguna familia activa
      let familyMatch = db.prepare('SELECT family_id FROM family_whatsapp_numbers WHERE phone_number = ?').get(formattedPhone) as any;
      if (!familyMatch) {
        familyMatch = db.prepare('SELECT id as family_id, name FROM families WHERE phone_number = ?').get(formattedPhone) as any;
      } else {
        const familyObj = db.prepare('SELECT name FROM families WHERE id = ?').get(familyMatch.family_id) as any;
        if (familyObj) familyMatch.name = familyObj.name;
      }

      // 2. PASO 2 (0 TOKENS): Si NO es usuario registrado -> Mensaje automático comercial / invitación a registrarse
      if (!familyMatch) {
        if (userText) {
          console.log(`[${getLocalTimestamp()}] ⚡ [Flujo: No Registrado] 0 Tokens IA usados. Enviando mensaje comercial de ventas a +${formattedPhone}`);
          const sent = await sendWhatsAppMessage(
            formattedPhone,
            `👋 *¡Hola! Bienvenido a MedFamilia SaaS* 🩺\n\nOrganiza la salud y citas de toda tu familia con *Inteligencia Artificial*:\n\n✨ *Agendamiento automático:* Envía una foto o PDF de tus órdenes médicas.\n✨ *Análisis de laboratorio:* Envía fotos de exámenes para resúmenes amigables.\n✨ *Calendarios:* Sincronización automática con Google Calendar.\n\n📲 *¡Comienza tu prueba gratuita hoy!*\nRegístrate o conecta tu número aquí:\n👉 https://medfamilia.app\n\n_(Si ya tienes cuenta, agrega este celular en la sección de Ajustes ➔ Números Autorizados)._`
          );
          if (sent) {
            console.log(`[${getLocalTimestamp()}] ✅ [Respuesta Enviada] Mensaje comercial entregado exitosamente por WhatsApp a +${formattedPhone}`);
          }
        }
        return res.sendStatus(200);
      }

      const familyId = familyMatch.family_id;
      const familyName = familyMatch.name || 'Familia';
      console.log(`[${getLocalTimestamp()}] 🔑 [Familia Identificada] Pertenece a: "${familyName}" (ID: ${familyId})`);

      if (userText) {
        const textLower = userText.toLowerCase().trim();

        // A) MENU DE OPCIONES (0 TOKENS IA)
        if (textLower === 'hola' || textLower === 'ayuda' || textLower === 'menu' || textLower === 'opciones') {
          console.log(`[${getLocalTimestamp()}] ⚡ [Flujo: Menú Interactivo] 0 Tokens IA usados. Enviando menú estático a +${formattedPhone}`);
          const sent = await sendWhatsAppMessage(
            formattedPhone,
            `🩺 *¡Hola ${familyName}! Bienvenido a MedFamilia*\n\nSoy tu asistente médico familiar con Inteligencia Artificial.\n\n📌 *¿Cómo puedo ayudarte hoy?*\n\n1️⃣ *Agendar Cita con Foto o PDF:* Envíame la foto de tu orden médica o examen.\n2️⃣ *Analizar Examen:* Envíame una foto de tus resultados de laboratorio para darte un resumen.\n3️⃣ *Agendar por Texto:* Escríbeme datos de tu cita (ej: *"Cita con el Cardiólogo mañana a las 8am en la Clínica del Country"*).\n4️⃣ *Ver Mis Citas:* Escribe *"ver citas"* o ingresa a https://medfamilia.app`
          );
          if (sent) {
            console.log(`[${getLocalTimestamp()}] ✅ [Respuesta Enviada] Menú de opciones entregado exitosamente por WhatsApp a +${formattedPhone}`);
          }
          return res.sendStatus(200);
        }

        // B) CONSULTAR PRÓXIMAS CITAS (0 TOKENS IA)
        const isListRequest = 
          textLower === '4' ||
          textLower.includes('ver mis') ||
          textLower.includes('mis citas') ||
          textLower.includes('proximas citas') ||
          textLower.includes('ver citas') ||
          textLower.includes('consultar citas') ||
          textLower === 'citas';

        if (isListRequest) {
          console.log(`[${getLocalTimestamp()}] ⚡ [Flujo: Consultar Citas] 0 Tokens IA usados. Consultando próximas citas para +${formattedPhone}`);

          const nowIso = new Date().toISOString();
          const upcoming = db.prepare(`
            SELECT a.title, a.date_time, a.specialty, a.specialist, a.location, a.requires_fasting, p.name as patient_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.family_id = ? AND a.date_time >= ? AND a.status != 'cancelada'
            ORDER BY a.date_time ASC
            LIMIT 5
          `).all(familyId, nowIso) as any[];

          let replyMsg = `🩺 *Próximas Citas Médicas - ${familyName}*\n\n`;

          if (upcoming.length === 0) {
            replyMsg += `No tienes citas médicas pendientes agendadas por el momento.\n\n💡 *¿Deseas agendar una?*\nEnvíame una foto u orden médica por aquí, o ingresa a la App Web: https://medfamilia.app`;
          } else {
            upcoming.forEach((app: any, idx: number) => {
              const d = new Date(app.date_time);
              const dateFormatted = d.toLocaleString('es-ES', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
              });

              replyMsg += `${idx + 1}️⃣ *${app.title}* (${app.patient_name})\n`;
              replyMsg += `📅 ${dateFormatted}\n`;
              if (app.specialist) replyMsg += `👨‍⚕️ Especialista: ${app.specialist}\n`;
              if (app.location) replyMsg += `🏥 Lugar: ${app.location}\n`;
              if (app.requires_fasting) replyMsg += `⚠️ *REQUIERE AYUNO*\n`;
              replyMsg += `-------------------------\n`;
            });
            replyMsg += `📲 Ver todas en la App Web: https://medfamilia.app`;
          }

          const sent = await sendWhatsAppMessage(formattedPhone, replyMsg);
          if (sent) {
            console.log(`[${getLocalTimestamp()}] ✅ [Respuesta Enviada] Lista de próximas citas entregada por WhatsApp a +${formattedPhone}`);
          }
          return res.sendStatus(200);
        }

        // C) GEMINI IA TOKENS: Solo si el usuario envía texto descriptivo complejo para crear/agendar cita médica
        const allowed = checkAndIncrementAiUsage(familyId);
        if (!allowed) {
          console.log(`[${getLocalTimestamp()}] ⚠️ [Límite Diario] Familia ${familyName} alcanzó la cuota de 15 peticiones de IA por hoy.`);
          await sendWhatsAppMessage(
            formattedPhone,
            `⚠️ *Límite diario de IA alcanzado*\n\nHas alcanzado el límite máximo diario de ${MAX_DAILY_AI_REQUESTS} consultas por IA en WhatsApp para tu cuenta familiar hoy.\n\nPara agendar más citas ingresa directamente en nuestra App Web: https://medfamilia.app`
          );
          return res.sendStatus(200);
        }

        try {
          console.log(`[${getLocalTimestamp()}] 🤖 [Flujo: Gemini IA] Analizando cita médica con Inteligencia Artificial para +${formattedPhone}...`);
          const extracted = await extractAppointmentFromText(userText);
          console.log(`[${getLocalTimestamp()}] ✨ [IA Éxito] Título: "${extracted.title}" | Fecha: "${extracted.date_time}" | Especialidad: "${extracted.specialty}"`);

          const sent = await sendWhatsAppMessage(
            formattedPhone,
            `✅ *Cita Identificada con Éxito*\n\n📌 *Título:* ${extracted.title}\n👩‍⚕️ *Especialidad:* ${extracted.specialty || 'General'}\n📅 *Fecha:* ${extracted.date_time || 'Por confirmar'}\n📍 *Lugar:* ${extracted.location || 'No especificado'}\n\n*MedFamilia*`
          );
          if (sent) {
            console.log(`[${getLocalTimestamp()}] ✅ [Respuesta Enviada] Confirmación de cita por IA enviada por WhatsApp a +${formattedPhone}`);
          }
        } catch (aiErr: any) {
          console.error(`[${getLocalTimestamp()}] ❌ [Error IA] Fallo procesando texto con Gemini:`, aiErr?.message || aiErr);
          await sendWhatsAppMessage(formattedPhone, 'Recibí tu mensaje. Si deseas agendar una cita o analizar un examen, por favor envíame la foto o PDF correspondiente.');
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error(`[${getLocalTimestamp()}] ❌ Error procesando Webhook de WhatsApp:`, error);
    return res.sendStatus(500);
  }
});

export default router;
