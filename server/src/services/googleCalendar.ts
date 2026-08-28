import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getJwtSecret } from '../middleware/auth.js';
import { decrypt } from './encryption.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export function getOAuth2Client(customRedirectUri?: string) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return null;
  }
  const redirectUri = customRedirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/calendar/callback';
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);
}

export function generateOAuthState(patientId: string, familyId: string): string {
  const payload = {
    patientId,
    familyId,
    nonce: crypto.randomUUID(),
  };
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn: '15m' });
}

export function verifyOAuthState(stateToken: string): { patientId: string; familyId: string; nonce: string } | null {
  try {
    const decoded = jwt.verify(stateToken, getJwtSecret(), { algorithms: ['HS256'] }) as any;
    if (decoded && typeof decoded.patientId === 'string' && typeof decoded.familyId === 'string') {
      return {
        patientId: decoded.patientId,
        familyId: decoded.familyId,
        nonce: decoded.nonce || '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getAuthUrl(patientId: string, familyId: string, customRedirectUri?: string) {
  const oauth2Client = getOAuth2Client(customRedirectUri);
  if (!oauth2Client) return null;

  const state = generateOAuthState(patientId, familyId);

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    prompt: 'consent',
    state: state,
  });
}

export async function syncAppointmentToGoogleCalendar(
  refreshToken: string,
  appointment: {
    id: string;
    title: string;
    patient_name?: string;
    specialist?: string;
    location?: string;
    date_time: string;
    prep_instructions?: string;
    requires_fasting?: boolean;
    google_event_id?: string;
  }
): Promise<string | null> {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client || !refreshToken) {
    return null;
  }

  const plainRefreshToken = decrypt(refreshToken) || refreshToken;
  oauth2Client.setCredentials({ refresh_token: plainRefreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const startTime = new Date(appointment.date_time);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

  const patientTag = appointment.patient_name ? `[${appointment.patient_name}] ` : '';
  const summaryTitle = `🩺 ${patientTag}${appointment.title}`;

  let description = `Cita Médica registrada en MedFamilia.`;
  if (appointment.patient_name) description += `\nPaciente: ${appointment.patient_name}`;
  if (appointment.specialist) description += `\nEspecialista: ${appointment.specialist}`;
  if (appointment.requires_fasting) description += `\n⚠️ REQUIERE AYUNO`;
  if (appointment.prep_instructions) description += `\nIndicaciones: ${appointment.prep_instructions}`;

  const event = {
    summary: summaryTitle,
    location: appointment.location || '',
    description: description,
    start: {
      dateTime: startTime.toISOString(),
    },
    end: {
      dateTime: endTime.toISOString(),
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 24 * 60 },
        { method: 'popup', minutes: 2 * 60 },
      ],
    },
  };

  try {
    if (appointment.google_event_id) {
      const res = await calendar.events.update({
        calendarId: 'primary',
        eventId: appointment.google_event_id,
        requestBody: event,
      });
      return res.data.id || appointment.google_event_id;
    } else {
      const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });
      return res.data.id || null;
    }
  } catch (error) {
    console.error('Error sincronizando cita con Google Calendar:', error);
    return null;
  }
}

