import React, { useState } from 'react';
import { Sparkles, Trash2, CheckCircle2, FileText, ImageIcon, X, AlertTriangle } from 'lucide-react';
import { MedicalOrder } from '../types';

export interface DraftOrder {
  temp_id: string;
  appointment_id: string;
  patient_id: string;
  patient_name?: string;
  order_type: MedicalOrder['order_type'];
  title: string;
  description: string;
  file_url?: string;
  file_type?: string;
}

interface OrderConfirmationModalProps {
  isOpen: boolean;
  draftOrders: DraftOrder[];
  onConfirm: (confirmedOrders: DraftOrder[]) => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  isOpen,
  draftOrders: initialDrafts,
  onConfirm,
  onCancel,
  isSaving = false,
}) => {
  const [drafts, setDrafts] = useState<DraftOrder[]>(initialDrafts);

  if (!isOpen) return null;

  const handleFieldChange = (tempId: string, field: keyof DraftOrder, value: any) => {
    setDrafts((prev) =>
      prev.map((item) => (item.temp_id === tempId ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveDraft = (tempId: string) => {
    setDrafts((prev) => prev.filter((item) => item.temp_id !== tempId));
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (drafts.length === 0) {
      alert('No hay órdenes para confirmar.');
      return;
    }
    onConfirm(drafts);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-purple-700 to-indigo-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-white/20 backdrop-blur-md">
              <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-black leading-tight">Revisar Órdenes Identificadas</h3>
              <p className="text-xs text-purple-200 font-medium">
                La IA identificó {drafts.length} orden(es). Verifica y edita si es necesario.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/20 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Modal Content / Draft List */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>¡Verifica los datos!</strong> Puede que la IA confunda algún término o título. Revisa y modifica los campos directamente antes de guardar.
            </span>
          </div>

          {drafts.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-sm font-bold text-slate-500">No quedan órdenes para confirmar.</p>
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-xl bg-slate-200 text-slate-700 font-bold text-xs"
              >
                Volver
              </button>
            </div>
          ) : (
            drafts.map((draft, index) => (
              <div
                key={draft.temp_id}
                className="p-4 rounded-2xl bg-slate-50 border-2 border-indigo-100 space-y-3 relative group hover:border-indigo-300 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-900 font-black text-xs uppercase tracking-wider">
                    Orden #{index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveDraft(draft.temp_id)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition flex items-center gap-1 text-xs font-bold"
                    title="Descartar esta orden"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Descartar</span>
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700">Título de la Orden:</label>
                  <input
                    type="text"
                    required
                    value={draft.title}
                    onChange={(e) => handleFieldChange(draft.temp_id, 'title', e.target.value)}
                    className="w-full p-3 text-sm rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Tipo de Orden:</label>
                    <select
                      value={draft.order_type}
                      onChange={(e) => handleFieldChange(draft.temp_id, 'order_type', e.target.value as any)}
                      className="w-full p-3 text-sm rounded-xl border border-slate-300 bg-white font-bold text-slate-900"
                    >
                      <option value="examen">🔬 Examen / Ecografía / Rx</option>
                      <option value="especialista">👨‍⚕️ Especialista / Remisión</option>
                      <option value="laboratorio">🔬 Laboratorio Clínico</option>
                      <option value="procedimiento">🏥 Procedimiento / Cirugía</option>
                    </select>
                  </div>

                  {draft.file_url && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Archivo Adjunto:</label>
                      <a
                        href={draft.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2.5 rounded-xl bg-white border border-slate-300 flex items-center justify-between text-xs font-bold text-indigo-600 hover:underline"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          {draft.file_type === 'pdf' ? (
                            <FileText className="w-4 h-4 text-red-500 shrink-0" />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-blue-500 shrink-0" />
                          )}
                          <span className="truncate">Ver Orden Adjunta</span>
                        </div>
                      </a>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">Descripción / Exámenes contenidos:</label>
                  <textarea
                    rows={2}
                    value={draft.description}
                    onChange={(e) => handleFieldChange(draft.temp_id, 'description', e.target.value)}
                    className="w-full p-2.5 text-sm rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                    placeholder="Indicaciones o detalles de la orden..."
                  />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        {drafts.length > 0 && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 transition"
            >
              Descartar Todo
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-md flex items-center gap-2 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSaving ? 'Guardando...' : `Confirmar y Guardar (${drafts.length})`}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
