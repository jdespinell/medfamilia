import './envSetup.js';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { TEST_DATA_DIR, TEST_UPLOADS_DIR } from './envSetup.js';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import db, { initDatabase, DEFAULT_SPECIALTIES, isFileOwnedByFamily } from '../../server/src/database/db.js';
import authRoutes from '../../server/src/routes/auth.js';
import patientRoutes from '../../server/src/routes/patients.js';
import appointmentRoutes from '../../server/src/routes/appointments.js';
import examRoutes from '../../server/src/routes/exams.js';
import medicalOrdersRouter from '../../server/src/routes/medicalOrders.js';
import calendarRoutes from '../../server/src/routes/calendar.js';
import pushRoutes from '../../server/src/routes/push.js';
import specialtyRoutes from '../../server/src/routes/specialties.js';
import whatsappNumbersRoutes from '../../server/src/routes/whatsappNumbers.js';
import whatsappWebhookRoutes from '../../server/src/routes/whatsappWebhook.js';
import adminRoutes from '../../server/src/routes/admin.js';
import { authMiddleware, AuthRequest, generateToken, generateAdminToken } from '../../server/src/middleware/auth.js';
import { authRateLimiter, generalRateLimiter } from '../../server/src/middleware/rateLimiter.js';

export { db, generateToken, generateAdminToken };

// File serving handler matching server/src/index.ts
const handleSecureFileServe = (req: AuthRequest, res: express.Response) => {
  try {
    const familyId = req.family!.id;
    const rawFilename = req.params.filename;
    if (!rawFilename) {
      return res.status(404).json({ error: 'Archivo no especificado.' });
    }

    const filename = path.basename(rawFilename);
    const targetDir = process.env.UPLOADS_DIR || TEST_UPLOADS_DIR;
    const filePath = path.join(targetDir, filename);

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
    return res.status(500).json({ error: 'Error al acceder al archivo.' });
  }
};


export function createTestApp(): express.Application {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    })
  );

  const allowedOriginsList = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  const isOriginAllowed = (origin: string): boolean => {
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
        if (!origin) return callback(null, false);
        if (isOriginAllowed(origin)) {
          return callback(null, true);
        }
        return callback(new Error('CORS policy: Not allowed by CORS origin whitelist'), false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-token', 'apikey'],
    })
  );

  app.use(generalRateLimiter);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.get('/api/uploads/:filename', authMiddleware, handleSecureFileServe);
  app.get('/uploads/:filename', authMiddleware, handleSecureFileServe);

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

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'MedFamilia API activa y saludable (SaaS Ready)' });
  });

  return app;
}

