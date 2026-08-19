import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-medfamilia-key-2026';

export interface AuthRequest extends Request {
  family?: {
    id: string;
    code: string;
    name: string;
  };
}

export function generateToken(payload: { id: string; code: string; name: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '90d' });
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso no autorizado. Inicie sesión.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.family = {
      id: decoded.id,
      code: decoded.code,
      name: decoded.name,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada o inválida.' });
  }
}
