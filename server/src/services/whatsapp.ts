import dotenv from 'dotenv';

dotenv.config();

export async function sendWhatsAppMessage(toPhone: string, text: string): Promise<boolean> {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  const evolutionApiKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

  if (!evolutionApiKey) {
    console.warn('⚠️ EVOLUTION_API_KEY no configurada. Mensajes de WhatsApp deshabilitados.');
    return false;
  }

  try {
    const cleanPhone = toPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.startsWith('57') ? cleanPhone : `57${cleanPhone}`;

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

