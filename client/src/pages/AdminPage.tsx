import React, { useState, useEffect } from 'react';
import { Family, AdminStats } from '../types';
import { 
  Users, 
  ShieldCheck, 
  MessageSquare, 
  Zap, 
  Search, 
  RefreshCw, 
  AlertCircle,
  Crown,
  Sliders,
  CheckCircle2,
  X,
  LogOut,
  Lock,
  UserCheck
} from 'lucide-react';

const ADMIN_TOKEN_KEY = 'medfamilia_admin_token';

export const AdminPage: React.FC = () => {
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem(ADMIN_TOKEN_KEY));
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Admin Dashboard state
  const [families, setFamilies] = useState<Family[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Custom limit edit state
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);
  const [customLimit, setCustomLimit] = useState<number>(5);

  const adminApiRequest = async (endpoint: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (adminToken) {
      headers['Authorization'] = `Bearer ${adminToken}`;
    }

    const res = await fetch(`/api/admin${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (!endpoint.includes('/login')) {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          setAdminToken(null);
        }
      }
      throw new Error(data.error || 'Ocurrió un error en la solicitud de administración.');
    }

    return data;
  };

  const fetchAdminData = async () => {
    if (!adminToken) return;
    try {
      setDataLoading(true);
      setDataError(null);
      const res = await adminApiRequest('/families');
      setFamilies(res.families || []);
      setStats(res.stats || null);
    } catch (err: any) {
      console.error('Error cargando datos de admin:', err);
      setDataError(err.message || 'Error al conectar con la API de administración.');
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (adminToken) {
      fetchAdminData();
    }
  }, [adminToken]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Credenciales de administración inválidas.');
      }

      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAdminToken(data.token);
    } catch (err: any) {
      setLoginError(err.message || 'No se pudo iniciar sesión como Administrador.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken(null);
  };

  const handlePlanToggle = async (family: Family, newPlan: 'gratuito' | 'pago') => {
    try {
      setUpdatingId(family.id);
      const defaultLimit = newPlan === 'pago' ? 50 : 5;
      await adminApiRequest(`/families/${family.id}/plan`, {
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
      await adminApiRequest(`/families/${familyId}/plan`, {
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
      await adminApiRequest(`/families/${familyId}/reset-usage`, {
        method: 'POST'
      });
      await fetchAdminData();
    } catch (err: any) {
      alert(`Error al reiniciar conteo: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  // If not logged in as admin, show dark Admin Login screen
  if (!adminToken) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-blue-600/20 text-blue-500 rounded-2xl flex items-center justify-center mx-auto border border-blue-500/30">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white">MedFamilia SuperAdmin</h1>
            <p className="text-xs text-slate-400">Acceso restringido únicamente para administradores de la plataforma SaaS</p>
          </div>

          {loginError && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Usuario Admin</label>
              <div className="relative">
                <UserCheck className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                <input 
                  type="text"
                  required
                  placeholder="admin"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full pl-9 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Contraseña</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3.5 text-slate-500" />
                <input 
                  type="password"
                  required
                  placeholder="••••••••"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full pl-9 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2"
            >
              {loginLoading ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <span>Ingresar al Dashboard Admin</span>
              )}
            </button>
          </form>

          <p className="text-[11px] text-center text-slate-500">
            MedFamilia SaaS System • Acceso Restringido
          </p>
        </div>
      </div>
    );
  }

  const filteredFamilies = families.filter(f => 
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.phone_number && f.phone_number.includes(searchQuery))
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-md">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">MedFamilia SaaS Admin</h1>
              <p className="text-xs text-slate-400">Panel de Control General y Gestión de Suscripciones</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchAdminData}
              title="Recargar información"
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition"
            >
              <RefreshCw className={`w-5 h-5 ${dataLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleAdminLogout}
              className="px-4 py-2.5 bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white border border-red-500/30 rounded-xl font-bold text-xs flex items-center space-x-2 transition"
            >
              <LogOut className="w-4 h-4" />
              <span>Cerrar Sesión Admin</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 space-y-8">
        
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-slate-800/80 border border-slate-700/80 p-5 rounded-2xl flex items-center space-x-4 shadow-sm">
              <div className="p-3.5 bg-blue-500/20 text-blue-400 rounded-xl">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Familias Registradas</p>
                <p className="text-3xl font-bold text-white">{stats.total_families}</p>
              </div>
            </div>

            <div className="bg-slate-800/80 border border-slate-700/80 p-5 rounded-2xl flex items-center space-x-4 shadow-sm">
              <div className="p-3.5 bg-amber-500/20 text-amber-400 rounded-xl">
                <Crown className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Planes Pago Activos</p>
                <p className="text-3xl font-bold text-amber-400">{stats.paid_families}</p>
              </div>
            </div>

            <div className="bg-slate-800/80 border border-slate-700/80 p-5 rounded-2xl flex items-center space-x-4 shadow-sm">
              <div className="p-3.5 bg-slate-700 text-slate-300 rounded-xl">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Planes Gratuitos</p>
                <p className="text-3xl font-bold text-slate-200">{stats.free_families}</p>
              </div>
            </div>

            <div className="bg-slate-800/80 border border-slate-700/80 p-5 rounded-2xl flex items-center space-x-4 shadow-sm">
              <div className="p-3.5 bg-emerald-500/20 text-emerald-400 rounded-xl">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">Consultas WhatsApp Hoy</p>
                <p className="text-3xl font-bold text-emerald-400">{stats.total_queries_today}</p>
              </div>
            </div>
          </div>
        )}

        {/* Filter and Table */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input 
                type="text"
                placeholder="Buscar por código, familia o WhatsApp..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-slate-400">
              Total Familias: <span className="font-bold text-white">{filteredFamilies.length}</span>
            </p>
          </div>

          {dataError && (
            <div className="p-4 bg-red-500/20 text-red-300 border border-red-500/40 rounded-xl text-sm flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{dataError}</span>
            </div>
          )}

          <div className="bg-slate-800/90 border border-slate-700 rounded-2xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-xs border-b border-slate-700">
                  <tr>
                    <th className="px-6 py-4">Familia</th>
                    <th className="px-6 py-4">WhatsApp Principal</th>
                    <th className="px-6 py-4">Plan Actual</th>
                    <th className="px-6 py-4">Consultas WhatsApp Hoy</th>
                    <th className="px-6 py-4 text-right">Acciones Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/60">
                  {dataLoading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-500" />
                        Cargando información del servidor...
                      </td>
                    </tr>
                  ) : filteredFamilies.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                        No se encontraron familias registradas en el sistema.
                      </td>
                    </tr>
                  ) : (
                    filteredFamilies.map((fam) => {
                      const used = fam.queries_used_today || 0;
                      const max = fam.max_daily_whatsapp_queries ?? 5;
                      const percent = Math.min(100, Math.round((used / max) * 100));
                      const isPaid = fam.plan_type === 'pago';

                      return (
                        <tr key={fam.id} className="hover:bg-slate-750/50 transition">
                          <td className="px-6 py-4">
                            <div>
                              <div className="font-bold text-white text-base">{fam.name}</div>
                              <div className="text-xs text-slate-400 font-mono">Código: @{fam.code}</div>
                            </div>
                          </td>

                          <td className="px-6 py-4 font-mono text-xs text-slate-300">
                            {fam.phone_number ? `+${fam.phone_number}` : 'Sin registrar'}
                          </td>

                          <td className="px-6 py-4">
                            {isPaid ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 rounded-full text-xs shadow-xs">
                                <Crown className="w-3.5 h-3.5 text-amber-400" /> Plan Pago
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700/80 text-slate-300 font-medium border border-slate-600 rounded-full text-xs">
                                Plan Gratuito
                              </span>
                            )}
                          </td>

                          <td className="px-6 py-4 min-w-[220px]">
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span className={used >= max ? 'text-red-400 font-bold' : 'text-slate-200'}>
                                  {used} / {max} consultas
                                </span>
                                <span className="text-slate-400">{percent}%</span>
                              </div>
                              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    used >= max ? 'bg-red-500' : isPaid ? 'bg-amber-400' : 'bg-blue-500'
                                  }`} 
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              {/* Toggle Plan */}
                              {isPaid ? (
                                <button
                                  onClick={() => handlePlanToggle(fam, 'gratuito')}
                                  disabled={updatingId === fam.id}
                                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-medium transition"
                                  title="Cambiar a Plan Gratuito (Límite 5/día)"
                                >
                                  Bajar a Gratuito
                                </button>
                              ) : (
                                <button
                                  onClick={() => handlePlanToggle(fam, 'pago')}
                                  disabled={updatingId === fam.id}
                                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-xl text-xs transition flex items-center space-x-1 shadow-md shadow-amber-500/20"
                                  title="Activar Plan Pago (Límite 50/día)"
                                >
                                  <Crown className="w-3.5 h-3.5" />
                                  <span>Activar Plan Pago</span>
                                </button>
                              )}

                              {/* Custom limit editor */}
                              {editingLimitId === fam.id ? (
                                <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-700">
                                  <input 
                                    type="number"
                                    min="1"
                                    max="1000"
                                    value={customLimit}
                                    onChange={(e) => setCustomLimit(Number(e.target.value))}
                                    className="w-16 px-2 py-1 bg-slate-800 text-white rounded text-xs text-center focus:outline-none"
                                  />
                                  <button 
                                    onClick={() => handleSaveCustomLimit(fam.id)}
                                    className="p-1 bg-blue-600 text-white rounded hover:bg-blue-500"
                                    title="Guardar"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => setEditingLimitId(null)}
                                    className="p-1 bg-slate-700 text-slate-300 rounded hover:bg-slate-600"
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
                                  className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded-xl transition"
                                  title="Editar límite personalizado"
                                >
                                  <Sliders className="w-4 h-4" />
                                </button>
                              )}

                              {/* Reset usage */}
                              <button
                                onClick={() => handleResetUsage(fam.id, fam.name)}
                                disabled={updatingId === fam.id}
                                className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-xl transition"
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

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 px-6 py-4 text-center text-xs text-slate-500">
        MedFamilia SuperAdmin Console • Acceso Restringido en /admin
      </footer>
    </div>
  );
};
