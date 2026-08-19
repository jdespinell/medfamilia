import { Router } from 'express';
import db from '../database/db.js';
import { getAuthUrl, getOAuth2Client, syncAppointmentToGoogleCalendar } from '../services/googleCalendar.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Helper function to sync all appointments of a patient to Google Calendar
export async function syncAllPatientAppointments(patientId: string, refreshToken: string) {
  const appointments = db.prepare('SELECT * FROM appointments WHERE patient_id = ? AND status != ?').all([
    patientId,
    'cancelada'
  ]) as any[];

  for (const app of appointments) {
    try {
      const eventId = await syncAppointmentToGoogleCalendar(refreshToken, app);
      if (eventId) {
        db.prepare('UPDATE appointments SET google_event_id = ? WHERE id = ?').run([eventId, app.id]);
      }
    } catch (err) {
      console.error(`Error sincronizando cita [${app.id}] con Google Calendar:`, err);
    }
  }
}

// Get OAuth URL for a patient
router.get('/auth-url/:patientId', authMiddleware, (req: AuthRequest, res) => {
  const { patientId } = req.params;

  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const dynamicRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${protocol}://${host}/api/calendar/callback`;

  const url = getAuthUrl(patientId, dynamicRedirectUri);

  if (!url) {
    return res.status(400).json({
      error: 'Google OAuth no está configurado. Configure GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el .env.',
    });
  }

  return res.json({ url, redirectUri: dynamicRedirectUri });
});

// Manual sync trigger for a patient's appointments
router.post('/sync-patient/:patientId', authMiddleware, async (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { patientId } = req.params;

  const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND family_id = ?').get(patientId, familyId) as any;
  if (!patient || !patient.google_refresh_token) {
    return res.status(400).json({ error: 'El familiar no tiene una cuenta de Google Calendar vinculada.' });
  }

  await syncAllPatientAppointments(patient.id, patient.google_refresh_token);

  return res.json({ message: 'Citas sincronizadas correctamente con Google Calendar.' });
});

// OAuth Callback handler
router.get('/callback', async (req, res) => {
  const { code, state } = req.query; // state is patientId
  const patientId = state as string;

  if (!code || !patientId) {
    return res.status(400).send('Respuesta de autenticación de Google inválida.');
  }

  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const dynamicRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${protocol}://${host}/api/calendar/callback`;

  const oauth2Client = getOAuth2Client(dynamicRedirectUri);
  if (!oauth2Client) {
    return res.status(500).send('Google OAuth no configurado en el servidor.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code as string);

    if (tokens.refresh_token) {
      db.prepare('UPDATE patients SET google_refresh_token = ? WHERE id = ?').run([
        tokens.refresh_token,
        patientId
      ]);

      // Retroactive Sync of existing appointments!
      syncAllPatientAppointments(patientId, tokens.refresh_token);
    }

    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2 style="color: #10b981;">✅ Google Calendar vinculado correctamente</h2>
          <p>Tus citas previas y próximas se están sincronizando con Google Calendar.</p>
          <script>
            setTimeout(() => {
              if (window.opener) { window.close(); } else { window.location.href = '/'; }
            }, 2500);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error procesando callback de Google OAuth:', error);
    return res.status(500).send('Error durante la vinculación con Google Calendar.');
  }
});

export default router;
