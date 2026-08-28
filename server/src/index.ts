import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env variables before importing application modules
dotenv.config();
if (fs.existsSync(path.join(process.cwd(), 'server/.env'))) {
  dotenv.config({ path: path.join(process.cwd(), 'server/.env') });
}
if (fs.existsSync(path.join(process.cwd(), '../.env'))) {
  dotenv.config({ path: path.join(process.cwd(), '../.env') });
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import db, { initDatabase, isFileOwnedByFamily, cleanupOrphanedStagingFiles } from './database/db.js';
import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patients.js';
import appointmentRoutes from './routes/appointments.js';
import examRoutes from './routes/exams.js';
import medicalOrdersRouter from './routes/medicalOrders.js';
import calendarRoutes from './routes/calendar.js';
import pushRoutes from './routes/push.js';
import specialtyRoutes from './routes/specialties.js';
import whatsappNumbersRoutes from './routes/whatsappNumbers.js';
import whatsappWebhookRoutes from './routes/whatsappWebhook.js';
import adminRoutes from './routes/admin.js';
import { authMiddleware, AuthRequest } from './middleware/auth.js';
import { authRateLimiter, generalRateLimiter } from './middleware/rateLimiter.js';
import { ensureWhatsAppWebhook } from './services/whatsapp.js';

// Initialize Database
initDatabase();

// Run initial cleanup of unlinked staging files older than 24 hours
cleanupOrphanedStagingFiles();
const stagingCleanupInterval = setInterval(() => {
  cleanupOrphanedStagingFiles();
}, 60 * 60 * 1000);
stagingCleanupInterval.unref();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloudflare Tunnel / Reverse Proxy
app.set('trust proxy', 1);

// Security Headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);

// CORS configuration
const corsOriginEnv = process.env.CORS_ORIGIN;
const allowedOriginsList = corsOriginEnv
  ? corsOriginEnv.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

const isOriginAllowed = (origin: string): boolean => {
  if (allowedOriginsList.length === 0 || allowedOriginsList.includes('*')) {
    return true;
  }
  if (allowedOriginsList.includes(origin)) {
    return true;
  }
  try {
    const parsedUrl = new URL(origin);
    if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, same-origin requests)
      if (!origin) return callback(null, true);

      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS policy: Not allowed by CORS origin whitelist'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-token', 'apikey'],
  })
);

// Global Rate Limiter
app.use(generalRateLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Uploads directory preparation
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Protected Uploads File Serving with Multi-Tenant Access Control & Path Traversal Prevention
export const handleSecureFileServe = (req: AuthRequest, res: express.Response) => {
  try {
    const familyId = req.family!.id;
    const rawFilename = req.params.filename;
    if (!rawFilename) {
      return res.status(404).json({ error: 'Archivo no especificado.' });
    }

    // Sanitize filename to prevent Path Traversal Attacks (../)
    const filename = path.basename(rawFilename);
    const targetUploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
    const filePath = path.join(targetUploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado.' });
    }

    // Multi-tenant check: strictly verify file belongs to logged-in familyId (no temporal grace window)
    const isOwned = isFileOwnedByFamily(familyId, filename);

    if (!isOwned) {
      return res.status(403).json({ error: 'Acceso denegado. Este archivo no pertenece a su grupo familiar.' });
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    } else if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].includes(ext)) {
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.heic': 'image/heic',
      };
      res.setHeader('Content-Type', mimeMap[ext] || 'image/jpeg');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    return res.sendFile(filePath);
  } catch (err) {
    console.error('Error sirviendo archivo protegido:', err);
    return res.status(500).json({ error: 'Error al acceder al archivo.' });
  }
};

app.get('/api/uploads/:filename', authMiddleware, handleSecureFileServe);
app.get('/uploads/:filename', authMiddleware, handleSecureFileServe);


// API Routes with specific rate limiters
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/medical-orders', medicalOrdersRouter);
app.use('/api/calendar', calendarRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/specialties', specialtyRoutes);
app.use('/api/whatsapp-numbers', whatsappNumbersRoutes);
app.use('/api/whatsapp', whatsappWebhookRoutes);
app.use('/api/admin', adminRoutes);

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

// Global Express Error Handling Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Ocurrió un error interno en el servidor.'
    : (err.message || 'Ocurrió un error interno en el servidor.');
  return res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`🩺 MedFamilia Backend SaaS ejecutándose en puerto ${PORT}`);
  console.log(`================================================`);

  // Auto-configurar Webhook de WhatsApp con Evolution API al iniciar
  setTimeout(() => {
    ensureWhatsAppWebhook();
  }, 3000);
});

