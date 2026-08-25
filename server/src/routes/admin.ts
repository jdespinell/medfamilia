import { Router, Response } from 'express';
import db from '../database/db.js';
import { adminMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Protect all admin endpoints
router.use(adminMiddleware);

/**
 * GET /api/admin/families
 * List all families with usage metrics, plan details, and system stats
 */
router.get('/families', (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const families = db.prepare(`
      SELECT 
        f.id,
        f.code,
        f.name,
        f.phone_number,
        f.subscription_status,
        f.subscription_expires_at,
        COALESCE(f.plan_type, 'gratuito') as plan_type,
        COALESCE(f.max_daily_whatsapp_queries, 5) as max_daily_whatsapp_queries,
        COALESCE(f.is_admin, 0) as is_admin,
        f.created_at,
        COALESCE(u.request_count, 0) as queries_used_today
      FROM families f
      LEFT JOIN whatsapp_ai_usage u 
        ON u.family_id = f.id AND u.request_date = ?
      ORDER BY f.created_at DESC
    `).all(today) as any[];

    const stats = {
      total_families: families.length,
      paid_families: families.filter((f) => f.plan_type === 'pago').length,
      free_families: families.filter((f) => f.plan_type === 'gratuito').length,
      total_queries_today: families.reduce((sum, f) => sum + (f.queries_used_today || 0), 0),
    };

    return res.json({
      stats,
      families: families.map((f) => ({
        ...f,
        is_admin: f.is_admin === 1,
      })),
    });
  } catch (error) {
    console.error('Error al listar familias en admin:', error);
    return res.status(500).json({ error: 'Error interno al consultar familias.' });
  }
});

/**
 * PATCH /api/admin/families/:id/plan
 * Update a family's plan, max whatsapp daily limit, and subscription status
 */
router.patch('/families/:id/plan', (req: AuthRequest, res: Response) => {
  try {
    const familyId = req.params.id;
    const { plan_type, max_daily_whatsapp_queries, subscription_status, is_admin } = req.body;

    const existing = db.prepare('SELECT id, plan_type, max_daily_whatsapp_queries FROM families WHERE id = ?').get(familyId) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Familia no encontrada.' });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (plan_type && (plan_type === 'gratuito' || plan_type === 'pago')) {
      updates.push('plan_type = ?');
      params.push(plan_type);

      // If max_daily_whatsapp_queries was not explicitly provided, auto-set sensible default per plan
      if (max_daily_whatsapp_queries === undefined) {
        const defaultLimit = plan_type === 'pago' ? 50 : 5;
        updates.push('max_daily_whatsapp_queries = ?');
        params.push(defaultLimit);
      }
    }

    if (typeof max_daily_whatsapp_queries === 'number' && max_daily_whatsapp_queries >= 0) {
      updates.push('max_daily_whatsapp_queries = ?');
      params.push(max_daily_whatsapp_queries);
    }

    if (subscription_status && typeof subscription_status === 'string') {
      updates.push('subscription_status = ?');
      params.push(subscription_status);
    }

    if (typeof is_admin === 'boolean') {
      updates.push('is_admin = ?');
      params.push(is_admin ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No se enviaron datos para actualizar.' });
    }

    params.push(familyId);
    const sql = `UPDATE families SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...params);

    const updatedFamily = db.prepare('SELECT id, code, name, phone_number, subscription_status, plan_type, max_daily_whatsapp_queries, is_admin FROM families WHERE id = ?').get(familyId) as any;

    return res.json({
      message: 'Plan de la familia actualizado con éxito.',
      family: {
        ...updatedFamily,
        is_admin: updatedFamily.is_admin === 1,
      },
    });
  } catch (error) {
    console.error('Error al actualizar plan en admin:', error);
    return res.status(500).json({ error: 'Error interno al actualizar plan.' });
  }
});

/**
 * POST /api/admin/families/:id/reset-usage
 * Reset today's WhatsApp AI usage count for a family
 */
router.post('/families/:id/reset-usage', (req: AuthRequest, res: Response) => {
  try {
    const familyId = req.params.id;
    const today = new Date().toISOString().split('T')[0];

    db.prepare('DELETE FROM whatsapp_ai_usage WHERE family_id = ? AND request_date = ?').run(familyId, today);

    return res.json({ message: 'Conteo de consultas diario de WhatsApp reiniciado exitosamente para hoy.' });
  } catch (error) {
    console.error('Error al reiniciar uso en admin:', error);
    return res.status(500).json({ error: 'Error interno al reiniciar consultas.' });
  }
});

export default router;
