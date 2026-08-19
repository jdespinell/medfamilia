import { Router } from 'express';
import db from '../database/db.js';
import { getAuthUrl, getOAuth2Client } from '../services/googleCalendar.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

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
    }

    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2 style="color: #10b981;">✅ Google Calendar vinculado correctamente</h2>
          <p>Puedes cerrar esta ventana y regresar a MedFamilia.</p>
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
