import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/calendar/callback';

export function getOAuth2Client() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return null;
  }
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getAuthUrl(patientId: string) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    prompt: 'consent',
    state: patientId,
  });
}

export async function syncAppointmentToGoogleCalendar(
  refreshToken: string,
  appointment: {
    id: string;
    title: string;
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
    console.log('Google Calendar sync omitido (Falta OAuth client o refreshToken del paciente)');
    return null;
  }

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const startTime = new Date(appointment.date_time);
  // Default duration 1 hour
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

  let description = `Cita Médica registrada en MedFamilia.`;
  if (appointment.specialist) description += `\nEspecialista: ${appointment.specialist}`;
  if (appointment.requires_fasting) description += `\n⚠️ REQUIERE AYUNO`;
  if (appointment.prep_instructions) description += `\nIndicaciones: ${appointment.prep_instructions}`;

  const event = {
    summary: `🩺 ${appointment.title}`,
    location: appointment.location || '',
    description: description,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: 'America/Bogota', // Standard timezone, adjust if needed
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: 'America/Bogota',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 24 * 60 }, // 1 day before
        { method: 'popup', minutes: 2 * 60 },  // 2 hours before
      ],
    },
  };

  try {
    if (appointment.google_event_id) {
      // Update existing event
      const res = await calendar.events.update({
        calendarId: 'primary',
        eventId: appointment.google_event_id,
        requestBody: event,
      });
      return res.data.id || appointment.google_event_id;
    } else {
      // Create new event
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
