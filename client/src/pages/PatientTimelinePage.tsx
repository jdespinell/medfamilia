import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Calendar,
  FileText,
  Stethoscope,
  FlaskConical,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  CalendarClock,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  User,
  Filter,
} from 'lucide-react';
import { apiRequest, getFileUrl } from '../api';
import { Patient, Appointment, ExamResult, Specialty } from '../types';

interface PatientTimelinePageProps {
  patient: Patient;
  specialties: Specialty[];
  onBack: () => void;
}

interface TimelineEvent {
  id: string;
  type: 'appointment' | 'exam';
  date: Date;
  title: string;
  specialty?: string;
  status?: string;
  computed_status?: string;
  appointment_type?: string;
  specialist?: string;
  location?: string;
  doctor_notes?: string;
  summary_ai?: string;
  file_url?: string;
  file_type?: string;
  notes?: string;
  requires_fasting?: number | boolean;
  medical_orders?: any[];
  attached_results?: ExamResult[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  pendiente: {
    label: 'Pendiente',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  realizada: {
    label: 'Realizada',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  cancelada: {
    label: 'Cancelada',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  reprogramada: {
    label: 'Reprogramada',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: <CalendarClock className="w-3.5 h-3.5" />,
  },
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  consulta: <Stethoscope className="w-4 h-4 text-blue-600" />,
  examen: <FlaskConical className="w-4 h-4 text-emerald-600" />,
  laboratorio: <Activity className="w-4 h-4 text-purple-600" />,
  procedimiento: <ClipboardList className="w-4 h-4 text-orange-600" />,
  exam_result: <FileText className="w-4 h-4 text-teal-600" />,
};

const TYPE_BG: Record<string, string> = {
  consulta: 'bg-blue-50 border-blue-200',
  examen: 'bg-emerald-50 border-emerald-200',
  laboratorio: 'bg-purple-50 border-purple-200',
  procedimiento: 'bg-orange-50 border-orange-200',
  exam_result: 'bg-teal-50 border-teal-200',
};

export const PatientTimelinePage: React.FC<PatientTimelinePageProps> = ({
  patient,
  specialties,
  onBack,
}) => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [examResults, setExamResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'timeline' | 'by_specialty'>('timeline');
  const [filterSpecialty, setFilterSpecialty] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [appts, exams] = await Promise.all([
          apiRequest(`/appointments?patient_id=${patient.id}`),
          apiRequest(`/exams?patient_id=${patient.id}`),
        ]);
        setAppointments(Array.isArray(appts) ? appts : []);
        setExamResults(Array.isArray(exams) ? exams : []);
      } catch (e) {
        console.error('Error cargando línea de tiempo:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [patient.id]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build unified timeline events
  const buildTimeline = (): TimelineEvent[] => {
    const events: TimelineEvent[] = [];

    for (const a of appointments) {
      const effStatus = a.computed_status || a.status;
      events.push({
        id: a.id,
        type: 'appointment',
        date: new Date(a.date_time),
        title: a.title,
        specialty: a.specialty,
        status: a.status,
        computed_status: effStatus,
        appointment_type: a.appointment_type,
        specialist: a.specialist,
        location: a.location,
        doctor_notes: a.doctor_notes,
        requires_fasting: a.requires_fasting,
        medical_orders: a.medical_orders,
        attached_results: a.attached_results,
      });
    }

    // Add standalone exam results not already linked to an appointment in timeline
    const linkedExamApptIds = new Set(appointments.map(a => a.id));
    for (const e of examResults) {
      const examApptId = e.exam_appointment_id || e.appointment_id;
      if (!examApptId || !linkedExamApptIds.has(examApptId)) {
        events.push({
          id: `exam-${e.id}`,
          type: 'exam',
          date: new Date(e.exam_date || e.created_at),
          title: e.title,
          specialty: e.specialty,
          computed_status: 'realizada',
          appointment_type: 'exam_result',
          summary_ai: e.summary_ai,
          file_url: e.file_url,
          file_type: e.file_type,
          notes: e.notes,
        });
      }
    }

    return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  };

  const allEvents = buildTimeline();

  const filteredEvents = allEvents.filter(e => {
    if (filterSpecialty !== 'all' && e.specialty !== filterSpecialty) return false;
    if (filterType !== 'all' && e.appointment_type !== filterType) return false;
    return true;
  });

  // Group by specialty
  const bySpecialty = (): Record<string, TimelineEvent[]> => {
    const groups: Record<string, TimelineEvent[]> = {};
    for (const e of filteredEvents) {
      const key = e.specialty || 'Sin Especialidad';
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    return groups;
  };

  // Collect all specialties seen in events
  const seenSpecialties = Array.from(new Set(allEvents.map(e => e.specialty).filter(Boolean))) as string[];

  const renderEventCard = (event: TimelineEvent, compact = false) => {
    const isExpanded = expandedIds.has(event.id);
    const apptTypeCfg = TYPE_BG[event.appointment_type || 'consulta'] || TYPE_BG['consulta'];
    const typeIcon = TYPE_ICONS[event.appointment_type || 'consulta'] || TYPE_ICONS['consulta'];
    const statusCfg = STATUS_CONFIG[event.computed_status || 'pendiente'] || STATUS_CONFIG['pendiente'];

    const hasDetails = !!(event.doctor_notes || event.summary_ai || (event.attached_results && event.attached_results.length > 0) || (event.medical_orders && event.medical_orders.length > 0) || event.notes);

    return (
      <div
        key={event.id}
        className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${compact ? 'mb-2' : 'mb-4'}`}
      >
        {/* Card Header */}
        <div
          className={`p-4 ${hasDetails ? 'cursor-pointer hover:bg-slate-50' : ''} transition`}
          onClick={() => hasDetails && toggleExpand(event.id)}
        >
          <div className="flex items-start gap-3">
            {/* Type icon */}
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${apptTypeCfg}`}>
              {typeIcon}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {/* Status badge */}
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-black border ${statusCfg.bg} ${statusCfg.color} ${statusCfg.border}`}>
                  {statusCfg.icon}
                  {statusCfg.label}
                </span>
                {event.specialty && (
                  <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200">
                    {event.specialty}
                  </span>
                )}
              </div>

              <h4 className="text-base font-black text-slate-900 leading-tight">{event.title}</h4>

              <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-500 font-semibold">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {event.date.toLocaleDateString('es-ES', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                {event.specialist && (
                  <span className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    {event.specialist}
                  </span>
                )}
              </div>
            </div>

            {hasDetails && (
              <button className="p-1 text-slate-400 shrink-0">
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && hasDetails && (
          <div className="border-t border-slate-100 p-4 space-y-3 animate-in fade-in bg-slate-50/50">
            {event.notes && (
              <p className="text-sm text-slate-600 italic">{event.notes}</p>
            )}

            {event.doctor_notes && (
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-1">
                <p className="text-xs font-black text-blue-700 uppercase tracking-wide">Notas del Doctor</p>
                <p className="text-sm font-medium text-slate-800 whitespace-pre-line">{event.doctor_notes}</p>
              </div>
            )}

            {event.summary_ai && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                <p className="text-xs font-black text-amber-700 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 fill-amber-500" />
                  Resumen IA del Resultado
                </p>
                <p className="text-sm font-medium text-slate-800 whitespace-pre-line leading-relaxed">{event.summary_ai}</p>
              </div>
            )}

            {event.file_url && (
              <a
                href={getFileUrl(event.file_url)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold text-slate-700 transition"
              >
                <FileText className="w-4 h-4" />
                Ver Archivo del Resultado
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {event.attached_results && event.attached_results.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Resultados Vinculados ({event.attached_results.length})</p>
                {event.attached_results.map(r => (
                  <div key={r.id} className="p-3 rounded-xl bg-white border border-emerald-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-900">{r.title}</span>
                      <a
                        href={getFileUrl(r.file_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Ver
                      </a>
                    </div>
                    {r.specialty && <span className="text-xs text-blue-600 font-semibold">{r.specialty}</span>}
                    {r.summary_ai && (
                      <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{r.summary_ai}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {event.medical_orders && event.medical_orders.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-black text-slate-500 uppercase tracking-wide">
                  Órdenes Médicas ({event.medical_orders.length})
                </p>
                {event.medical_orders.map((o: any) => (
                  <div key={o.id} className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-indigo-100">
                    <span className="text-sm font-bold text-slate-800">{o.title}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                      o.status === 'pendiente' ? 'bg-amber-100 text-amber-700' :
                      o.status === 'completada' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {o.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const specialtyGroups = bySpecialty();

  // Summary stats
  const totalAppts = appointments.length;
  const pendingAppts = appointments.filter(a => (a.computed_status || a.status) === 'pendiente').length;
  const pendingOrdersCount = appointments.reduce((sum, a) => sum + (a.medical_orders?.filter(o => o.status === 'pendiente').length || 0), 0);
  const totalExams = examResults.length;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-8">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl text-white flex items-center justify-center font-black text-lg shadow-md shrink-0"
              style={{ backgroundColor: patient.color }}
            >
              {patient.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 leading-none">{patient.name}</h1>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">
                {patient.relationship || 'Familia'} · Historial Médico Completo
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: <Calendar className="w-5 h-5 text-blue-600" />, label: 'Total Citas', value: totalAppts, bg: 'bg-blue-50', border: 'border-blue-200' },
            { icon: <Clock className="w-5 h-5 text-amber-600" />, label: 'Pendientes', value: pendingAppts, bg: 'bg-amber-50', border: 'border-amber-200' },
            { icon: <ClipboardList className="w-5 h-5 text-indigo-600" />, label: 'Órdenes Pend.', value: pendingOrdersCount, bg: 'bg-indigo-50', border: 'border-indigo-200' },
            { icon: <FileText className="w-5 h-5 text-emerald-600" />, label: 'Resultados', value: totalExams, bg: 'bg-emerald-50', border: 'border-emerald-200' },
          ].map(card => (
            <div key={card.label} className={`p-4 rounded-2xl border ${card.bg} ${card.border} text-center space-y-1`}>
              <div className="flex justify-center">{card.icon}</div>
              <p className="text-2xl font-black text-slate-900">{card.value}</p>
              <p className="text-xs font-bold text-slate-500">{card.label}</p>
            </div>
          ))}
        </div>

        {/* Filters & View Toggle */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-sm">
          {/* View mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('timeline')}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 ${
                viewMode === 'timeline'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Activity className="w-4 h-4" />
              Línea de Tiempo
            </button>
            <button
              onClick={() => setViewMode('by_specialty')}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 ${
                viewMode === 'by_specialty'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Stethoscope className="w-4 h-4" />
              Por Especialidad
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 shrink-0">
              <Filter className="w-3.5 h-3.5" /> Filtrar:
            </div>
            <select
              value={filterSpecialty}
              onChange={e => setFilterSpecialty(e.target.value)}
              className="flex-1 min-w-[140px] text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 focus:outline-none focus:border-blue-400"
            >
              <option value="all">Todas las especialidades</option>
              {seenSpecialties.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="flex-1 min-w-[140px] text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 focus:outline-none focus:border-blue-400"
            >
              <option value="all">Todos los tipos</option>
              <option value="consulta">Consultas</option>
              <option value="examen">Exámenes</option>
              <option value="laboratorio">Laboratorio</option>
              <option value="procedimiento">Procedimientos</option>
              <option value="exam_result">Resultados directos</option>
            </select>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="font-bold text-slate-600">Cargando historial médico...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200 space-y-3">
            <Calendar className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="text-base font-bold text-slate-700">No hay eventos registrados</p>
            <p className="text-xs text-slate-400">Agrega citas médicas o resultados de exámenes para ver el historial aquí.</p>
          </div>
        ) : viewMode === 'timeline' ? (
          /* TIMELINE VIEW */
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide px-1">
              {filteredEvents.length} evento{filteredEvents.length !== 1 ? 's' : ''} · más reciente primero
            </p>
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-slate-200 z-0" />
              <div className="space-y-3 relative z-10">
                {filteredEvents.map(event => {
                  const statusCfg = STATUS_CONFIG[event.computed_status || 'pendiente'] || STATUS_CONFIG['pendiente'];
                  const typeIcon = TYPE_ICONS[event.appointment_type || 'consulta'];
                  const hasDetails = !!(event.doctor_notes || event.summary_ai || (event.attached_results && event.attached_results.length > 0) || (event.medical_orders && event.medical_orders.length > 0) || event.notes || event.file_url);
                  const isExpanded = expandedIds.has(event.id);

                  return (
                    <div key={event.id} className="flex gap-4">
                      {/* Timeline dot */}
                      <div className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center shrink-0 z-10 bg-white ${statusCfg.border}`}>
                        {typeIcon}
                      </div>

                      {/* Card */}
                      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-1">
                        <div
                          className={`p-3 ${hasDetails ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                          onClick={() => hasDetails && toggleExpand(event.id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-1 mb-1">
                                <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-black border ${statusCfg.bg} ${statusCfg.color} ${statusCfg.border}`}>
                                  {statusCfg.icon}
                                  {statusCfg.label}
                                </span>
                                {event.specialty && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                                    {event.specialty}
                                  </span>
                                )}
                              </div>
                              <p className="font-black text-slate-900 text-sm leading-tight">{event.title}</p>
                              <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
                                {event.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                                {event.specialist ? ` · ${event.specialist}` : ''}
                              </p>
                            </div>
                            {hasDetails && (
                              <span className="text-slate-400 shrink-0 pt-0.5">
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </span>
                            )}
                          </div>
                        </div>

                        {isExpanded && hasDetails && (
                          <div className="border-t border-slate-100 p-3 space-y-2 bg-slate-50/50 animate-in fade-in">
                            {event.notes && <p className="text-xs text-slate-600 italic">{event.notes}</p>}
                            {event.doctor_notes && (
                              <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200">
                                <p className="text-[10px] font-black text-blue-700 mb-1 uppercase">Notas del Doctor</p>
                                <p className="text-xs font-medium text-slate-800 whitespace-pre-line">{event.doctor_notes}</p>
                              </div>
                            )}
                            {event.summary_ai && (
                              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                                <p className="text-[10px] font-black text-amber-700 mb-1 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3 fill-amber-500" /> Resumen IA
                                </p>
                                <p className="text-xs font-medium text-slate-800 whitespace-pre-line leading-relaxed">{event.summary_ai}</p>
                              </div>
                            )}
                            {event.file_url && (
                              <a
                                href={getFileUrl(event.file_url)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-700"
                              >
                                <FileText className="w-3.5 h-3.5" /> Ver archivo
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            {event.attached_results && event.attached_results.length > 0 && (
                              <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1.5">Resultados ({event.attached_results.length})</p>
                                {event.attached_results.map(r => (
                                  <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-white border border-emerald-100 mb-1">
                                    <span className="text-xs font-bold text-slate-800">{r.title}</span>
                                    <a href={getFileUrl(r.file_url)} target="_blank" rel="noreferrer"
                                      className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                                      Ver <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            )}
                            {event.medical_orders && event.medical_orders.filter((o: any) => o.status === 'pendiente').length > 0 && (
                              <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                                <p className="text-[10px] font-black text-amber-700 uppercase">
                                  {event.medical_orders.filter((o: any) => o.status === 'pendiente').length} orden(es) pendiente(s)
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* BY SPECIALTY VIEW */
          <div className="space-y-4">
            {Object.entries(specialtyGroups).map(([spec, events]) => (
              <div key={spec} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Specialty header */}
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
                  <div className="flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-blue-600" />
                    <h3 className="font-black text-slate-900 text-base">{spec}</h3>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                      {events.length} evento{events.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {/* Mini stats */}
                  <div className="flex items-center gap-2 text-xs font-bold">
                    {events.filter(e => (e.computed_status || '') === 'pendiente').length > 0 && (
                      <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700">
                        {events.filter(e => (e.computed_status || '') === 'pendiente').length} pendiente
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {events.map(event => renderEventCard(event, true))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
