import React, { useState, useEffect } from 'react';
import {
  Heart,
  Plus,
  Calendar as CalendarIcon,
  ListFilter,
  FileText,
  Users,
  Bell,
  Share2,
  LogOut,
  MapPin,
  Clock,
  User,
  Sparkles,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileDown,
  MessageSquare,
  ChevronRight as ChevronRightIcon
} from 'lucide-react';
import { apiRequest, removeToken } from '../api';
import { Family, Patient, Appointment, ExamResult } from '../types';
import { AppointmentModal } from '../components/AppointmentModal';
import { ExamModal } from '../components/ExamModal';
import { PatientsModal } from '../components/PatientsModal';
import { AppointmentDetailModal } from '../components/AppointmentDetailModal';

interface DashboardProps {
  family: Family;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ family, onLogout }) => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('all');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [exams, setExams] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);

  // View modes
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'exams'>('list');

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Modals
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [appointmentToEdit, setAppointmentToEdit] = useState<Appointment | null>(null);
  const [selectedAppointmentForDetail, setSelectedAppointmentForDetail] = useState<Appointment | null>(null);
  const [showExamModal, setShowExamModal] = useState(false);
  const [showPatientsModal, setShowPatientsModal] = useState(false);

  // Push notification state
  const [pushSubscribed, setPushSubscribed] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [patientsRes, appointmentsRes, examsRes] = await Promise.all([
        apiRequest('/patients'),
        apiRequest(`/appointments?patient_id=${selectedPatientId}`),
        apiRequest(`/exams?patient_id=${selectedPatientId}`),
      ]);

      setPatients(patientsRes);
      setAppointments(appointmentsRes);
      setExams(examsRes);

      // Keep selected detail appointment up to date if open
      if (selectedAppointmentForDetail) {
        const updatedSelected = appointmentsRes.find((a: Appointment) => a.id === selectedAppointmentForDetail.id);
        if (updatedSelected) {
          setSelectedAppointmentForDetail(updatedSelected);
        }
      }
    } catch (err) {
      console.error('Error cargando datos del dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedPatientId]);

  // Request Push Notifications
  const handleEnablePush = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('Este navegador no admite notificaciones Push.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Permiso de notificaciones denegado.');
        return;
      }

      const res = await apiRequest('/push/vapid-key');
      if (!res.publicKey) {
        alert('Las notificaciones push requieren configurar VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el servidor.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: res.publicKey,
      });

      await apiRequest('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription }),
      });

      setPushSubscribed(true);
      alert('¡Notificaciones push activadas correctamente para tu celular!');
    } catch (err: any) {
      console.error('Error activando notificaciones:', err);
      alert('Error activando notificaciones push.');
    }
  };

  // WhatsApp Weekly Share Generator
  const handleShareWhatsApp = () => {
    if (appointments.length === 0) {
      alert('No hay citas para compartir.');
      return;
    }

    let text = `🩺 *Citas Médicas Familiares (${family.name})*\n\n`;

    appointments.slice(0, 10).forEach((a) => {
      const dateStr = new Date(a.date_time).toLocaleString('es-ES', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      const patient = patients.find((p) => p.id === a.patient_id);

      text += `📌 *${a.title}* (${patient?.name || 'Paciente'})\n`;
      text += `📅 ${dateStr}\n`;
      if (a.specialist) text += `👨‍⚕️ ${a.specialist}\n`;
      if (a.location) text += `🏥 ${a.location}\n`;
      if (a.requires_fasting) text += `⚠️ *REQUIERE AYUNO*\n`;
      if (a.prep_instructions) text += `💡 ${a.prep_instructions}\n`;
      text += `-------------------------\n`;
    });

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-28">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <Heart className="w-6 h-6 fill-current" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 leading-none">{family.name}</h1>
              <p className="text-xs font-semibold text-slate-500 mt-1">Citas y Salud Familiar</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleEnablePush}
              title="Activar Notificaciones"
              className={`p-2.5 rounded-2xl border transition ${
                pushSubscribed
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Bell className="w-5 h-5" />
            </button>

            <button
              onClick={handleShareWhatsApp}
              title="Compartir por WhatsApp"
              className="p-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 font-bold text-xs flex items-center gap-1.5 transition"
            >
              <Share2 className="w-4 h-4 text-emerald-600" />
              <span className="hidden sm:inline">WhatsApp</span>
            </button>

            <button
              onClick={onLogout}
              title="Cerrar Sesión"
              className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 transition"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        {/* Patient Selection Bar */}
        <div className="bg-white p-2.5 rounded-3xl shadow-sm border border-slate-200 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedPatientId('all')}
            className={`px-4 py-2.5 rounded-2xl font-bold text-sm shrink-0 transition flex items-center gap-2 ${
              selectedPatientId === 'all'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Todos los Pacientes</span>
          </button>

          {patients.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPatientId(p.id)}
              className={`px-4 py-2.5 rounded-2xl font-bold text-sm shrink-0 transition flex items-center gap-2 border ${
                selectedPatientId === p.id
                  ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
              <span>{p.name}</span>
            </button>
          ))}

          <button
            onClick={() => setShowPatientsModal(true)}
            className="px-3 py-2.5 rounded-2xl bg-blue-50 text-blue-700 font-bold text-xs shrink-0 hover:bg-blue-100 transition"
          >
            + Familiar
          </button>
        </div>

        {/* View Selector Tabs */}
        <div className="grid grid-cols-3 gap-2 p-1.5 bg-slate-200/70 rounded-2xl">
          <button
            onClick={() => setViewMode('list')}
            className={`py-3 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 transition ${
              viewMode === 'list' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListFilter className="w-4 h-4" />
            <span>Próximas Citas</span>
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`py-3 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 transition ${
              viewMode === 'calendar' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarIcon className="w-4 h-4" />
            <span>Calendario</span>
          </button>
          <button
            onClick={() => setViewMode('exams')}
            className={`py-3 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 transition ${
              viewMode === 'exams' ? 'bg-white text-emerald-600 shadow-md' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Exámenes IA ({exams.length})</span>
          </button>
        </div>

        {/* CONTENT VIEW 1: UPCOMING APPOINTMENTS LIST */}
        {viewMode === 'list' && (
          <div className="space-y-4">
            {loading ? (
              <div className="p-8 text-center text-slate-500 font-bold">Cargando citas...</div>
            ) : appointments.length === 0 ? (
              <div className="p-10 text-center bg-white rounded-3xl border border-slate-200 space-y-3">
                <CalendarIcon className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-lg font-bold text-slate-700">No hay citas registradas</p>
                <p className="text-sm text-slate-500">Toca el botón "+ Cita Médica" para agregar por foto o texto.</p>
              </div>
            ) : (
              appointments.map((a) => {
                const dateObj = new Date(a.date_time);
                const isFasting = Boolean(a.requires_fasting);
                const attachedCount = a.attached_results?.length || 0;

                return (
                  <div
                    key={a.id}
                    onClick={() => setSelectedAppointmentForDetail(a)}
                    className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-5 space-y-3 hover:shadow-md transition relative overflow-hidden cursor-pointer group"
                  >
                    {/* Patient Color Left Bar */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-3"
                      style={{ backgroundColor: a.patient_color || '#3b82f6' }}
                    />

                    <div className="pl-2 flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="px-2.5 py-0.5 rounded-full text-xs font-black text-white"
                            style={{ backgroundColor: a.patient_color || '#3b82f6' }}
                          >
                            {a.patient_name || 'Paciente'}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-xs uppercase">
                            {a.appointment_type}
                          </span>
                        </div>
                        <h3 className="text-xl font-black text-slate-900 mt-1 group-hover:text-blue-600 transition">
                          {a.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAppointmentToEdit(a);
                            setShowAppointmentModal(true);
                          }}
                          className="text-xs font-bold text-slate-500 hover:text-blue-600 bg-slate-100 hover:bg-blue-50 px-3 py-1.5 rounded-xl transition"
                        >
                          Editar
                        </button>
                        <ChevronRightIcon className="w-5 h-5 text-slate-400 group-hover:translate-x-0.5 transition" />
                      </div>
                    </div>

                    {/* Date and Time Banner */}
                    <div className="pl-2 flex flex-wrap items-center gap-4 text-sm font-bold text-slate-700 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                      <div className="flex items-center gap-1.5 text-blue-700">
                        <CalendarIcon className="w-4 h-4" />
                        <span>
                          {dateObj.toLocaleDateString('es-ES', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'long',
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-900">
                        <Clock className="w-4 h-4 text-slate-500" />
                        <span>
                          {dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>

                    {/* Details: Doctor, Location */}
                    <div className="pl-2 space-y-1.5 text-sm text-slate-600">
                      {a.specialist && (
                        <p className="flex items-center gap-2 font-medium">
                          <User className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>Especialista: <strong className="text-slate-800">{a.specialist}</strong></span>
                        </p>
                      )}
                      {a.location && (
                        <p className="flex items-center gap-2 font-medium">
                          <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>Lugar: <strong className="text-slate-800">{a.location}</strong></span>
                        </p>
                      )}
                    </div>

                    {/* Fasting Warning */}
                    {isFasting && (
                      <div className="ml-2 p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 font-extrabold text-sm flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                        <span>⚠️ CITA REQUIERE AYUNO</span>
                      </div>
                    )}

                    {/* Attached Results / Notes Summary Badge */}
                    <div className="ml-2 flex flex-wrap items-center gap-2 pt-1">
                      {attachedCount > 0 && (
                        <span className="px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{attachedCount} Resultado(s) adjunto(s)</span>
                        </span>
                      )}

                      {a.doctor_notes && (
                        <span className="px-3 py-1 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                          <span>Con notas del doctor</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* CONTENT VIEW 2: CALENDAR VIEW */}
        {viewMode === 'calendar' && (
          <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-lg font-black text-slate-900 capitalize">
                {currentMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* List of appointments for current view */}
            <div className="space-y-2">
              {appointments.map((a) => (
                <div
                  key={a.id}
                  onClick={() => setSelectedAppointmentForDetail(a)}
                  className="p-3 rounded-2xl border border-slate-100 flex items-center justify-between text-sm cursor-pointer hover:bg-slate-50 transition"
                  style={{ borderLeftWidth: '6px', borderLeftColor: a.patient_color || '#3b82f6' }}
                >
                  <div>
                    <p className="font-bold text-slate-900">{a.title}</p>
                    <p className="text-xs text-slate-500 font-semibold">
                      {new Date(a.date_time).toLocaleString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-bold">
                    {a.patient_name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONTENT VIEW 3: EXAM RESULTS & AI SUMMARIES */}
        {viewMode === 'exams' && (
          <div className="space-y-4">
            <button
              onClick={() => setShowExamModal(true)}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2 transition"
            >
              <Plus className="w-5 h-5" />
              <span>Subir Nuevo Resultado de Examen</span>
            </button>

            {exams.length === 0 ? (
              <div className="p-10 text-center bg-white rounded-3xl border border-slate-200 space-y-2">
                <FileText className="w-12 h-12 text-slate-300 mx-auto" />
                <p className="text-lg font-bold text-slate-700">No hay resultados de exámenes aún</p>
                <p className="text-xs text-slate-500">Sube PDFs o fotos de laboratorios para generar resúmenes con IA.</p>
              </div>
            ) : (
              exams.map((e) => (
                <div
                  key={e.id}
                  className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-3 hover:shadow-md transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className="px-2.5 py-0.5 rounded-full text-xs font-black text-white"
                        style={{ backgroundColor: e.patient_color || '#3b82f6' }}
                      >
                        {e.patient_name}
                      </span>
                      <h3 className="text-lg font-extrabold text-slate-900 mt-1">{e.title}</h3>
                      <p className="text-xs font-semibold text-slate-400">
                        Subido el {new Date(e.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    <a
                      href={e.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1"
                    >
                      <FileDown className="w-4 h-4" />
                      <span>Ver Archivo</span>
                    </a>
                  </div>

                  {/* AI Summary Card */}
                  {e.summary_ai && (
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-extrabold text-amber-600">
                        <Sparkles className="w-4 h-4 fill-amber-500" />
                        <span>Resumen explicativo generado por Gemini IA:</span>
                      </div>
                      <div className="text-sm text-slate-800 whitespace-pre-line leading-relaxed font-medium">
                        {e.summary_ai}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Floating Action Button (FAB) for New Appointment */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          onClick={() => {
            setAppointmentToEdit(null);
            setShowAppointmentModal(true);
          }}
          className="py-4 px-6 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-extrabold text-base shadow-2xl shadow-blue-600/50 flex items-center gap-2 transition"
        >
          <Plus className="w-6 h-6" />
          <span>Nueva Cita</span>
        </button>
      </div>

      {/* Modals */}
      {selectedAppointmentForDetail && (
        <AppointmentDetailModal
          appointment={selectedAppointmentForDetail}
          onClose={() => setSelectedAppointmentForDetail(null)}
          onRefresh={fetchData}
          onEdit={(appToEdit) => {
            setSelectedAppointmentForDetail(null);
            setAppointmentToEdit(appToEdit);
            setShowAppointmentModal(true);
          }}
        />
      )}

      {showAppointmentModal && (
        <AppointmentModal
          patients={patients}
          appointmentToEdit={appointmentToEdit}
          onClose={() => {
            setShowAppointmentModal(false);
            setAppointmentToEdit(null);
          }}
          onSaved={fetchData}
        />
      )}

      {showExamModal && (
        <ExamModal
          patients={patients}
          appointments={appointments}
          onClose={() => setShowExamModal(false)}
          onSaved={fetchData}
        />
      )}

      {showPatientsModal && (
        <PatientsModal
          patients={patients}
          onClose={() => setShowPatientsModal(false)}
          onRefresh={fetchData}
        />
      )}
    </div>
  );
};
