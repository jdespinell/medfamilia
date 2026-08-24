import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '' || secret === 'super-secret-medfamilia-key-2026') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL SECURITY FATAL ERROR: JWT_SECRET must be explicitly set in production environment.');
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
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '90d' });
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso no autorizado. Inicie sesión.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    req.family = {
      id: decoded.id,
      code: decoded.code,
      name: decoded.name,
      phone_number: decoded.phone_number,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada o inválida.' });
  }
}
