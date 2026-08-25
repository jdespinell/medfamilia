import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { Family, AdminStats } from '../types';
import { 
  Users, 
  ShieldCheck, 
  MessageSquare, 
  Zap, 
  Search, 
  X, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  Crown,
  Edit2,
  Sliders
} from 'lucide-react';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminModal: React.FC<AdminModalProps> = ({ isOpen, onClose }) => {
  const [families, setFamilies] = useState<Family[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  
  // Custom edit limit state
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [customLimit, setCustomLimit] = useState<number>(5);

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest('/admin/families');
      setFamilies(res.families || []);
      setStats(res.stats || null);
    } catch (err: any) {
      console.error('Error cargando panel admin:', err);
      setError(err.message || 'Error al cargar los datos de administración.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAdminData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePlanToggle = async (family: Family, newPlan: 'gratuito' | 'pago') => {
    try {
      setUpdatingId(family.id);
      const defaultLimit = newPlan === 'pago' ? 50 : 5;
      await apiRequest(`/admin/families/${family.id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          plan_type: newPlan,
          max_daily_whatsapp_queries: defaultLimit,
          subscription_status: newPlan === 'pago' ? 'active' : 'trial'
        }),
      });
      await fetchAdminData();
    } catch (err: any) {
      alert(`Error al actualizar plan: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSaveCustomLimit = async (familyId: string) => {
    try {
      setUpdatingId(familyId);
      await apiRequest(`/admin/families/${familyId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          max_daily_whatsapp_queries: Number(customLimit)
        }),
      });
      setEditingLimitId(null);
      await fetchAdminData();
    } catch (err: any) {
      alert(`Error al guardar límite: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleResetUsage = async (familyId: string, familyName: string) => {
    if (!confirm(`¿Desea reiniciar el conteo diario de consultas de WhatsApp para la familia "${familyName}"?`)) {
      return;
    }
    try {
      setUpdatingId(familyId);
      await apiRequest(`/admin/families/${familyId}/reset-usage`, {
        method: 'POST'
      });
      await fetchAdminData();
    } catch (err: any) {
      alert(`Error al reiniciar conteo: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredFamilies = families.filter(f => 
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.phone_number && f.phone_number.includes(searchQuery))
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="px-6 py-5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-600 rounded-xl text-white">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Panel de Administración SaaS</h2>
              <p className="text-xs text-slate-400">Gestión de Usuarios, Planes (Gratuito vs Pago) y Consultas WhatsApp</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={fetchAdminData}
              title="Recargar datos"
              className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50 space-y-6">

          {/* Stats Bar */}
          {stats && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Familias Totales</p>
                  <p className="text-2xl font-bold text-slate-800">{stats.total_families}</p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4">
                <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                  <Crown className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Planes Pago Activos</p>
                  <p className="text-2xl font-bold text-amber-600">{stats.paid_families}</p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4">
                <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
                  <Zap className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Planes Gratuitos</p>
                  <p className="text-2xl font-bold text-slate-700">{stats.free_families}</p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4">
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Consultas WhatsApp Hoy</p>
                  <p className="text-2xl font-bold text-emerald-600">{stats.total_queries_today}</p>
                </div>
              </div>
            </div>
          )}

          {/* Search bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input 
                type="text"
                placeholder="Buscar por código, nombre o celular..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
              />
            </div>
            <p className="text-xs text-slate-500">
              Mostrando <span className="font-bold text-slate-700">{filteredFamilies.length}</span> registros
            </p>
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl text-sm flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-100/80 text-slate-700 uppercase font-semibold text-xs border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-4">Familia / Usuario</th>
                    <th className="px-5 py-4">WhatsApp Principal</th>
                    <th className="px-5 py-4">Plan Actual</th>
                    <th className="px-5 py-4">Consultas WhatsApp Hoy</th>
                    <th className="px-5 py-4 text-right">Acciones Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                        Cargando información del servidor...
                      </td>
                    </tr>
                  ) : filteredFamilies.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                        No se encontraron familias registradas.
                      </td>
                    </tr>
                  ) : (
                    filteredFamilies.map((fam) => {
                      const used = fam.queries_used_today || 0;
                      const max = fam.max_daily_whatsapp_queries ?? 5;
                      const percent = Math.min(100, Math.round((used / max) * 100));
                      const isPaid = fam.plan_type === 'pago';

                      return (
                        <tr key={fam.id} className="hover:bg-slate-50/80 transition">
                          <td className="px-5 py-4">
                            <div className="flex items-center space-x-2">
                              <div>
                                <div className="font-bold text-slate-900 flex items-center gap-2">
                                  {fam.name}
                                  {fam.is_admin && (
                                    <span className="px-2 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded-full font-bold">
                                      ADMIN
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400 font-mono">Código: @{fam.code}</div>
                              </div>
                            </div>
                          </td>

                          <td className="px-5 py-4 font-mono text-xs text-slate-700">
                            {fam.phone_number ? `+${fam.phone_number}` : 'Sin registrar'}
                          </td>

                          <td className="px-5 py-4">
                            {isPaid ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 font-bold border border-amber-200 rounded-full text-xs shadow-xs">
                                <Crown className="w-3.5 h-3.5" /> Plan Pago
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 font-medium border border-slate-200 rounded-full text-xs">
                                Plan Gratuito
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-4 min-w-[200px]">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span className={used >= max ? 'text-red-600 font-bold' : 'text-slate-700'}>
                                  {used} / {max} consultas
                                </span>
                                <span className="text-slate-400">{percent}%</span>
                              </div>
                              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    used >= max ? 'bg-red-500' : isPaid ? 'bg-amber-500' : 'bg-blue-500'
                                  }`} 
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              {/* Toggle Plan button */}
                              {isPaid ? (
                                <button
                                  onClick={() => handlePlanToggle(fam, 'gratuito')}
                                  disabled={updatingId === fam.id}
                                  className="px-2.5 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-medium transition flex items-center space-x-1"
                                  title="Bajar a Plan Gratuito (Límite 5/día)"
                                >
                                  <span>Bajar a Gratuito</span>
                                </button>
                              ) : (
                                <button
                                  onClick={() => handlePlanToggle(fam, 'pago')}
                                  disabled={updatingId === fam.id}
                                  className="px-2.5 py-1.5 bg-amber-600 text-white hover:bg-amber-700 rounded-lg text-xs font-bold transition flex items-center space-x-1 shadow-xs"
                                  title="Subir a Plan Pago (Límite 50/día)"
                                >
                                  <Crown className="w-3.5 h-3.5" />
                                  <span>Activar Plan Pago</span>
                                </button>
                              )}

                              {/* Edit custom limit */}
                              {editingLimitId === fam.id ? (
                                <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg">
                                  <input 
                                    type="number"
                                    min="1"
                                    max="1000"
                                    value={customLimit}
                                    onChange={(e) => setCustomLimit(Number(e.target.value))}
                                    className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-center focus:outline-none"
                                  />
                                  <button 
                                    onClick={() => handleSaveCustomLimit(fam.id)}
                                    className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                    title="Guardar Límite"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => setEditingLimitId(null)}
                                    className="p-1 bg-slate-200 text-slate-600 rounded hover:bg-slate-300"
                                    title="Cancelar"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingLimitId(fam.id);
                                    setCustomLimit(fam.max_daily_whatsapp_queries ?? 5);
                                  }}
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                  title="Editar límite personalizado de consultas"
                                >
                                  <Sliders className="w-4 h-4" />
                                </button>
                              )}

                              {/* Reset usage button */}
                              <button
                                onClick={() => handleResetUsage(fam.id, fam.name)}
                                disabled={updatingId === fam.id}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                                title="Reiniciar consultas de hoy a 0"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <p>MedFamilia SaaS Admin System • PostgreSQL/SQLite Compatible</p>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition font-medium"
          >
            Cerrar Panel
          </button>
        </div>

      </div>
    </div>
  );
};
