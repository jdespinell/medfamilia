import dotenv from 'dotenv';

dotenv.config();

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'medfamilia_whatsapp_key_2026';
const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || 'medfamilia-wa';

export async function sendWhatsAppMessage(toPhone: string, text: string): Promise<boolean> {
  try {
    const cleanPhone = toPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.startsWith('57') ? cleanPhone : `57${cleanPhone}`;

    const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY,
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
