import dotenv from 'dotenv';

dotenv.config();

export async function sendWhatsAppMessage(toPhone: string, text: string): Promise<boolean> {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
  const evolutionApiKey = process.env.EVOLUTION_API_KEY || 'medfamilia_whatsapp_key_2026';
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

  try {
    const cleanPhone = toPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `57${cleanPhone}` : cleanPhone;

    const response = await fetch(`${evolutionApiUrl}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey,
      },
      body: JSON.stringify({
        number: formattedPhone,
        text: text,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Error de envío en Evolution API WhatsApp:', errText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error enviando mensaje de WhatsApp:', error);
    return false;
  }
}

export async function sendOtpVerificationCode(toPhone: string, otpCode: string): Promise<boolean> {
  const message = `🩺 *MedFamilia* - Código de Verificación:\n\nTu código para activar tu cuenta es: *${otpCode}*\n\nEste código expira en 10 minutos. Por favor no lo compartas con nadie.`;
  return sendWhatsAppMessage(toPhone, message);
}

export async function sendWhatsAppMedia(
  toPhone: string,
  mediaUrlOrBase64: string,
  mediaType: 'image' | 'document',
  fileName: string,
  caption?: string
): Promise<boolean> {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
  const evolutionApiKey = process.env.EVOLUTION_API_KEY || 'medfamilia_whatsapp_key_2026';
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

  try {
    const cleanPhone = toPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `57${cleanPhone}` : cleanPhone;

    const cleanMedia = mediaUrlOrBase64.startsWith('data:')
      ? mediaUrlOrBase64.replace(/^data:[^;]+;base64,/, '')
      : mediaUrlOrBase64;

    const mimeType = mediaType === 'document' ? 'application/pdf' : 'image/jpeg';

    const response = await fetch(`${evolutionApiUrl}/message/sendMedia/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey,
      },
      body: JSON.stringify({
        number: formattedPhone,
        media: cleanMedia,
        mediatype: mediaType,
        mimetype: mimeType,
        fileName: fileName,
        caption: caption || '',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Error enviando archivo multimedia por WhatsApp:', errText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error enviando media por WhatsApp:', error);
    return false;
  }
}

export async function ensureWhatsAppWebhook(): Promise<boolean> {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL || 'http://evolution-api:8080';
  const evolutionApiKey = process.env.EVOLUTION_API_KEY || 'medfamilia_whatsapp_key_2026';
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

  try {
    const webhookUrl = 'http://medfamilia:3000/api/whatsapp/webhook';
    const response = await fetch(`${evolutionApiUrl}/webhook/set/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey,
      },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE']
        }
      }),
    });

    if (response.ok) {
      console.log(`🔗 Webhook de WhatsApp configurado exitosamente para la instancia ${instanceName} -> ${webhookUrl}`);
      return true;
    } else {
      const txt = await response.text();
      console.warn('⚠️ No se pudo auto-configurar el webhook de WhatsApp:', txt);
      return false;
    }
  } catch (err) {
    console.error('⚠️ Error intentando conectar con Evolution API para Webhook:', err);
    return false;
  }
}
