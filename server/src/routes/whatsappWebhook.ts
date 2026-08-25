import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sendWhatsAppMessage, ensureWhatsAppWebhook } from '../services/whatsapp.js';
import { extractAppointmentFromText, processMedicalAssistantQuery, ExtractedAppointmentData } from '../services/gemini.js';
import { syncAppointmentToGoogleCalendar } from '../services/googleCalendar.js';
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

interface PendingAppointmentDraft {
  familyId: string;
  patientId: string;
  patientName: string;
  extracted: ExtractedAppointmentData;
  timestamp: number;
}

const pendingAppointmentDrafts = new Map<string, PendingAppointmentDraft>();

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
            .card { background: white; padding: 30px; border-radius: 16px; shadow-box: 0 10px 25px rgba(0,0,0,0.1); max-width: 420px; }
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

        // A) VERIFICACIÓN DE CONFIRMACIÓN PENDIENTE (0 TOKENS IA)
        const pendingDraft = pendingAppointmentDrafts.get(formattedPhone);
        if (pendingDraft && (Date.now() - pendingDraft.timestamp < 15 * 60 * 1000)) {
          const isConfirm = ['1', 'si', 'sí', 'confirmar', 'ok', 'agendar', 'guardar'].includes(textLower);
          const isCancel = ['2', 'no', 'cancelar', 'descartar'].includes(textLower);

          if (isConfirm) {
            console.log(`[${getLocalTimestamp()}] 🟢 [Confirmación Recibida] Usuario +${formattedPhone} confirmó la cita.`);
            const { extracted, patientId, patientName } = pendingDraft;
            const newAppointmentId = uuidv4();
            const dateVal = extracted.date_time || new Date().toISOString();

            db.prepare(`
              INSERT INTO appointments (
                id, family_id, patient_id, title, appointment_type, specialist, specialty, location, date_time, requires_fasting, prep_instructions, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run([
              newAppointmentId,
              familyId,
              patientId,
              extracted.title,
              'consulta',
              extracted.specialist || null,
              extracted.specialty || 'General',
              extracted.location || null,
              dateVal,
              extracted.requires_fasting ? 1 : 0,
              extracted.prep_instructions || null,
              'pendiente'
            ]);

            // Sync with Google Calendar if patient is connected
            const patientObj = db.prepare('SELECT google_refresh_token FROM patients WHERE id = ?').get(patientId) as any;
            if (patientObj?.google_refresh_token) {
              try {
                const eventId = await syncAppointmentToGoogleCalendar(patientObj.google_refresh_token, {
                  id: newAppointmentId,
                  title: extracted.title,
                  date_time: dateVal,
                  specialist: extracted.specialist,
                  location: extracted.location,
                  patient_name: patientName,
                  requires_fasting: extracted.requires_fasting,
                  prep_instructions: extracted.prep_instructions
                });
                if (eventId) {
                  db.prepare('UPDATE appointments SET google_event_id = ? WHERE id = ?').run(eventId, newAppointmentId);
                }
              } catch (gErr) {
                console.error('Error sincronizando cita con Google Calendar:', gErr);
              }
            }

            pendingAppointmentDrafts.delete(formattedPhone);

            const dateFormatted = new Date(dateVal).toLocaleString('es-ES', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit'
            });

            await sendWhatsAppMessage(
              formattedPhone,
              `🎉 *¡Cita Guardada y Agendada con Éxito!* 🩺\n\n📌 *Título:* ${extracted.title} (${patientName})\n📅 *Fecha y Hora:* ${dateFormatted}\n👩‍⚕️ *Especialidad:* ${extracted.specialty || 'General'}\n📍 *Lugar:* ${extracted.location || 'No especificado'}\n\n✅ *Sincronizada en MedFamilia y Google Calendar.*`
            );
            return res.sendStatus(200);
          }

          if (isCancel) {
            console.log(`[${getLocalTimestamp()}] 🔴 [Cancelación Recibida] Usuario +${formattedPhone} descartó la cita.`);
            pendingAppointmentDrafts.delete(formattedPhone);

            await sendWhatsAppMessage(
              formattedPhone,
              `❌ *Agendamiento Cancelado*\n\nNo se guardó ningún registro en MedFamilia. Si deseas agendar otra cita, envíame los datos nuevamente.`
            );
            return res.sendStatus(200);
          }
        }

        // B) UNICAMENTE SALUDOS Y MENÚS ESTÁTICOS (0 TOKENS IA)
        const isStrictGreeting = ['hola', 'menu', 'menú', 'ayuda', 'opciones', 'inicio'].includes(textLower);

        if (isStrictGreeting) {
          console.log(`[${getLocalTimestamp()}] ⚡ [Flujo: Menú Interactivo] 0 Tokens IA usados. Enviando menú estático a +${formattedPhone}`);
          const sent = await sendWhatsAppMessage(
            formattedPhone,
            `🩺 *¡Hola ${familyName}! Bienvenido a MedFamilia*\n\nSoy tu asistente médico familiar con Inteligencia Artificial.\n\n📌 *¿En qué te puedo ayudar hoy?*\n\n1️⃣ *Agendar Cita con Foto o PDF:* Envíame la foto de tu orden médica o examen.\n2️⃣ *Analizar Examen:* Envíame una foto de tus resultados de laboratorio para darte un resumen.\n3️⃣ *Escribir Cita:* Escríbeme datos de tu cita (ej: *"Cita con el Cardiólogo mañana a las 8am"*).\n4️⃣ *Consultar Citas / Exámenes:* Pregúntame por tus últimas citas o exámenes por aquí.`
          );
          if (sent) {
            console.log(`[${getLocalTimestamp()}] ✅ [Respuesta Enviada] Menú de opciones entregado exitosamente por WhatsApp a +${formattedPhone}`);
          }
          return res.sendStatus(200);
        }

        // C) TODAS LAS DEMÁS PREGUNTAS Y TEXTOS EN LENGUAJE NATURAL PASAN POR LA IA DE GEMINI
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
          console.log(`[${getLocalTimestamp()}] 🤖 [Flujo: Asistente Gemini IA] Consultando Inteligencia Artificial con contexto de la familia para +${formattedPhone}...`);

          // Fetch full family context for Gemini AI
          const patients = db.prepare('SELECT id, name FROM patients WHERE family_id = ? ORDER BY created_at ASC').all(familyId) as any[];
          const upcomingAppointments = db.prepare(`
            SELECT a.title, a.date_time, p.name as patient_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.family_id = ? AND a.date_time >= datetime('now') AND a.status != 'cancelada'
            ORDER BY a.date_time ASC LIMIT 5
          `).all(familyId) as any[];

          const recentExams = db.prepare(`
            SELECT e.title, e.summary_ai, e.created_at, p.name as patient_name
            FROM exam_results e
            JOIN patients p ON e.patient_id = p.id
            WHERE e.family_id = ?
            ORDER BY e.created_at DESC LIMIT 5
          `).all(familyId) as any[];

          const aiResult = await processMedicalAssistantQuery(userText, {
            familyName,
            patients,
            upcomingAppointments,
            recentExams
          });

          if (aiResult.intent === 'appointment' && aiResult.appointmentData) {
            const extracted = aiResult.appointmentData;
            console.log(`[${getLocalTimestamp()}] ✨ [IA Detección Cita] Título: "${extracted.title}" | Fecha: "${extracted.date_time}" | Especialidad: "${extracted.specialty}"`);

            const patientId = patients[0]?.id || uuidv4();
            const patientName = patients[0]?.name || 'Familiar';

            pendingAppointmentDrafts.set(formattedPhone, {
              familyId,
              patientId,
              patientName,
              extracted: {
                ...extracted,
                date_time: extracted.date_time || new Date().toISOString()
              },
              timestamp: Date.now()
            });

            const dateVal = extracted.date_time || new Date().toISOString();
            const dateFormatted = new Date(dateVal).toLocaleString('es-ES', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit'
            });

            const confirmationMsg = `📋 *CONFIRMACIÓN DE CITA MÉDICA*\n\nIdentifiqué los siguientes datos:\n\n📌 *Cita:* ${extracted.title}\n👤 *Paciente:* ${patientName}\n👩‍⚕️ *Especialidad:* ${extracted.specialty || 'General'}\n📅 *Fecha y Hora:* ${dateFormatted}\n📍 *Lugar:* ${extracted.location || 'No especificado'}\n⚠️ *Ayuno:* ${extracted.requires_fasting ? 'Sí (Requiere Ayuno)' : 'No'}\n\n------------------------------------\n👇 *¿Deseas confirmar y guardar esta cita?*\n1️⃣ Escribe *1* o *SI* para Confirmar y Agendar\n2️⃣ Escribe *2* o *CANCELAR* para Descartar`;

            await sendWhatsAppMessage(formattedPhone, confirmationMsg);
            console.log(`[${getLocalTimestamp()}] 📋 [Solicitud Confirmación Enviada] Borrador de cita enviado a +${formattedPhone}`);
          } else {
            // General Conversational AI Answer (Exam results, appointments info, health advice)
            const answer = aiResult.answerText || 'Recibí tu consulta. Para agendar una cita o analizar un examen, por favor envíame la foto o PDF correspondiente.';
            console.log(`[${getLocalTimestamp()}] ✨ [IA Respuesta Inteligente] Entregando respuesta conversacional a +${formattedPhone}`);

            await sendWhatsAppMessage(formattedPhone, answer);
            console.log(`[${getLocalTimestamp()}] ✅ [Respuesta Enviada] Respuesta conversacional de Gemini enviada por WhatsApp a +${formattedPhone}`);
          }
        } catch (aiErr: any) {
          console.error(`[${getLocalTimestamp()}] ❌ [Error IA] Fallo procesando consulta con Gemini:`, aiErr?.message || aiErr);
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
