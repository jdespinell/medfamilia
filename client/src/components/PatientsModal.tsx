import React, { useState } from 'react';
import { X, Plus, Trash2, Calendar, Check, ExternalLink } from 'lucide-react';
import { apiRequest } from '../api';
import { Patient } from '../types';

interface PatientsModalProps {
  patients: Patient[];
  onClose: () => void;
  onRefresh: () => void;
}

const COLOR_OPTIONS = [
  '#3b82f6', // Blue
  '#10b981', // Emerald/Green
  '#8b5cf6', // Purple
  '#f59e0b', // Amber/Orange
  '#ec4899', // Pink
  '#06b6d4', // Cyan
];

export const PatientsModal: React.FC<PatientsModalProps> = ({
  patients,
  onClose,
  onRefresh,
}) => {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('Padre');
  const [color, setColor] = useState('#3b82f6');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAddPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError('');

    try {
      await apiRequest('/patients', {
        method: 'POST',
        body: JSON.stringify({ name, relationship, color }),
      });
      setName('');
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Error agregando familiar.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePatient = async (id: string) => {
    if (!window.confirm('¿Seguro que deseas eliminar este familiar?')) return;
    try {
      await apiRequest(`/patients/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Error eliminando familiar.');
    }
  };

  const handleConnectGoogleCalendar = async (patientId: string) => {
    try {
      const res = await apiRequest(`/calendar/auth-url/${patientId}`);
      if (res.url) {
        window.open(res.url, '_blank', 'width=500,height=600');
      }
    } catch (err: any) {
      alert(err.message || 'Google OAuth no configurado en el servidor.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h2 className="text-xl font-black text-slate-900">Gestionar Familiares</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* List of current family patients */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Miembros de la familia</h3>
            {patients.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-2xl border-2 border-slate-100 bg-slate-50 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: p.color }}
                  />
                  <div>
                    <p className="text-base font-extrabold text-slate-900">{p.name}</p>
                    <p className="text-xs font-semibold text-slate-500">{p.relationship || 'Familiar'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleConnectGoogleCalendar(p.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                      p.google_refresh_token
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-blue-100 hover:bg-blue-200 text-blue-800'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{p.google_refresh_token ? 'Google Conectado' : 'Conectar Google'}</span>
                  </button>

                  {patients.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeletePatient(p.id)}
                      className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add new family member form */}
          <form onSubmit={handleAddPatient} className="p-5 rounded-3xl bg-blue-50 border-2 border-blue-100 space-y-4">
            <h3 className="text-base font-bold text-blue-900 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" />
              <span>Agregar Nuevo Familiar</span>
            </h3>

            {error && <p className="text-xs font-bold text-red-600">{error}</p>}

            <div>
              <input
                type="text"
                required
                placeholder="Nombre (ej. Mamá, Tía Carmen)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-3 text-base rounded-xl border border-blue-200 focus:outline-none bg-white font-semibold"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Parentesco (ej. Madre)"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                className="w-full p-3 text-base rounded-xl border border-blue-200 focus:outline-none bg-white"
              />
              <div className="flex items-center justify-around bg-white p-2 rounded-xl border border-blue-200">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-6 h-6 rounded-full flex items-center justify-center transition"
                    style={{ backgroundColor: c }}
                  >
                    {color === c && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Agregar Familiar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
