import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../database/db.js';

const INSECURE_JWT_DEFAULTS = [
  'super-secret-key-medfamilia-2026',
  'super-secret-medfamilia-key-2026',
  'development-medfamilia-fallback-key-change-me',
];

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret || secret.trim() === '' || INSECURE_JWT_DEFAULTS.includes(secret.trim())) {
    if (isProduction) {
      throw new Error('CRITICAL SECURITY FATAL ERROR: JWT_SECRET must be explicitly set with a strong, non-default secret in production.');
    }
    return 'development-medfamilia-fallback-key-change-me';
  }
  return secret.trim();
}

export interface AuthRequest extends Request {
  family?: {
    id: string;
    code: string;
    name: string;
    phone_number?: string;
    subscription_status?: string;
    subscription_expires_at?: string;
    plan_type?: 'gratuito' | 'pago';
    max_daily_whatsapp_queries?: number;
    is_admin?: boolean;
  };
}

export function generateToken(payload: { id: string; code: string; name: string; phone_number?: string }) {
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn: '90d' });
}

export function generateAdminToken(username: string) {
  return jwt.sign({ role: 'superadmin', username }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '7d' });
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
    token = req.query.token.trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado. Inicie sesión.' });
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as any;
    if (!decoded || !decoded.id || typeof decoded.id !== 'string') {
      return res.status(401).json({ error: 'Token de sesión inválido.' });
    }

    // Verify family active status / existence in DB
    const family = db.prepare('SELECT id, code, name, phone_number, subscription_status, subscription_expires_at, plan_type, max_daily_whatsapp_queries FROM families WHERE id = ?').get(decoded.id) as any;
    if (!family) {
      return res.status(401).json({ error: 'La cuenta familiar ya no existe o fue deshabilitada.' });
    }

    req.family = {
      id: family.id,
      code: family.code,
      name: family.name,
      phone_number: family.phone_number,
      subscription_status: family.subscription_status,
      subscription_expires_at: family.subscription_expires_at,
      plan_type: family.plan_type || 'gratuito',
      max_daily_whatsapp_queries: family.max_daily_whatsapp_queries ?? 5,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada o inválida.' });
  }
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
    token = req.query.token.trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado. Se requieren credenciales de administrador.' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as any;
    if (!decoded || decoded.role !== 'superadmin') {
      return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión de administrador expirada o inválida.' });
  }
}

