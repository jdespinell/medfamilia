import React, { useState } from 'react';
import { X, FileText, Upload, Sparkles, AlertTriangle, CheckCircle, ExternalLink, Info } from 'lucide-react';
import { apiRequest } from '../api';
import { Patient, Appointment, Specialty } from '../types';

interface ExamModalProps {
  patients: Patient[];
  appointments: Appointment[];
  specialties?: Specialty[];
  initialPatientId?: string;
  initialSpecialty?: string;
  onClose: () => void;
  onSaved: () => void;
}

export const ExamModal: React.FC<ExamModalProps> = ({
  patients,
  appointments,
  specialties = [],
  initialPatientId,
  initialSpecialty,
  onClose,
  onSaved,
}) => {
  const [patientId, setPatientId] = useState(initialPatientId || patients[0]?.id || '');
  const [appointmentId, setAppointmentId] = useState('');
  const [title, setTitle] = useState('');
  const [specialty, setSpecialty] = useState(initialSpecialty || '');
  const [notes, setNotes] = useState('');
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 16)); // default today
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiSummaryResult, setAiSummaryResult] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      setFile(f);
      if (!title) {
        const cleanName = f.name.replace(/\.[^/.]+$/, '');
        setTitle(`Resultado ${cleanName}`);
      }
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title || !patientId) return;

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('patient_id', patientId);
      formData.append('title', title);
      if (appointmentId) formData.append('appointment_id', appointmentId);
      if (specialty) formData.append('specialty', specialty);
      if (notes) formData.append('notes', notes);
      if (examDate) formData.append('exam_date', new Date(examDate).toISOString());

      const res = await apiRequest('/exams/upload', {
        method: 'POST',
        body: formData,
      });

      setAiSummaryResult(res.summary_ai);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Error subiendo y analizando el examen.');
    } finally {
      setLoading(false);
    }
  };

  // Examen appointments for the selected patient
  const patientAppointments = appointments.filter(
    (a) => a.patient_id === patientId && (a.appointment_type === 'examen' || a.appointment_type === 'laboratorio')
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-emerald-600" />
            <span>Subir Resultado de Examen</span>
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {aiSummaryResult ? (
            /* AI Summary Result View */
            <div className="space-y-5 animate-in fade-in">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-bold">¡Examen guardado y analizado con éxito!</p>
                  <p className="text-xs text-emerald-700">Gemini ha generado un resumen en lenguaje claro para entender los resultados.</p>
                </div>
              </div>

              <div className="p-5 rounded-3xl bg-slate-50 border-2 border-slate-200 space-y-3">
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-500 fill-amber-500" />
                  <span>Resumen Explicativo de la IA</span>
                </h3>
                <div className="prose prose-slate max-w-none text-slate-800 text-sm leading-relaxed whitespace-pre-line font-medium">
                  {aiSummaryResult}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-4 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-2xl shadow-lg shadow-emerald-600/30 transition"
              >
                Entendido y Cerrar
              </button>
            </div>
          ) : (
            /* Upload Form */
            <form onSubmit={handleUpload} className="space-y-5">
              {/* Patient Selector */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  ¿De quién es el examen?
                </label>
                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-emerald-600 focus:outline-none bg-slate-50 font-bold"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.relationship || 'Familia'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Nombre o Tipo de Examen
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Examen de Sangre - Cuadro Hemático"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-emerald-600 focus:outline-none bg-slate-50 font-semibold"
                />
              </div>

              {/* Specialty */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Especialidad (recomendado)
                </label>
                <select
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-emerald-600 focus:outline-none bg-slate-50 font-semibold"
                >
                  <option value="">Sin especialidad específica</option>
                  {specialties.map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Exam Date */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Fecha del Examen
                </label>
                <input
                  type="datetime-local"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-emerald-600 focus:outline-none bg-slate-50 font-semibold"
                />
              </div>

              {/* Optional Appointment Link */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Vincular a cita de examen previa (opcional)
                </label>
                <select
                  value={appointmentId}
                  onChange={(e) => setAppointmentId(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-emerald-600 focus:outline-none bg-slate-50"
                >
                  <option value="">Ninguna — Se creará cita de examen automáticamente</option>
                  {patientAppointments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} ({new Date(a.date_time).toLocaleDateString('es-ES')})
                    </option>
                  ))}
                </select>
                {!appointmentId && (
                  <div className="mt-2 p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-2 text-xs font-medium text-blue-700">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Se creará automáticamente una cita de tipo "examen" con la fecha indicada arriba para organizar este resultado en el historial.</span>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Notas adicionales (opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="ej. Tomado en ayunas, laboratorio X..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-3.5 text-sm rounded-2xl border-2 border-slate-200 focus:border-emerald-600 focus:outline-none bg-slate-50 font-medium resize-none"
                />
              </div>

              {/* File Uploader */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Archivo del resultado (PDF o Imagen)
                </label>
                <div className="border-2 border-dashed border-slate-300 rounded-3xl p-6 text-center hover:border-emerald-500 bg-slate-50 transition cursor-pointer">
                  <label className="cursor-pointer flex flex-col items-center gap-2">
                    <Upload className="w-10 h-10 text-emerald-600" />
                    {file ? (
                      <p className="text-base font-bold text-emerald-700">{file.name}</p>
                    ) : (
                      <>
                        <p className="text-base font-bold text-slate-800">Seleccionar PDF o foto de examen</p>
                        <p className="text-xs text-slate-500">Admite archivos .pdf, .jpg, .png</p>
                      </>
                    )}
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !file}
                className="w-full py-4 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-2xl shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                {loading ? (
                  <span>Analizando examen con Gemini IA...</span>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>Subir y Procesar Resumen con IA</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
