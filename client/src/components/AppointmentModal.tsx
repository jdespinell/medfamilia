import React, { useState } from 'react';
import { X, Camera, Sparkles, AlertTriangle, Calendar as CalendarIcon, Clock, MapPin, UserCheck, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../api';
import { Patient, Appointment } from '../types';

interface AppointmentModalProps {
  patients: Patient[];
  appointmentToEdit?: Appointment | null;
  onClose: () => void;
  onSaved: () => void;
}

export const AppointmentModal: React.FC<AppointmentModalProps> = ({
  patients,
  appointmentToEdit,
  onClose,
  onSaved,
}) => {
  const [tab, setTab] = useState<'photo' | 'text' | 'manual'>(appointmentToEdit ? 'manual' : 'photo');
  const [loadingAi, setLoadingAi] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // AI Inputs
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(appointmentToEdit?.photo_url || null);
  const [freeText, setFreeText] = useState('');

  // Form Fields (Extracted or Manual)
  const [patientId, setPatientId] = useState(appointmentToEdit?.patient_id || patients[0]?.id || '');
  const [title, setTitle] = useState(appointmentToEdit?.title || '');
  const [appointmentType, setAppointmentType] = useState<Appointment['appointment_type']>(appointmentToEdit?.appointment_type || 'consulta');
  const [specialist, setSpecialist] = useState(appointmentToEdit?.specialist || '');
  const [specialty, setSpecialty] = useState(appointmentToEdit?.specialty || '');
  const [location, setLocation] = useState(appointmentToEdit?.location || '');
  const [dateTime, setDateTime] = useState(
    appointmentToEdit?.date_time
      ? appointmentToEdit.date_time.substring(0, 16)
      : new Date().toISOString().substring(0, 16)
  );
  const [requiresFasting, setRequiresFasting] = useState(Boolean(appointmentToEdit?.requires_fasting));
  const [prepInstructions, setPrepInstructions] = useState(appointmentToEdit?.prep_instructions || '');
  const [photoUrl, setPhotoUrl] = useState(appointmentToEdit?.photo_url || '');

  // Step 2 Verification Modal flag
  const [isVerified, setIsVerified] = useState(Boolean(appointmentToEdit));

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPreviewPhoto(URL.createObjectURL(file));
    }
  };

  const handleProcessPhoto = async () => {
    if (!photoFile) return;
    setLoadingAi(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('photo', photoFile);

      const res = await apiRequest('/appointments/ai-photo', {
        method: 'POST',
        body: formData,
      });

      const ext = res.extracted;
      if (ext.title) setTitle(ext.title);
      if (ext.appointment_type) setAppointmentType(ext.appointment_type);
      if (ext.specialist) setSpecialist(ext.specialist);
      if (ext.specialty) setSpecialty(ext.specialty);
      if (ext.location) setLocation(ext.location);
      if (ext.date_time) setDateTime(ext.date_time.substring(0, 16));
      if (ext.requires_fasting !== undefined) setRequiresFasting(ext.requires_fasting);
      if (ext.prep_instructions) setPrepInstructions(ext.prep_instructions);
      if (res.photo_url) setPhotoUrl(res.photo_url);

      setIsVerified(true);
    } catch (err: any) {
      setError(err.message || 'No se pudo procesar la foto con la IA.');
    } finally {
      setLoadingAi(false);
    }
  };

  const handleProcessText = async () => {
    if (!freeText.trim()) return;
    setLoadingAi(true);
    setError('');

    try {
      const res = await apiRequest('/appointments/ai-text', {
        method: 'POST',
        body: JSON.stringify({ text: freeText }),
      });

      if (res.title) setTitle(res.title);
      if (res.appointment_type) setAppointmentType(res.appointment_type);
      if (res.specialist) setSpecialist(res.specialist);
      if (res.specialty) setSpecialty(res.specialty);
      if (res.location) setLocation(res.location);
      if (res.date_time) setDateTime(res.date_time.substring(0, 16));
      if (res.requires_fasting !== undefined) setRequiresFasting(res.requires_fasting);
      if (res.prep_instructions) setPrepInstructions(res.prep_instructions);

      setIsVerified(true);
    } catch (err: any) {
      setError(err.message || 'Error procesando el texto con Gemini.');
    } finally {
      setLoadingAi(false);
    }
  };

  const handleSaveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload = {
        patient_id: patientId,
        title,
        appointment_type: appointmentType,
        specialist,
        specialty,
        location,
        date_time: new Date(dateTime).toISOString(),
        requires_fasting: requiresFasting,
        prep_instructions: prepInstructions,
        photo_url: photoUrl,
      };

      if (appointmentToEdit) {
        await apiRequest(`/appointments/${appointmentToEdit.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/appointments', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al guardar la cita.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h2 className="text-xl font-black text-slate-900">
            {appointmentToEdit ? 'Editar Cita Médica' : 'Registrar Nueva Cita'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {error && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Mode Selector Tabs (If not yet verified or inserting new) */}
          {!appointmentToEdit && !isVerified && (
            <div className="grid grid-cols-3 gap-2 p-1.5 bg-slate-100 rounded-2xl">
              <button
                type="button"
                onClick={() => setTab('photo')}
                className={`py-2.5 px-3 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition ${
                  tab === 'photo' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Camera className="w-4 h-4" />
                <span>Foto IA</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('text')}
                className={`py-2.5 px-3 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition ${
                  tab === 'text' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                <span>Texto IA</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('manual');
                  setIsVerified(true);
                }}
                className={`py-2.5 px-3 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition ${
                  tab === 'manual' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Manual</span>
              </button>
            </div>
          )}

          {/* TAB 1: Photo Upload */}
          {tab === 'photo' && !isVerified && (
            <div className="space-y-4 text-center">
              <div className="border-2 border-dashed border-slate-300 rounded-3xl p-6 hover:border-blue-500 bg-slate-50 transition">
                {previewPhoto ? (
                  <div className="relative group max-h-56 overflow-hidden rounded-2xl">
                    <img src={previewPhoto} alt="Foto Cita" className="w-full h-auto object-cover" />
                  </div>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
                      <Camera className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-800">Tomar foto o subir recordatorio</p>
                      <p className="text-xs text-slate-500">Gemini leerá automáticamente la fecha, especialidad y lugar</p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {previewPhoto && (
                <button
                  type="button"
                  onClick={handleProcessPhoto}
                  disabled={loadingAi}
                  className="w-full py-4 text-base font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {loadingAi ? (
                    <span>Leyendo la foto con Gemini IA...</span>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      <span>Extraer Datos con Inteligencia Artificial</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* TAB 2: Text Extraction */}
          {tab === 'text' && !isVerified && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-2">
                  Escribe o pega la información de la cita
                </label>
                <textarea
                  rows={4}
                  placeholder="ej. Tengo cita con el cardiólogo Dr. Pérez el 25 de agosto a las 3:00 PM en la Clínica Las Américas. Ir en ayunas."
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  className="w-full p-4 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 focus:bg-white transition"
                />
              </div>
              <button
                type="button"
                onClick={handleProcessText}
                disabled={loadingAi || !freeText.trim()}
                className="w-full py-4 text-base font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                {loadingAi ? (
                  <span>Procesando texto con Gemini...</span>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>Analizar Texto con IA</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* STEP 2: VERIFICATION & EDIT FORM */}
          {isVerified && (
            <form onSubmit={handleSaveAppointment} className="space-y-5">
              {!appointmentToEdit && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>Por favor confirma o corrige los datos extraídos antes de guardar:</span>
                </div>
              )}

              {/* Patient Selector */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  ¿Para quién es la cita?
                </label>
                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 font-bold"
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
                  Título o Motivo de la Cita
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Consulta Cardiología"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 font-semibold"
                />
              </div>

              {/* Appointment Type */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">Tipo de Evento</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'consulta', label: '🩺 Consulta Médica' },
                    { id: 'examen', label: '📋 Examen' },
                    { id: 'laboratorio', label: '🧪 Laboratorio' },
                    { id: 'procedimiento', label: '🏥 Procedimiento' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setAppointmentType(t.id as any)}
                      className={`p-3 rounded-2xl text-sm font-bold border-2 transition text-left ${
                        appointmentType === t.id
                          ? 'border-blue-600 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date & Time */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">Fecha y Hora</label>
                <input
                  type="datetime-local"
                  required
                  value={dateTime}
                  onChange={(e) => setDateTime(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 font-semibold"
                />
              </div>

              {/* Doctor / Specialist & Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1.5">Especialista / Médico</label>
                  <input
                    type="text"
                    placeholder="ej. Dr. Carlos Pérez"
                    value={specialist}
                    onChange={(e) => setSpecialist(e.target.value)}
                    className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1.5">Lugar / Clínica</label>
                  <input
                    type="text"
                    placeholder="ej. Clínica Las Américas"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50"
                  />
                </div>
              </div>

              {/* Fasting Checkbox */}
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-black">
                    ⚠️
                  </div>
                  <div>
                    <p className="text-base font-bold text-amber-900">¿Requiere Ayuno?</p>
                    <p className="text-xs text-amber-700">Muestra una alerta visual clara para los padres</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={requiresFasting}
                  onChange={(e) => setRequiresFasting(e.target.checked)}
                  className="w-6 h-6 rounded-lg text-amber-600 accent-amber-600 cursor-pointer"
                />
              </div>

              {/* Prep Instructions */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Indicaciones previas (opcional)
                </label>
                <input
                  type="text"
                  placeholder="ej. Llevar exámenes anteriores, llegar 20 min antes"
                  value={prepInstructions}
                  onChange={(e) => setPrepInstructions(e.target.value)}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50"
                />
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center gap-3">
                {!appointmentToEdit && (
                  <button
                    type="button"
                    onClick={() => setIsVerified(false)}
                    className="py-4 px-5 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-2xl transition"
                  >
                    Atrás
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-4 text-lg font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : 'Confirmar y Guardar Cita'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