export interface TestServerContext {
  app: express.Application;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServerContext> {
  initDatabase();
  const app = createTestApp();
  return {
    app,
    baseUrl: '',
    close: async () => {},
  };
}

export function resetDatabase() {
  try {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('DELETE FROM otp_verifications;');
    db.exec('DELETE FROM whatsapp_ai_usage;');
    db.exec('DELETE FROM exam_results;');
    db.exec('DELETE FROM medical_orders;');
    db.exec('DELETE FROM appointments;');
    db.exec('DELETE FROM push_subscriptions;');
    db.exec('DELETE FROM family_whatsapp_numbers;');
    db.exec('DELETE FROM patients;');
    db.exec('DELETE FROM specialties WHERE family_id IS NOT NULL;');
    db.exec('DELETE FROM families;');
    db.exec('PRAGMA foreign_keys = ON;');

    const count = (db.prepare('SELECT COUNT(*) as cnt FROM specialties WHERE family_id IS NULL').get() as any)?.cnt;
    if (count === 0) {
      const insertStmt = db.prepare('INSERT INTO specialties (id, family_id, name) VALUES (?, NULL, ?)');
      for (const spec of DEFAULT_SPECIALTIES) {
        insertStmt.run([uuidv4(), spec]);
      }
    }
  } catch (err) {
    console.error('Error resetting test database:', err);
  }
}

export interface TestFamilyOptions {
  code?: string;
  name?: string;
  password?: string;
  phone?: string;
  plan_type?: 'gratuito' | 'pago';
  max_daily_whatsapp_queries?: number;
  subscription_status?: string;
}

export interface CreatedTestFamily {
  id: string;
  code: string;
  name: string;
  phone: string;
  token: string;
  papaId: string;
  mamaId: string;
}

export async function createTestFamily(opts: TestFamilyOptions = {}): Promise<CreatedTestFamily> {
  const familyId = uuidv4();
  const code = opts.code || `family_${Math.random().toString(36).substring(2, 8)}`;
  const name = opts.name || `Familia ${code}`;
  const password = opts.password || 'password123';
  const phone = opts.phone || `573${Math.floor(100000000 + Math.random() * 900000000)}`;
  const planType = opts.plan_type || 'gratuito';
  const maxQueries = opts.max_daily_whatsapp_queries ?? (planType === 'pago' ? 50 : 5);
  const subStatus = opts.subscription_status || 'trial';

  const passwordHash = await bcrypt.hash(password, 6);

  db.prepare(`
    INSERT INTO families (id, code, name, password_hash, phone_number, subscription_status, plan_type, max_daily_whatsapp_queries)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run([familyId, code, name, passwordHash, phone, subStatus, planType, maxQueries]);

  db.prepare('INSERT INTO family_whatsapp_numbers (id, family_id, phone_number, label) VALUES (?, ?, ?, ?)').run(
    uuidv4(), familyId, phone, 'Principal'
  );

  const papaId = uuidv4();
  const mamaId = uuidv4();
  db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run(
    papaId, familyId, 'Papá Test', 'Padre', '#3b82f6'
  );
  db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run(
    mamaId, familyId, 'Mamá Test', 'Madre', '#10b981'
  );

  const token = generateToken({ id: familyId, code, name, phone_number: phone });

  return {
    id: familyId,
    code,
    name,
    phone,
    token,
    papaId,
    mamaId,
  };
}

export function getAdminToken(username = 'admin'): string {
  return generateAdminToken(username);
}

export interface MultipartUploadOptions {
  fields?: Record<string, string>;
  files?: Array<{ name: string; filename: string; buffer: Buffer; mimeType: string }>;
}

export interface RequestOptions {
  method?: string;
  token?: string;
  json?: any;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  multipart?: MultipartUploadOptions;
  body?: any;
}

export interface MockApiResponse<T = any> {
  status: number;
  headers: Headers;
  body: T;
  text: string;
  ok: boolean;
}

function buildMultipartBuffer(
  fields: Record<string, string> = {},
  files: Array<{ name: string; filename: string; buffer: Buffer; mimeType: string }> = []
) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2, 14);
  const parts: Buffer[] = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }

  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
      )
    );
    parts.push(file.buffer);
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    buffer: Buffer.concat(parts),
  };
}

// Global cached express app for testing
let cachedApp: express.Application | null = null;
function getAppInstance(): express.Application {
  if (!cachedApp) {
    cachedApp = createTestApp();
  }
  return cachedApp;
}

let globalIpCounter = 1;

export function apiRequest<T = any>(
  baseUrl: string,
  endpoint: string,
  options: RequestOptions & { ip?: string } = {}
): Promise<MockApiResponse<T>> {
  return new Promise((resolve) => {
    const app = getAppInstance();

    let fullPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    if (options.params) {
      const sp = new URLSearchParams(options.params);
      fullPath += (fullPath.includes('?') ? '&' : '?') + sp.toString();
    }

    const method = (options.method || 'GET').toUpperCase();
    const reqHeaders: Record<string, string> = {};

    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        reqHeaders[k.toLowerCase()] = v;
      }
    }

    if (options.token) {
      reqHeaders['authorization'] = `Bearer ${options.token}`;
    }

    let payload: Buffer | null = null;

    if (options.multipart) {
      const mp = buildMultipartBuffer(options.multipart.fields, options.multipart.files);
      reqHeaders['content-type'] = mp.contentType;
      payload = mp.buffer;
    } else if (options.json !== undefined) {
      payload = Buffer.from(JSON.stringify(options.json));
      reqHeaders['content-type'] = 'application/json';
    } else if (options.body !== undefined && options.body !== null) {
      payload = Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
    }

    if (payload) {
      reqHeaders['content-length'] = String(payload.length);
    }

    const clientIp = options.ip || `10.0.0.${(globalIpCounter++ % 240) + 1}`;

    class MockSocket extends Socket {
      remoteAddress = clientIp;
      override _writeGeneric(writev: boolean, data: any, encoding: string, cb: (err?: Error | null) => void) {
        cb(null);
      }
      override _write(chunk: any, encoding: string, cb: (err?: Error | null) => void) {
        cb(null);
      }
      override _writev(chunks: Array<{ chunk: any; encoding: string }>, cb: (err?: Error | null) => void) {
        cb(null);
      }
    }

    const socket = new MockSocket();
    const req = new http.IncomingMessage(socket);
    (req as any).ip = clientIp;
    (req as any).connection = socket;
    req.method = method;
    req.url = fullPath;
    req.headers = reqHeaders;

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    const chunks: Buffer[] = [];
    const origWrite = res.write;
    const origEnd = res.end;

    res.write = function (chunk: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return origWrite.call(res, chunk, ...args);
    };

    res.end = function (chunk: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      origEnd.call(res, chunk, ...args);

      const bodyBuf = Buffer.concat(chunks);
      const text = bodyBuf.toString('utf8');
      let json: any = text;
      try {
        json = JSON.parse(text);
      } catch {
        // text remains raw
      }

      const resHeadersObj = res.getHeaders ? res.getHeaders() : {};
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(resHeadersObj)) {
        if (v !== undefined) {
          resHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        }
      }

      resolve({
        status: res.statusCode,
        headers: resHeaders,
        body: json as T,
        text,
        ok: res.statusCode >= 200 && res.statusCode < 300,
      });
    };

    app(req as any, res as any);

    if (payload) {
      req.push(payload);
    }
    req.push(null);
  });
}

export function writeTestFile(filename: string, content: string | Buffer): string {
  const filePath = path.join(TEST_UPLOADS_DIR, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

export function cleanTestFiles() {
  if (fs.existsSync(TEST_UPLOADS_DIR)) {
    const files = fs.readdirSync(TEST_UPLOADS_DIR);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(TEST_UPLOADS_DIR, file));
      } catch {}
    }
  }
}
