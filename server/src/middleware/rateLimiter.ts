import rateLimit from 'express-rate-limit';

// Strict rate limiter for Auth endpoints (login/register) to prevent brute-force attacks
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 login/register requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiados intentos de inicio de sesión o registro. Intente nuevamente en 15 minutos.'
  }
});

// Rate limiter for AI processing endpoints (Gemini OCR & Exam Summary) to control API costs
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // Limit each IP/user to 30 AI requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Has alcanzado el límite de procesamiento con IA por esta hora. Intenta de nuevo más tarde.'
  }
});

// General API rate limiter for overall service stability
export const generalRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // Limit each IP to 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas solicitudes al servidor. Por favor disminuye la velocidad.'
  }
});
