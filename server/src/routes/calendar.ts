import { Router } from 'express';
import db from '../database/db.js';
import { getAuthUrl, getOAuth2Client, syncAppointmentToGoogleCalendar } from '../services/googleCalendar.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Helper function to sync ALL family appointments to a connected Google Calendar
export async function syncAllFamilyAppointments(familyId: string, refreshToken: string) {
  const appointments = db.prepare(`
    SELECT a.*, p.name as patient_name
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE a.family_id = ? AND p.family_id = ? AND a.status != ?
  `).all([familyId, familyId, 'cancelada']) as any[];

  for (const app of appointments) {
    try {
      const eventId = await syncAppointmentToGoogleCalendar(refreshToken, app);
      if (eventId) {
        db.prepare('UPDATE appointments SET google_event_id = ? WHERE id = ? AND family_id = ?').run([eventId, app.id, familyId]);
      }
    } catch (err) {
      console.error(`Error sincronizando cita [${app.id}] con Google Calendar:`, err);
    }
  }
}

// Get OAuth URL for a patient
router.get('/auth-url/:patientId', authMiddleware, (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { patientId } = req.params;

  // Verify patient ownership by familyId
  const patient = db.prepare('SELECT id FROM patients WHERE id = ? AND family_id = ?').get(patientId, familyId);
  if (!patient) {
    return res.status(404).json({ error: 'Paciente no encontrado o no pertenece a su grupo familiar.' });
  }

  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const dynamicRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${protocol}://${host}/api/calendar/callback`;

  const url = getAuthUrl(patientId, dynamicRedirectUri);

  if (!url) {
    return res.status(400).json({
      error: 'Google OAuth no está configurado. Configure GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en las variables de entorno.',
    });
  }

  return res.json({ url, redirectUri: dynamicRedirectUri });
});

// Manual sync trigger for all family appointments to a patient's connected Google Calendar
router.post('/sync-patient/:patientId', authMiddleware, async (req: AuthRequest, res) => {
  const familyId = req.family!.id;
  const { patientId } = req.params;

  const patient = db.prepare('SELECT * FROM patients WHERE id = ? AND family_id = ?').get(patientId, familyId) as any;
  if (!patient || !patient.google_refresh_token) {
    return res.status(400).json({ error: 'El familiar no tiene una cuenta de Google Calendar vinculada.' });
  }

  await syncAllFamilyAppointments(familyId, patient.google_refresh_token);

  return res.json({ message: 'Todas las citas familiares se han sincronizado con Google Calendar.' });
});

// OAuth Callback handler
router.get('/callback', async (req, res) => {
  const { code, state } = req.query; // state is patientId
  const patientId = typeof state === 'string' ? state : '';

  if (!code || typeof code !== 'string' || !patientId) {
    return res.status(400).send('Respuesta de autenticación de Google inválida.');
  }

  const patient = db.prepare('SELECT family_id FROM patients WHERE id = ?').get(patientId) as any;
  if (!patient) {
    return res.status(404).send('Paciente no encontrado en el sistema.');
  }

  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const dynamicRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${protocol}://${host}/api/calendar/callback`;

  const oauth2Client = getOAuth2Client(dynamicRedirectUri);
  if (!oauth2Client) {
    return res.status(500).send('Google OAuth no está configurado en el servidor.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (tokens.refresh_token) {
      db.prepare('UPDATE patients SET google_refresh_token = ? WHERE id = ? AND family_id = ?').run([
        tokens.refresh_token,
        patientId,
        patient.family_id
      ]);

      // Sync ALL family appointments to this connected Google Calendar
      await syncAllFamilyAppointments(patient.family_id, tokens.refresh_token);
    }

    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2 style="color: #10b981;">✅ Google Calendar vinculado correctamente</h2>
          <p>Todas las citas familiares se están sincronizando con Google Calendar.</p>
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

