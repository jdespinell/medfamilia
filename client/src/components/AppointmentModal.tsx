import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, Sparkles, AlertTriangle, CheckCircle2, FileText, Image as ImageIcon, Upload, Plus } from 'lucide-react';
import { apiRequest } from '../api';
import { Patient, Appointment, Specialty, MedicalOrder } from '../types';

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

  // File Input Refs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Specialties
  const [specialtiesList, setSpecialtiesList] = useState<Specialty[]>([]);
  const [isAddingNewSpecialty, setIsAddingNewSpecialty] = useState(false);
  const [newSpecialtyName, setNewSpecialtyName] = useState('');

  // AI Inputs
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(appointmentToEdit?.photo_url || null);
  const [isPdf, setIsPdf] = useState<boolean>(false);
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
  const [doctorNotes, setDoctorNotes] = useState(appointmentToEdit?.doctor_notes || '');

  // Step 2 Verification Modal flag
  const [isVerified, setIsVerified] = useState(Boolean(appointmentToEdit));

  // Pending Orders
  const [pendingOrders, setPendingOrders] = useState<MedicalOrder[]>([]);
  const [originOrderId, setOriginOrderId] = useState<string>('');

  useEffect(() => {
    apiRequest('/specialties')
      .then((data) => setSpecialtiesList(data))
      .catch((err) => console.error('Error cargando especialidades:', err));
  }, []);

  useEffect(() => {
    if (!appointmentToEdit) {
      apiRequest('/medical-orders/pending')
        .then(data => setPendingOrders(data))
        .catch(err => console.error('Error cargando órdenes pendientes:', err));
    }
  }, [appointmentToEdit]);

  const handleCreateCustomSpecialty = async () => {
    if (!newSpecialtyName.trim()) return;
    try {
      const res = await apiRequest('/specialties', {
        method: 'POST',
        body: JSON.stringify({ name: newSpecialtyName }),
      });
      setSpecialtiesList([...specialtiesList, res]);
      setSpecialty(res.name);
      setIsAddingNewSpecialty(false);
      setNewSpecialtyName('');
    } catch (err: any) {
      alert(err.message || 'Error guardando especialidad.');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      const isPdfFile = file.type === 'application/pdf' || file.name.endsWith('.pdf');
      setIsPdf(isPdfFile);

      if (!isPdfFile) {
        setPreviewPhoto(URL.createObjectURL(file));
      } else {
        setPreviewPhoto(null);
      }
    }
  };

  const handleProcessFile = async () => {
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
      setError(err.message || 'No se pudo procesar el archivo con la IA.');
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
        doctor_notes: doctorNotes,
        ...(originOrderId ? { origin_order_id: originOrderId } : {}),
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
                <Upload className="w-4 h-4" />
                <span>Foto / PDF IA</span>
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

          {/* TAB 1: Photo / Gallery / PDF Upload */}
          {tab === 'photo' && !isVerified && (
            <div className="space-y-4">
              {/* Preview if already selected */}
              {previewPhoto ? (
                <div className="relative group max-h-56 overflow-hidden rounded-2xl border-2 border-blue-500 text-center">
                  <img src={previewPhoto} alt="Foto Cita" className="w-full h-auto object-cover max-h-52 mx-auto" />
                  <p className="p-2 text-xs font-bold text-slate-600 bg-slate-100">{photoFile?.name}</p>
                </div>
              ) : isPdf && photoFile ? (
                <div className="flex flex-col items-center gap-2 p-6 rounded-2xl bg-red-50 border-2 border-red-200 text-center">
                  <FileText className="w-14 h-14 text-red-500" />
                  <p className="text-base font-bold text-slate-900">{photoFile.name}</p>
                  <p className="text-xs text-slate-500">Documento PDF listo para procesar con IA</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-slate-800 text-center">
                    Selecciona una opción para extraer los datos de la cita:
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Camera */}
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="p-4 rounded-2xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 flex flex-col items-center gap-2 transition active:scale-95"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                        <Camera className="w-6 h-6" />
                      </div>
                      <span className="font-extrabold text-sm">Tomar Foto</span>
                      <span className="text-[10px] text-blue-700">Abrir Cámara</span>
                    </button>

                    {/* Gallery */}
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="p-4 rounded-2xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 flex flex-col items-center gap-2 transition active:scale-95"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                      <span className="font-extrabold text-sm">Galería</span>
                      <span className="text-[10px] text-amber-700">Elegir de Fotos</span>
                    </button>

                    {/* PDF Document */}
                    <button
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                      className="p-4 rounded-2xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-900 flex flex-col items-center gap-2 transition active:scale-95"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-md shadow-red-500/20">
                        <FileText className="w-6 h-6" />
                      </div>
                      <span className="font-extrabold text-sm">Documento PDF</span>
                      <span className="text-[10px] text-red-700">Archivos PDF</span>
                    </button>
                  </div>

                  {/* Hidden inputs */}
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
                </div>
              )}

              {photoFile && (
                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={handleProcessFile}
                    disabled={loadingAi}
                    className="w-full py-4 text-base font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    {loadingAi ? (
                      <span>Procesando archivo con Gemini IA...</span>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>Extraer Datos con Inteligencia Artificial</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPhotoFile(null);
                      setPreviewPhoto(null);
                      setIsPdf(false);
                    }}
                    className="w-full py-2 text-xs font-bold text-slate-500 hover:text-slate-800"
                  >
                    Cambiar archivo seleccionado
                  </button>
                </div>
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

              {/* Origin Order (Optional) */}
              {!appointmentToEdit && pendingOrders.length > 0 && (
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1.5">
                    📋 Orden de Origen (Opcional)
                  </label>
                  <select
                    value={originOrderId}
                    onChange={(e) => setOriginOrderId(e.target.value)}
                    className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 font-bold"
                  >
                    <option value="">-- Sin orden de origen --</option>
                    {pendingOrders.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.title} ({o.patient_name || 'Paciente'}) - {o.order_type}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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

              {/* Medical Specialty / Specialist Category */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Especialidad Médica / Categoría (opcional)
                </label>
                <select
                  value={isAddingNewSpecialty ? '__add_new__' : specialty}
                  onChange={(e) => {
                    if (e.target.value === '__add_new__') {
                      setIsAddingNewSpecialty(true);
                    } else {
                      setIsAddingNewSpecialty(false);
                      setSpecialty(e.target.value);
                    }
                  }}
                  className="w-full p-3.5 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 font-semibold"
                >
                  <option value="">Sin especialidad / No especificada</option>
                  {specialtiesList.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                  <option value="__add_new__">+ Agregar nueva especialidad...</option>
                </select>

                {isAddingNewSpecialty && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="text"
                      placeholder="Nombre de la nueva especialidad (ej. Reumatología)"
                      value={newSpecialtyName}
                      onChange={(e) => setNewSpecialtyName(e.target.value)}
                      className="w-full p-3 text-sm rounded-xl border-2 border-blue-300 font-semibold"
                    />
                    <button
                      type="button"
                      onClick={handleCreateCustomSpecialty}
                      className="px-4 py-3 rounded-xl bg-blue-600 text-white font-bold text-xs shrink-0 shadow-md shadow-blue-500/20"
                    >
                      Guardar
                    </button>
                  </div>
                )}
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

              {/* Doctor Notes */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  Notas de la Consulta / Comentarios del Doctor (opcional)
                </label>
                <textarea
                  rows={3}
                  placeholder="ej. El doctor recetó Losartán 50mg cada 12 horas. Volver a control en 3 meses."
                  value={doctorNotes}
                  onChange={(e) => setDoctorNotes(e.target.value)}
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
