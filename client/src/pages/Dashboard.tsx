import React, { useState, useEffect } from 'react';
import {
  Heart,
  Plus,
  Calendar as CalendarIcon,
  ListFilter,
  Users,
  Bell,
  Share2,
  LogOut,
  MapPin,
  Clock,
  User,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Stethoscope,
  ChevronRight as ChevronRightIcon,
  History,
  ChevronDown,
  ChevronUp,
  FileText,
  MessageSquare,
  CalendarClock,
  ClipboardList,
  Trash2,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { apiRequest, getFileUrl, removeToken } from '../api';
import { Family, Patient, Appointment, Specialty, MedicalOrder } from '../types';
import { AppointmentModal } from '../components/AppointmentModal';
import { PatientsModal } from '../components/PatientsModal';
import { AppointmentDetailModal } from '../components/AppointmentDetailModal';
import { WhatsAppNumbersModal } from '../components/WhatsAppNumbersModal';

interface DashboardProps {
  family: Family;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ family, onLogout }) => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [specialtiesList, setSpecialtiesList] = useState<Specialty[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('all');
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('all');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [pendingOrders, setPendingOrders] = useState<MedicalOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Active Tab for Bottom Navigation Bar
  const [activeTab, setActiveTab] = useState<'upcoming' | 'calendar' | 'pending_orders'>('upcoming');

  // Past appointments accordion toggle
  const [showPastAppointments, setShowPastAppointments] = useState(false);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Modals
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [appointmentToEdit, setAppointmentToEdit] = useState<Appointment | null>(null);
  const [initialOrderToSchedule, setInitialOrderToSchedule] = useState<MedicalOrder | null>(null);
  const [selectedAppointmentForDetail, setSelectedAppointmentForDetail] = useState<Appointment | null>(null);
  const [showPatientsModal, setShowPatientsModal] = useState(false);
  const [showWhatsAppNumbersModal, setShowWhatsAppNumbersModal] = useState(false);

  // Push notification state
  const [pushSubscribed, setPushSubscribed] = useState(false);

  useEffect(() => {
    apiRequest('/specialties')
      .then((data) => setSpecialtiesList(data))
      .catch((err) => console.error('Error cargando especialidades:', err));
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [patientsRes, appointmentsRes, pendingOrdersRes] = await Promise.all([
        apiRequest('/patients'),
        apiRequest(`/appointments?patient_id=${selectedPatientId}&specialty=${selectedSpecialty}`),
        apiRequest(`/medical-orders/pending?patient_id=${selectedPatientId}`),
      ]);

      setPatients(patientsRes);
      setAppointments(appointmentsRes);
      setPendingOrders(pendingOrdersRes);

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
  }, [selectedPatientId, selectedSpecialty]);

  // Check existing push notification subscription on mount
  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          if (sub) {
            setPushSubscribed(true);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Convert Base64 URL-safe string to Uint8Array for PushManager compatibility
  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  // Request Push Notifications
  const handleEnablePush = async () => {
    try {
      // 1. Check browser and context support
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
        const isStandalone = (window.navigator as any).standalone === true;
        if (isIOS && !isStandalone) {
          alert('En iPhone/iPad (iOS), debes agregar MedFamilia a la pantalla de inicio (Compartir > "Agregar a inicio") para activar las notificaciones Push.');
          return;
        }
        alert('Este navegador o dispositivo no admite notificaciones Push.');
        return;
      }

      // Check secure context
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        alert('Las notificaciones Push requieren una conexión segura HTTPS o localhost.');
        return;
      }

      // If already subscribed, offer to send a test notification
      if (pushSubscribed) {
        const confirmTest = window.confirm('Las notificaciones ya están activadas en este dispositivo.\n\n¿Deseas enviar una notificación de prueba para comprobarla?');
        if (confirmTest) {
          try {
            await apiRequest('/push/test', { method: 'POST' });
            alert('¡Notificación de prueba enviada! Revisa las notificaciones de tu dispositivo.');
          } catch (e: any) {
            alert(`No se pudo enviar la prueba: ${e.message || 'Error del servidor'}`);
          }
        }
        return;
      }

      // 2. Request Notification Permission
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        alert('El permiso de notificaciones está bloqueado en tu navegador. Por favor actívalo desde la configuración del sitio (ícono de candado o ajustes del navegador).');
        return;
      }
      if (permission !== 'granted') {
        alert('No se otorgaron permisos para mostrar notificaciones.');
        return;
      }

      // 3. Get VAPID Public Key from server
      const res = await apiRequest('/push/vapid-key');
      if (!res.publicKey) {
        alert('Las notificaciones push aún no están listas en el servidor.');
        return;
      }

      // 4. Ensure Service Worker is registered & ready
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await navigator.serviceWorker.register('/sw.js');
      }
      await navigator.serviceWorker.ready;

      // 5. Clean up any stale subscription before subscribing with new key
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        try {
          await existingSub.unsubscribe();
        } catch (unsubErr) {
          console.warn('Error desuscribiendo clave previa:', unsubErr);
        }
      }

      // 6. Subscribe with binary ArrayBuffer/Uint8Array applicationServerKey
      const convertedVapidKey = urlBase64ToUint8Array(res.publicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey as unknown as BufferSource,
      });

      // 7. Explicitly format subscription payload for backend validation
      const subJson = subscription.toJSON();
      const payload = {
        subscription: {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh || '',
            auth: subJson.keys?.auth || '',
          },
        },
      };

      await apiRequest('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setPushSubscribed(true);

      // 8. Trigger immediate test notification to verify delivery
      try {
        await apiRequest('/push/test', { method: 'POST' });
      } catch (testErr) {
        console.warn('Error enviando notificación de bienvenida:', testErr);
      }

      alert('¡Notificaciones push activadas correctamente! Te enviamos una notificación de bienvenida.');
    } catch (err: any) {
      console.error('Error activando notificaciones:', err);
      const msg = err?.message || 'Error de comunicación o compatibilidad.';
      alert(`Error activando notificaciones push: ${msg}`);
    }
  };

  // WhatsApp Weekly Share Generator
  const handleShareWhatsApp = () => {
    if (appointments.length === 0) {
      alert('No hay citas para compartir.');
      return;
    }

    let text = `🩺 *Citas Médicas Familiares (${family.name})*\n\n`;

    const nowTime = new Date().getTime();
    const upcoming = appointments
      .filter((a) => new Date(a.date_time).getTime() >= nowTime)
      .sort((a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime());

    (upcoming.length > 0 ? upcoming : appointments).slice(0, 10).forEach((a) => {
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
      if (a.specialty) text += `🏷️ Especialidad: ${a.specialty}\n`;
      if (a.specialist) text += `👨‍⚕️ ${a.specialist}\n`;
      if (a.location) text += `🏥 ${a.location}\n`;
      if (a.requires_fasting) text += `⚠️ *REQUIERE AYUNO*\n`;
      if (a.prep_instructions) text += `💡 ${a.prep_instructions}\n`;
      text += `-------------------------\n`;
    });

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank');
  };

  // Separate upcoming vs past appointments
  const nowTime = new Date().getTime();
  const upcomingAppointments = appointments
    .filter((a) => new Date(a.date_time).getTime() >= nowTime && a.status !== 'completada')
    .sort((a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime());

  const pastAppointments = appointments
    .filter((a) => new Date(a.date_time).getTime() < nowTime || a.status === 'completada')
    .sort((a, b) => new Date(b.date_time).getTime() - new Date(a.date_time).getTime());

  const renderAppointmentCard = (a: Appointment, isPast = false) => {
    const dateObj = new Date(a.date_time);
    const isFasting = Boolean(a.requires_fasting);
    const attachedCount = a.attached_results?.length || 0;
    const pendingOrdersCount = a.medical_orders ? a.medical_orders.filter(o => o.status === 'pendiente').length : 0;

    return (
      <div
        key={a.id}
        onClick={() => setSelectedAppointmentForDetail(a)}
        className={`bg-white rounded-3xl border-2 shadow-sm p-5 space-y-3 hover:shadow-md transition relative overflow-hidden cursor-pointer group ${
          isPast ? 'border-slate-200/80 bg-slate-50/50 opacity-90' : 'border-slate-100'
        }`}
      >
        {/* Patient Color Left Bar */}
        <div
          className="absolute left-0 top-0 bottom-0 w-3"
          style={{ backgroundColor: a.patient_color || '#3b82f6' }}
        />

        <div className="pl-2 flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-black text-white"
                style={{ backgroundColor: a.patient_color || '#3b82f6' }}
              >
                {a.patient_name || 'Paciente'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-xs uppercase">
                {a.appointment_type}
              </span>
              {a.specialty && (
                <span className="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-bold text-xs">
                  {a.specialty}
                </span>
              )}
              {isPast && (
                <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-600 font-bold text-xs">
                  Realizada
                </span>
              )}
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
                year: 'numeric'
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

        {/* Fasting Warning (Only if upcoming) */}
        {!isPast && isFasting && (
          <div className="ml-2 p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 font-extrabold text-sm flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>⚠️ CITA REQUIERE AYUNO</span>
          </div>
        )}

        {/* Attached Results / Notes Summary Badge */}
        <div className="ml-2 flex flex-wrap items-center gap-2 pt-1">
          {pendingOrdersCount > 0 && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
              📋 {pendingOrdersCount} {pendingOrdersCount === 1 ? 'orden pendiente' : 'órdenes pendientes'}
            </span>
          )}

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
              title={pushSubscribed ? 'Notificaciones Push activas (clic para enviar prueba)' : 'Activar Notificaciones Push'}
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
              onClick={() => setShowWhatsAppNumbersModal(true)}
              title="Administrar Números de WhatsApp Autorizados"
              className="p-2.5 rounded-2xl bg-teal-50 border border-teal-200 text-teal-800 hover:bg-teal-100 font-bold text-xs flex items-center gap-1.5 transition"
            >
              <MessageSquare className="w-4 h-4 text-teal-600" />
              <span className="hidden sm:inline">Mis Números Bot</span>
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

        {/* Specialty Filter Dropdown Bar */}
        <div className="bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600 shrink-0">
            <Stethoscope className="w-4 h-4 text-blue-600" />
            <span>Especialidad:</span>
          </div>

          <select
            value={selectedSpecialty}
            onChange={(e) => setSelectedSpecialty(e.target.value)}
            className="w-full text-xs font-extrabold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-2 focus:outline-none focus:border-blue-600"
          >
            <option value="all">Todas las Especialidades ({appointments.length})</option>
            {specialtiesList.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* CONTENT VIEW 1: UPCOMING APPOINTMENTS & HISTORIAL */}
        {activeTab === 'upcoming' && (
          <div className="space-y-6">
            {loading ? (
              <div className="p-8 text-center text-slate-500 font-bold">Cargando citas...</div>
            ) : (
              <>
                {/* SECTION 1: UPCOMING APPOINTMENTS */}
                <div className="space-y-4">
                  <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <ListFilter className="w-5 h-5 text-blue-600" />
                    <span>Próximas Citas Pendientes ({upcomingAppointments.length})</span>
                  </h2>

                  {upcomingAppointments.length === 0 ? (
                    <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 space-y-2">
                      <CalendarIcon className="w-10 h-10 text-slate-300 mx-auto" />
                      <p className="text-base font-bold text-slate-700">No hay citas próximas pendientes</p>
                      <p className="text-xs text-slate-500">Toca el botón "+ Cita Médica" para agregar una nueva cita por foto, PDF o texto.</p>
                    </div>
                  ) : (
                    upcomingAppointments.map((a) => renderAppointmentCard(a, false))
                  )}
                </div>

                {/* SECTION 2: PAST APPOINTMENTS HISTORY ACCORDION */}
                {pastAppointments.length > 0 && (
                  <div className="pt-4 border-t border-slate-200/80 space-y-4">
                    <button
                      onClick={() => setShowPastAppointments(!showPastAppointments)}
                      className="w-full p-4 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between transition text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <History className="w-5 h-5 text-slate-500" />
                        <div>
                          <p className="text-base font-bold text-slate-800">
                            Historial de Citas Pasadas ({pastAppointments.length})
                          </p>
                          <p className="text-xs text-slate-500 font-medium">Citas realizadas o fechas transcurridas</p>
                        </div>
                      </div>
                      {showPastAppointments ? (
                        <ChevronUp className="w-5 h-5 text-slate-500" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-500" />
                      )}
                    </button>

                    {showPastAppointments && (
                      <div className="space-y-4 animate-in fade-in">
                        {pastAppointments.map((a) => renderAppointmentCard(a, true))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* CONTENT VIEW 2: CALENDAR VIEW */}
        {activeTab === 'calendar' && (
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
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900">{a.title}</p>
                      {a.specialty && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">
                          {a.specialty}
                        </span>
                      )}
                    </div>
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

        {/* CONTENT VIEW 3: DEDICATED PENDING MEDICAL ORDERS TAB */}
        {activeTab === 'pending_orders' && (
          <div className="space-y-6 pb-20">
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-1">
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                <ClipboardList className="w-6 h-6 text-indigo-600" />
                <span>Órdenes Médicas Pendientes</span>
              </h2>
              <p className="text-xs font-semibold text-slate-500">
                Órdenes o remisiones generadas en consultas anteriores que aún no han sido agendadas.
              </p>
            </div>

            {pendingOrders.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                  <ClipboardList className="w-6 h-6" />
                </div>
                <h3 className="font-black text-slate-800 text-lg">No hay órdenes médicas pendientes</h3>
                <p className="text-xs font-medium text-slate-500 max-w-sm mx-auto">
                  Cuando una consulta genere órdenes de exámenes o especialista, aparecerán aquí para que hagas acompañamiento y las agendes fácilmente.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingOrders.map((order) => {
                  let icon = '🔬';
                  let typeLabel = 'Examen';
                  if (order.order_type === 'especialista') {
                    icon = '👨‍⚕️';
                    typeLabel = 'Especialista';
                  } else if (order.order_type === 'laboratorio') {
                    icon = '🔬';
                    typeLabel = 'Laboratorio';
                  } else if (order.order_type === 'procedimiento') {
                    icon = '🏥';
                    typeLabel = 'Procedimiento';
                  }

                  return (
                    <div
                      key={order.id}
                      className="p-5 bg-white rounded-3xl border-2 border-indigo-100 shadow-sm hover:shadow-md transition space-y-3 flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-900 font-bold text-xs flex items-center gap-1.5 border border-indigo-100">
                            <span>{icon}</span>
                            <span>{typeLabel}</span>
                          </span>
                          <span className="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900 text-xs font-black">
                            ⏳ Pendiente de agendar
                          </span>
                        </div>

                        <h3 className="text-base font-black text-slate-900">{order.title}</h3>

                        {order.patient_name && (
                          <p className="text-xs font-bold text-slate-600">
                            👤 Paciente: <span className="text-indigo-900">{order.patient_name}</span>
                          </p>
                        )}

                        {order.source_appointment_title && (
                          <p className="text-xs font-semibold text-slate-500">
                            📌 Cita origen: <span className="font-bold text-slate-700">{order.source_appointment_title}</span>
                          </p>
                        )}

                        {order.description && (
                          <p className="text-xs font-medium text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                            {order.description}
                          </p>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        {order.file_url ? (
                          <a
                            href={getFileUrl(order.file_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 transition"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Ver Orden</span>
                          </a>
                        ) : (
                          <div></div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              if (window.confirm('¿Deseas eliminar esta orden médica pendiente?')) {
                                await apiRequest(`/medical-orders/${order.id}`, { method: 'DELETE' });
                                fetchData();
                              }
                            }}
                            className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Eliminar orden"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => {
                              setInitialOrderToSchedule(order);
                              setAppointmentToEdit(null);
                              setShowAppointmentModal(true);
                            }}
                            className="py-2 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black shadow-md flex items-center gap-1.5 transition"
                          >
                            <CalendarIcon className="w-3.5 h-3.5" />
                            <span>Agendar Cita</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating Action Button (FAB) for New Appointment */}
      <div className="fixed bottom-20 right-6 z-40">
        <button
          onClick={() => {
            setAppointmentToEdit(null);
            setInitialOrderToSchedule(null);
            setShowAppointmentModal(true);
          }}
          className="py-3.5 px-5 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-extrabold text-sm shadow-2xl shadow-blue-600/50 flex items-center gap-2 transition"
        >
          <Plus className="w-5 h-5" />
          <span>Nueva Cita</span>
        </button>
      </div>

      {/* FIXED BOTTOM NAVIGATION BAR */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-2xl py-2 px-4">
        <div className="max-w-md mx-auto flex items-center justify-around">
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl transition ${
              activeTab === 'upcoming' ? 'text-blue-600 font-black scale-105' : 'text-slate-500 hover:text-slate-800 font-bold'
            }`}
          >
            <CalendarClock className="w-5 h-5" />
            <span className="text-[10px] tracking-tight">Próximas Citas</span>
          </button>

          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl transition ${
              activeTab === 'calendar' ? 'text-blue-600 font-black scale-105' : 'text-slate-500 hover:text-slate-800 font-bold'
            }`}
          >
            <CalendarIcon className="w-5 h-5" />
            <span className="text-[10px] tracking-tight">Calendario</span>
          </button>

          <button
            onClick={() => setActiveTab('pending_orders')}
            className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl transition relative ${
              activeTab === 'pending_orders' ? 'text-indigo-600 font-black scale-105' : 'text-slate-500 hover:text-slate-800 font-bold'
            }`}
          >
            <div className="relative">
              <ClipboardList className="w-5 h-5" />
              {pendingOrders.length > 0 && (
                <span className="absolute -top-1.5 -right-2.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-white font-black text-[9px] min-w-[16px] text-center shadow-sm animate-pulse">
                  {pendingOrders.length}
                </span>
              )}
            </div>
            <span className="text-[10px] tracking-tight">Órdenes Pendientes</span>
          </button>
        </div>
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
            setInitialOrderToSchedule(null);
            setShowAppointmentModal(true);
          }}
        />
      )}

      {showAppointmentModal && (
        <AppointmentModal
          patients={patients}
          appointmentToEdit={appointmentToEdit}
          initialOrder={initialOrderToSchedule}
          onClose={() => {
            setShowAppointmentModal(false);
            setAppointmentToEdit(null);
            setInitialOrderToSchedule(null);
          }}
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

      {showWhatsAppNumbersModal && (
        <WhatsAppNumbersModal
          onClose={() => setShowWhatsAppNumbersModal(false)}
        />
      )}
    </div>
  );
};
