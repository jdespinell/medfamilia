import React, { useState } from 'react';
import { CheckCircle2, XCircle, CalendarClock, Clock, ChevronDown, History, Loader2 } from 'lucide-react';
import { apiRequest } from '../api';
import { Appointment, AppointmentHistory } from '../types';

interface StatusActionMenuProps {
  appointment: Appointment;
  onRefresh: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  pendiente: {
    label: 'Pendiente',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: <Clock className="w-4 h-4" />,
  },
  realizada: {
    label: 'Realizada',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  cancelada: {
    label: 'Cancelada',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: <XCircle className="w-4 h-4" />,
  },
  reprogramada: {
    label: 'Reprogramada',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: <CalendarClock className="w-4 h-4" />,
  },
};

export const StatusActionMenu: React.FC<StatusActionMenuProps> = ({ appointment, onRefresh }) => {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AppointmentHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showMarkModal, setShowMarkModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const effectiveStatus = appointment.computed_status || appointment.status;
  const cfg = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG['pendiente'];

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const data = await apiRequest(`/appointments/${appointment.id}/history`);
      setHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleMarkRealizada = async () => {
    setSaving(true);
    try {
      await apiRequest(`/appointments/${appointment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'realizada', reason: 'Marcada como realizada manualmente' }),
      });
      onRefresh();
      setShowMarkModal(false);
      setOpen(false);
    } catch (e: any) {
      alert(e.message || 'Error actualizando estado.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    setSaving(true);
    try {
      await apiRequest(`/appointments/${appointment.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason || 'Cancelada por el usuario' }),
      });
      onRefresh();
      setShowCancelModal(false);
      setCancelReason('');
      setOpen(false);
    } catch (e: any) {
      alert(e.message || 'Error cancelando la cita.');
    } finally {
      setSaving(false);
    }
  };

  const canMarkRealizada = effectiveStatus === 'pendiente';
  const canCancel = effectiveStatus !== 'cancelada';

  return (
    <div className="relative">
      {/* Status Badge Button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-sm transition ${cfg.bg} ${cfg.color} ${cfg.border}`}
      >
        {cfg.icon}
        <span>{cfg.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-2 space-y-1">
              {canMarkRealizada && (
                <button
                  onClick={() => { setShowMarkModal(true); setOpen(false); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-emerald-50 text-emerald-700 font-bold text-sm flex items-center gap-2 transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Marcar como Realizada
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => { setShowCancelModal(true); setOpen(false); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-50 text-red-700 font-bold text-sm flex items-center gap-2 transition"
                >
                  <XCircle className="w-4 h-4" />
                  Cancelar Cita
                </button>
              )}
              <div className="border-t border-slate-100 my-1" />
              <button
                onClick={() => {
                  setOpen(false);
                  setShowHistory(true);
                  loadHistory();
                }}
                className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-50 text-slate-700 font-bold text-sm flex items-center gap-2 transition"
              >
                <History className="w-4 h-4" />
                Ver Historial de Cambios
              </button>
            </div>
          </div>
        </>
      )}

      {/* Mark as Realizada Confirmation */}
      {showMarkModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-black text-slate-900">¿Marcar como Realizada?</h3>
            <p className="text-sm text-slate-600">
              Esto indicará que la cita ya fue efectuada. Podrás verla en el historial del paciente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowMarkModal(false)}
                className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleMarkRealizada}
                disabled={saving}
                className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel with Reason Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-black text-slate-900">Cancelar Cita</h3>
            <p className="text-sm text-slate-600">
              Opcionalmente, indica la razón de cancelación. Esto quedará guardado en el historial.
            </p>
            <textarea
              rows={3}
              placeholder="Razón (ej: El médico reprogramó, el paciente no pudo ir...)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full p-3 text-sm rounded-2xl border-2 border-slate-200 focus:border-red-400 focus:outline-none bg-slate-50 font-medium resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowCancelModal(false); setCancelReason(''); }}
                className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm"
              >
                Volver
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Confirmar Cancelación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-slate-600" />
                Historial de Cambios
              </h3>
              <button
                onClick={() => setShowHistory(false)}
                className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-400 italic text-center py-6">
                  Esta cita no tiene historial de cambios registrado.
                </p>
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
                  <div className="space-y-4">
                    {history.map((h, idx) => {
                      const newCfg = STATUS_CONFIG[h.new_status] || STATUS_CONFIG['pendiente'];
                      return (
                        <div key={h.id} className="flex gap-4 pl-1">
                          <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 z-10 ${newCfg.bg} ${newCfg.border}`}>
                            <span className={`${newCfg.color} scale-75`}>{newCfg.icon}</span>
                          </div>
                          <div className="flex-1 pb-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-2 py-0.5 rounded-lg text-xs font-black ${newCfg.bg} ${newCfg.color}`}>
                                {newCfg.label}
                              </span>
                              {h.previous_status && (
                                <span className="text-xs text-slate-400">
                                  (antes: {STATUS_CONFIG[h.previous_status]?.label || h.previous_status})
                                </span>
                              )}
                            </div>
                            {h.reason && (
                              <p className="text-xs text-slate-600 mt-1 italic">&ldquo;{h.reason}&rdquo;</p>
                            )}
                            {h.new_date_time && h.previous_date_time && h.new_date_time !== h.previous_date_time && (
                              <p className="text-xs text-slate-500 mt-1">
                                Fecha: {new Date(h.previous_date_time).toLocaleDateString('es-ES')} → {new Date(h.new_date_time).toLocaleDateString('es-ES')}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1">
                              {new Date(h.created_at).toLocaleString('es-ES')}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
