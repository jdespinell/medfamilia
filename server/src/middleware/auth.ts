import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../database/db.js';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '' || secret === 'super-secret-medfamilia-key-2026') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL SECURITY FATAL ERROR: JWT_SECRET must be explicitly set with a strong secret in production.');
    }
  }
  return secret || 'development-medfamilia-fallback-key-change-me';
}

export interface AuthRequest extends Request {
  family?: {
    id: string;
    code: string;
    name: string;
    phone_number?: string;
    subscription_status?: string;
    subscription_expires_at?: string;
  };
}

export function generateToken(payload: { id: string; code: string; name: string; phone_number?: string }) {
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn: '90d' });
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso no autorizado. Inicie sesión.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as any;
    if (!decoded || !decoded.id || typeof decoded.id !== 'string') {
      return res.status(401).json({ error: 'Token de sesión inválido.' });
    }

    // Verify family active status / existence in DB
    const family = db.prepare('SELECT id, code, name FROM families WHERE id = ?').get(decoded.id) as any;
    if (!family) {
      return res.status(401).json({ error: 'La cuenta familiar ya no existe o fue deshabilitada.' });
    }

    req.family = {
      id: family.id,
      code: family.code,
      name: family.name,
      phone_number: decoded.phone_number,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada o inválida.' });
  }
}

