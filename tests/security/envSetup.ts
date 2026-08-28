import path from 'path';
import fs from 'fs';

const TEST_DIR = path.resolve(__dirname, '..');
const TEST_DATA_DIR = path.join(TEST_DIR, 'data');
const TEST_UPLOADS_DIR = path.join(TEST_DIR, 'uploads');

if (!fs.existsSync(TEST_DATA_DIR)) {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TEST_UPLOADS_DIR)) {
  fs.mkdirSync(TEST_UPLOADS_DIR, { recursive: true });
}

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
process.env.JWT_SECRET = 'test-medfamilia-super-secret-jwt-key-2026-e2e';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin12345';
process.env.EVOLUTION_API_KEY = 'medfamilia_whatsapp_key_2026';
process.env.WEBHOOK_SECRET = 'medfamilia_webhook_secret_2026';
process.env.EVOLUTION_API_URL = 'http://127.0.0.1:9999/evolution-mock';

// Intercept external outbound calls (Evolution API, Google APIs, Gemini) during test execution
const originalFetch = globalThis.fetch;

globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

  // Allow local test server requests to proceed natively
  if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
    // If it's hitting our mock evolution endpoint, return immediate mock response
    if (url.includes('/evolution-mock/')) {
      return new Response(JSON.stringify({ status: 'SUCCESS', response: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }

  // Mock Evolution API
  if (url.includes('evolution-api') || url.includes('/message/sendText/') || url.includes('/webhook/set/')) {
    return new Response(JSON.stringify({ status: 'SUCCESS', message: 'Mock Evolution API OK' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mock Google OAuth & Calendar
  if (url.includes('oauth2.googleapis.com') || url.includes('www.googleapis.com')) {
    return new Response(
      JSON.stringify({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        id: 'mock-google-event-id',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Mock Gemini AI API
  if (url.includes('generativelanguage.googleapis.com')) {
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    specialist: 'Dr. Mock Specialist',
                    specialty: 'Medicina General',
                    date_time: '2026-10-15T10:00:00Z',
                    location: 'Consultorio Central',
                    requires_fasting: false,
                    prep_instructions: 'Ninguna',
                  }),
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Mock FCM / Web Push
  if (url.includes('fcm.googleapis.com')) {
    return new Response(JSON.stringify({ success: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fallback to original fetch for other targets
  return originalFetch(input, init);
};

export { TEST_DATA_DIR, TEST_UPLOADS_DIR };
