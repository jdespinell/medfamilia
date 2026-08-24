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
 * Webhook Endpoint para recibir eventos y mensajes entrantes de Evolution API
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const eventData = req.body;

    if (eventData.event === 'messages.upsert') {
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
            `👋 *¡Hola! MedFamilia le da la bienvenida.*\n\nEste número de WhatsApp (${formattedPhone}) no se encuentra registrado en ninguna cuenta activa de MedFamilia.\n\nPara agendar citas o analizar exámenes con IA por WhatsApp, agregue este celular en la sección de números autorizados en su cuenta web o regístrese en: https://tu-dominio.com`
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
            `🩺 *¡Hola! Bienvenido a MedFamilia*\n\nSoy tu asistente médico familiar de IA.\n\n*¿Qué puedes hacer por aquí?*\n1️⃣ Envíame una **foto o archivo PDF** de una orden médica y la agendaré automáticamente.\n2️⃣ Envíame una foto de un **resultado de examen de laboratorio** y te enviaré un resumen amigable.\n3️⃣ Escríbeme detalles de una cita (ej: *"Cita con el Cardiólogo mañana a las 8am"*).\n\nPara ingresar a la App Web: https://tu-dominio.com`
          );
        } else {
          // Check rate limit for AI processing
          const allowed = checkAndIncrementAiUsage(familyId);
          if (!allowed) {
            await sendWhatsAppMessage(
              senderPhone,
              `⚠️ *Límite diario de IA alcanzado*\n\nHas alcanzado el límite máximo diario de ${MAX_DAILY_AI_REQUESTS} consultas por IA en WhatsApp para tu cuenta familiar hoy.\n\nPara registrar más citas o exámenes hoy, por favor ingresa directamente en nuestra App Web: https://tu-dominio.com`
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
