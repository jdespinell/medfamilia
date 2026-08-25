import React, { useState, useRef } from 'react';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  User,
  AlertCircle,
  FileText,
  Upload,
  Sparkles,
  Edit,
  CheckCircle2,
  FileDown,
  ExternalLink,
  MessageSquare,
  Save,
  Plus,
  Camera,
  Image as ImageIcon
} from 'lucide-react';
import { apiRequest, getFileUrl } from '../api';
import { Appointment, ExamResult } from '../types';

interface AppointmentDetailModalProps {
  appointment: Appointment;
  onClose: () => void;
  onRefresh: () => void;
  onEdit: (appointment: Appointment) => void;
}

export const AppointmentDetailModal: React.FC<AppointmentDetailModalProps> = ({
  appointment,
  onClose,
  onRefresh,
  onEdit,
}) => {
  const [doctorNotes, setDoctorNotes] = useState(appointment.doctor_notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSuccess, setNotesSuccess] = useState(false);

  // File Input Refs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Upload results modal state inside detail view
  const [showUploadResult, setShowUploadResult] = useState(false);
  const [resultTitle, setResultTitle] = useState('');
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [uploadingResult, setUploadingResult] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const [attachedResults, setAttachedResults] = useState<ExamResult[]>(appointment.attached_results || []);

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    setNotesSuccess(false);

    try {
      await apiRequest(`/appointments/${appointment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ doctor_notes: doctorNotes }),
      });
      setNotesSuccess(true);
      setTimeout(() => setNotesSuccess(false), 3000);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Error guardando notas de la consulta.');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setResultFile(e.target.files[0]);
    }
  };

  const handleUploadResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resultFile || !resultTitle) return;

    setUploadingResult(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', resultFile);
      formData.append('patient_id', appointment.patient_id);
      formData.append('appointment_id', appointment.id);
      formData.append('title', resultTitle);

      const res = await apiRequest('/exams/upload', {
        method: 'POST',
        body: formData,
      });

      setAttachedResults([res, ...attachedResults]);
      setShowUploadResult(false);
      setResultTitle('');
      setResultFile(null);
      onRefresh();
    } catch (err: any) {
      setUploadError(err.message || 'Error subiendo el resultado.');
    } finally {
      setUploadingResult(false);
    }
  };

  const dateObj = new Date(appointment.date_time);
  const isFasting = Boolean(appointment.requires_fasting);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95">
        {/* Top Header Bar */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <span
              className="px-3 py-1 rounded-full text-xs font-black text-white shadow-sm"
              style={{ backgroundColor: appointment.patient_color || '#3b82f6' }}
            >
              {appointment.patient_name || 'Paciente'}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-200 text-slate-800 text-xs font-bold uppercase">
              {appointment.appointment_type}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onEdit(appointment);
              }}
              className="p-2 rounded-xl text-blue-600 hover:bg-blue-50 transition font-bold text-xs flex items-center gap-1"
            >
              <Edit className="w-4 h-4" />
              <span className="hidden sm:inline">Editar</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Main Title & Schedule Banner */}
          <div className="space-y-3">
            <h2 className="text-2xl font-black text-slate-900 leading-tight">{appointment.title}</h2>

            <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-100 flex flex-wrap items-center justify-between gap-3 text-sm font-bold">
              <div className="flex items-center gap-2 text-blue-900">
                <Calendar className="w-5 h-5 text-blue-600 shrink-0" />
                <span>
                  {dateObj.toLocaleDateString('es-ES', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-900">
                <Clock className="w-5 h-5 text-slate-500 shrink-0" />
                <span>{dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          </div>

          {/* Details Grid: Specialist & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {appointment.specialist && (
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                <p className="text-xs font-bold text-slate-400 uppercase">Especialista / Médico</p>
                <p className="text-base font-extrabold text-slate-900 flex items-center gap-2 mt-0.5">
                  <User className="w-4 h-4 text-blue-600" />
                  <span>{appointment.specialist}</span>
                </p>
              </div>
            )}

            {appointment.location && (
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                <p className="text-xs font-bold text-slate-400 uppercase">Lugar / Clínica</p>
                <p className="text-base font-extrabold text-slate-900 flex items-center gap-2 mt-0.5">
                  <MapPin className="w-4 h-4 text-red-500" />
                  <span>{appointment.location}</span>
                </p>
              </div>
            )}
          </div>

          {/* Fasting Warning */}
          {isFasting && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 font-extrabold text-sm flex items-center gap-3 shadow-sm">
              <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
              <div>
                <p className="text-base">⚠️ ESTA CITA REQUIERE AYUNO</p>
                <p className="text-xs font-normal text-amber-800">Recuerde no ingerir alimentos antes de presentarse.</p>
              </div>
            </div>
          )}

          {/* Prep Instructions */}
          {appointment.prep_instructions && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
              <p className="text-xs font-bold text-slate-500 uppercase">💡 Indicaciones de Preparación</p>
              <p className="text-sm font-semibold text-slate-800">{appointment.prep_instructions}</p>
            </div>
          )}

          {/* Original Order / Photo Document Link */}
          {appointment.photo_url && (
            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-blue-600" />
                <div>
                  <p className="text-sm font-bold text-blue-900">Orden o Documento Inicial de la Cita</p>
                  <p className="text-xs text-blue-700">Foto o archivo escaneado con la IA</p>
                </div>
              </div>
              <a
                href={getFileUrl(appointment.photo_url)}
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm"
              >
                <span>Ver Archivo</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          <hr className="border-slate-200" />

          {/* SECTION: SEGUIMIENTO Y RESULTADOS DE EXÁMENES */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-600" />
                <span>Resultados de Exámenes ({attachedResults.length})</span>
              </h3>
              <button
                onClick={() => setShowUploadResult(!showUploadResult)}
                className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center gap-1.5 transition border border-emerald-200"
              >
                <Plus className="w-4 h-4 text-emerald-600" />
                <span>Adjuntar Resultado</span>
              </button>
            </div>

            {/* Inline Form to Upload New Exam Result attached to this appointment */}
            {showUploadResult && (
              <form onSubmit={handleUploadResult} className="p-4 rounded-2xl bg-emerald-50/70 border-2 border-emerald-200 space-y-3 animate-in fade-in">
                <h4 className="text-sm font-bold text-emerald-900">Subir Resultado o Informe Médico (PDF o Foto)</h4>

                {uploadError && <p className="text-xs font-bold text-red-600">{uploadError}</p>}

                <input
                  type="text"
                  required
                  placeholder="ej. Resultados de Sangre / Ecografía"
                  value={resultTitle}
                  onChange={(e) => setResultTitle(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-emerald-200 bg-white font-semibold"
                />

                {/* 3 Explicit Buttons for Camera, Gallery, or PDF */}
                {resultFile ? (
                  <div className="p-3 bg-white border border-emerald-300 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">{resultFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setResultFile(null)}
                      className="text-xs text-red-600 font-bold hover:underline"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="p-3 rounded-xl bg-white border border-emerald-200 text-emerald-900 flex flex-col items-center gap-1 transition active:scale-95"
                    >
                      <Camera className="w-5 h-5 text-emerald-600" />
                      <span className="font-bold text-xs">Cámara</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="p-3 rounded-xl bg-white border border-emerald-200 text-emerald-900 flex flex-col items-center gap-1 transition active:scale-95"
                    >
                      <ImageIcon className="w-5 h-5 text-emerald-600" />
                      <span className="font-bold text-xs">Galería</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                      className="p-3 rounded-xl bg-white border border-emerald-200 text-emerald-900 flex flex-col items-center gap-1 transition active:scale-95"
                    >
                      <FileText className="w-5 h-5 text-emerald-600" />
                      <span className="font-bold text-xs">PDF</span>
                    </button>
                  </div>
                )}

                {/* Hidden Inputs */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowUploadResult(false)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-200 text-slate-700"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={uploadingResult || !resultFile}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50"
                  >
                    {uploadingResult ? 'Procesando con IA...' : 'Subir y Generar Resumen IA'}
                  </button>
                </div>
              </form>
            )}

            {/* List of Attached Results */}
            {attachedResults.length === 0 ? (
              <p className="text-xs font-medium text-slate-400 italic">No se han adjuntado resultados a esta cita aún.</p>
            ) : (
              attachedResults.map((r) => (
                <div key={r.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-base font-bold text-slate-900">{r.title}</h4>
                    <a
                      href={getFileUrl(r.file_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs flex items-center gap-1"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>Ver Archivo</span>
                    </a>
                  </div>

                  {r.summary_ai && (
                    <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-slate-800 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-amber-800">
                        <Sparkles className="w-4 h-4 fill-amber-500" />
                        <span>Resumen explicativo de Gemini IA:</span>
                      </div>
                      <div className="whitespace-pre-line font-medium text-slate-800 leading-relaxed">
                        {r.summary_ai}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <hr className="border-slate-200" />

          {/* SECTION: NOTAS DE LA CONSULTA / DOCTOR */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-600" />
                <span>Notas / Comentarios de la Consulta</span>
              </h3>
              {notesSuccess && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> ¡Guardado!
                </span>
              )}
            </div>

            <textarea
              rows={4}
              placeholder="Escribe aquí los comentarios del doctor, medicamentos recetados o recomendaciones de la consulta..."
              value={doctorNotes}
              onChange={(e) => setDoctorNotes(e.target.value)}
              className="w-full p-4 text-sm rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 focus:bg-white font-medium"
            />

            <button
              type="button"
              onClick={handleSaveNotes}
              disabled={savingNotes}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-2xl shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{savingNotes ? 'Guardando Notas...' : 'Guardar Notas del Doctor'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
