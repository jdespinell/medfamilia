import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './database/db.js';
import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patients.js';
import appointmentRoutes from './routes/appointments.js';
import examRoutes from './routes/exams.js';
import calendarRoutes from './routes/calendar.js';
import pushRoutes from './routes/push.js';
import specialtyRoutes from './routes/specialties.js';
import whatsappNumbersRoutes from './routes/whatsappNumbers.js';
import whatsappWebhookRoutes from './routes/whatsappWebhook.js';
import { authRateLimiter, generalRateLimiter } from './middleware/rateLimiter.js';

dotenv.config();

// Initialize Database
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloudflare Tunnel proxy
app.set('trust proxy', 1);

// Security Headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: false, // Disabled for local PWA/CDN assets compatibility
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS configuration
app.use(cors());

// Global Rate Limiter
app.use(generalRateLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Uploads directory static serving with security headers
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use(
  '/uploads',
  express.static(uploadsDir, {
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

// API Routes with specific rate limiters
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/specialties', specialtyRoutes);
app.use('/api/whatsapp-numbers', whatsappNumbersRoutes);
app.use('/api/whatsapp', whatsappWebhookRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MedFamilia API activa y saludable (SaaS Ready)' });
});

// Serve frontend static build if available (for production / Docker)
const clientBuildDir = path.join(process.cwd(), '../client/dist');
if (fs.existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`🩺 MedFamilia Backend SaaS ejecutándose en puerto ${PORT}`);
  console.log(`================================================`);
});
