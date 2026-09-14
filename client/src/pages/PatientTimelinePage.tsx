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
  Plus,
  Trash2,
  Edit,
  Search,
  Download,
  AlertCircle,
  FolderOpen,
} from 'lucide-react';
import { apiRequest, getFileUrl } from '../api';
import { Patient, Appointment, ExamResult, Specialty } from '../types';
import { ExamModal } from '../components/ExamModal';

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
  const [viewMode, setViewMode] = useState<'timeline' | 'exams' | 'by_specialty'>('exams');
  const [filterSpecialty, setFilterSpecialty] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Modal to upload exam
  const [showUploadExamModal, setShowUploadExamModal] = useState(false);
  const [uploadPresetSpecialty, setUploadPresetSpecialty] = useState('');

  // Modal to edit existing exam
  const [examToEdit, setExamToEdit] = useState<ExamResult | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSpecialty, setEditSpecialty] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [appts, exams] = await Promise.all([
        apiRequest(`/appointments?patient_id=${patient.id}`),
        apiRequest(`/exams?patient_id=${patient.id}`),
      ]);
      setAppointments(Array.isArray(appts) ? appts : []);
      setExamResults(Array.isArray(exams) ? exams : []);
    } catch (e) {
      console.error('Error cargando datos del paciente:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [patient.id]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteExam = async (examId: string, examTitle: string) => {
    if (!window.confirm(`¿Seguro que deseas eliminar el resultado "${examTitle}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await apiRequest(`/exams/${examId}`, { method: 'DELETE' });
      setExamResults((prev) => prev.filter((e) => e.id !== examId));
      loadData();
    } catch (err: any) {
      alert(err.message || 'Error al eliminar el examen.');
    }
  };

  const handleStartEditExam = (exam: ExamResult) => {
    setExamToEdit(exam);
    setEditTitle(exam.title);
    setEditSpecialty(exam.specialty || '');
    setEditNotes(exam.notes || '');
  };

  const handleSaveEditExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examToEdit) return;
    setSavingEdit(true);
    try {
      const updated = await apiRequest(`/exams/${examToEdit.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: editTitle,
          specialty: editSpecialty || null,
          notes: editNotes || null,
        }),
      });

      setExamResults((prev) => prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setExamToEdit(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Error guardando cambios del examen.');
    } finally {
      setSavingEdit(false);
    }
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

    // Include exam results in timeline
    for (const e of examResults) {
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

    return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  };

  const allEvents = buildTimeline();

  const filteredEvents = allEvents.filter((e) => {
    if (filterSpecialty !== 'all' && e.specialty !== filterSpecialty) return false;
    if (filterType !== 'all' && e.appointment_type !== filterType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = e.title.toLowerCase().includes(q);
      const matchSpec = e.specialty?.toLowerCase().includes(q) || false;
      const matchNotes = e.doctor_notes?.toLowerCase().includes(q) || e.summary_ai?.toLowerCase().includes(q) || false;
      if (!matchTitle && !matchSpec && !matchNotes) return false;
    }
    return true;
  });

  // Filtered Exam Results for the dedicated Exams section
  const filteredExamResults = examResults.filter((e) => {
    if (filterSpecialty !== 'all' && e.specialty !== filterSpecialty) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = e.title.toLowerCase().includes(q);
      const matchSpec = e.specialty?.toLowerCase().includes(q) || false;
      const matchNotes = e.notes?.toLowerCase().includes(q) || e.summary_ai?.toLowerCase().includes(q) || false;
      if (!matchTitle && !matchSpec && !matchNotes) return false;
    }
    return true;
  });

  // Group exam results by specialty
  const examsBySpecialty = (): Record<string, ExamResult[]> => {
    const groups: Record<string, ExamResult[]> = {};
    for (const exam of filteredExamResults) {
      const key = exam.specialty || 'Laboratorio y General';
      if (!groups[key]) groups[key] = [];
      groups[key].push(exam);
    }
    return groups;
  };

  // Group timeline events by specialty
  const eventsBySpecialty = (): Record<string, TimelineEvent[]> => {
    const groups: Record<string, TimelineEvent[]> = {};
    for (const e of filteredEvents) {
      const key = e.specialty || 'General / Sin Especialidad';
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    return groups;
  };

  const seenSpecialties = Array.from(
    new Set([...allEvents.map((e) => e.specialty), ...examResults.map((e) => e.specialty)].filter(Boolean))
  ) as string[];

  // Stats
  const totalAppts = appointments.length;
  const pendingAppts = appointments.filter((a) => (a.computed_status || a.status) === 'pendiente').length;
  const totalExams = examResults.length;
  const pendingOrdersCount = appointments.reduce(
    (sum, a) => sum + (a.medical_orders?.filter((o) => o.status === 'pendiente').length || 0),
    0
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-16">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition flex items-center gap-1 font-bold text-xs"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Volver</span>
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
                  {patient.relationship || 'Familia'} · Perfil y Expediente Médico
                </p>
              </div>
            </div>
          </div>

          {/* Quick Upload Button */}
          <button
            onClick={() => {
              setUploadPresetSpecialty('');
              setShowUploadExamModal(true);
            }}
            className="px-3.5 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>+ Subir Examen</span>
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        {/* Quick Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => setViewMode('exams')}
            className={`p-4 rounded-2xl border text-center space-y-1 transition text-left cursor-pointer hover:shadow-md ${
              viewMode === 'exams'
                ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-500/20'
                : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-xl bg-emerald-100/70 text-emerald-700">
                <FileText className="w-5 h-5" />
              </span>
              <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100/50 px-2 py-0.5 rounded-full">
                Acceso Rápido
              </span>
            </div>
            <p className="text-2xl font-black text-slate-900">{totalExams}</p>
            <p className="text-xs font-bold text-slate-600">Resultados Exámenes</p>
          </button>

          <button
            onClick={() => setViewMode('timeline')}
            className={`p-4 rounded-2xl border text-center space-y-1 transition text-left cursor-pointer hover:shadow-md ${
              viewMode === 'timeline' ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-xl bg-blue-100/70 text-blue-700">
                <Calendar className="w-5 h-5" />
              </span>
            </div>
            <p className="text-2xl font-black text-slate-900">{totalAppts}</p>
            <p className="text-xs font-bold text-slate-600">Total Citas</p>
          </button>

          <div className="p-4 rounded-2xl border bg-white border-slate-200 text-left space-y-1">
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-xl bg-amber-100/70 text-amber-700">
                <Clock className="w-5 h-5" />
              </span>
            </div>
            <p className="text-2xl font-black text-slate-900">{pendingAppts}</p>
            <p className="text-xs font-bold text-slate-600">Citas Pendientes</p>
          </div>

          <div className="p-4 rounded-2xl border bg-white border-slate-200 text-left space-y-1">
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-xl bg-indigo-100/70 text-indigo-700">
                <ClipboardList className="w-5 h-5" />
              </span>
            </div>
            <p className="text-2xl font-black text-slate-900">{pendingOrdersCount}</p>
            <p className="text-xs font-bold text-slate-600">Órdenes Médicas</p>
          </div>
        </div>

        {/* View Mode Navigation Tabs */}
        <div className="bg-white rounded-3xl p-2 shadow-sm border border-slate-200 flex items-center gap-2">
          <button
            onClick={() => setViewMode('exams')}
            className={`flex-1 py-3 px-3 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition ${
              viewMode === 'exams'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Resultados de Exámenes</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs ${
                viewMode === 'exams' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-800'
              }`}
            >
              {totalExams}
            </span>
          </button>

          <button
            onClick={() => setViewMode('timeline')}
            className={`flex-1 py-3 px-3 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition ${
              viewMode === 'timeline'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Línea de Tiempo</span>
          </button>

          <button
            onClick={() => setViewMode('by_specialty')}
            className={`flex-1 py-3 px-3 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition ${
              viewMode === 'by_specialty'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Stethoscope className="w-4 h-4" />
            <span className="hidden sm:inline">Por Especialidad</span>
            <span className="sm:hidden">Especialidad</span>
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Buscar por nombre, examen, médico o indicación..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Specialty Selector */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-slate-400 shrink-0" />
              <select
                value={filterSpecialty}
                onChange={(e) => setFilterSpecialty(e.target.value)}
                className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-500"
              >
                <option value="all">Todas las especialidades</option>
                {seenSpecialties.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* SECTION 1: EXAM RESULTS DEDICATED VIEW */}
        {viewMode === 'exams' && (
          <div className="space-y-4">
            {/* Action Banner for Exams */}
            <div className="p-4 rounded-3xl bg-gradient-to-r from-emerald-50 via-teal-50 to-white border border-emerald-200 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-500/20 shrink-0">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Expediente de Exámenes de {patient.name}
                  </h3>
                  <p className="text-xs font-semibold text-slate-600">
                    Resultados organizados por especialidad con resumen claro para la familia
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setUploadPresetSpecialty(filterSpecialty !== 'all' ? filterSpecialty : '');
                  setShowUploadExamModal(true);
                }}
                className="py-2.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/30 transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Subir Nuevo Examen</span>
              </button>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-500 font-bold">Cargando exámenes...</div>
            ) : filteredExamResults.length === 0 ? (
              <div className="p-10 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                  <FolderOpen className="w-6 h-6" />
                </div>
                <h3 className="font-black text-slate-800 text-base">
                  {searchQuery || filterSpecialty !== 'all'
                    ? 'No se encontraron exámenes con los filtros seleccionados'
                    : `No hay resultados de exámenes registrados para ${patient.name}`}
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Sube análisis de sangre, ecografías, resonancias o cualquier informe médico para tenerlos clasificados y con resumen de IA.
                </p>
                <button
                  onClick={() => {
                    setUploadPresetSpecialty('');
                    setShowUploadExamModal(true);
                  }}
                  className="mt-2 py-3 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-2 shadow-md transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Subir Primer Examen</span>
                </button>
              </div>
            ) : (
              /* Grouped by Specialty view */
              <div className="space-y-4">
                {Object.entries(examsBySpecialty()).map(([specialtyName, examsInGroup]) => (
                  <div
                    key={specialtyName}
                    className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
                  >
                    {/* Specialty Group Header */}
                    <div className="px-5 py-3.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 font-bold">
                          <FlaskConical className="w-4 h-4" />
                        </span>
                        <h4 className="font-black text-slate-900 text-sm sm:text-base">{specialtyName}</h4>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-bold text-xs border border-emerald-200">
                          {examsInGroup.length} examen{examsInGroup.length !== 1 ? 'es' : ''}
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          setUploadPresetSpecialty(specialtyName);
                          setShowUploadExamModal(true);
                        }}
                        className="text-xs font-bold text-emerald-700 hover:text-emerald-900 hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agregar en {specialtyName}</span>
                      </button>
                    </div>

                    {/* Exams inside this specialty */}
                    <div className="p-4 space-y-3">
                      {examsInGroup.map((exam) => (
                        <div
                          key={exam.id}
                          className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3 hover:border-slate-300 transition shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 font-black text-xs uppercase">
                                  {exam.file_type || 'Examen'}
                                </span>
                                {exam.specialty && (
                                  <span className="px-2.5 py-0.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 font-bold text-xs">
                                    {exam.specialty}
                                  </span>
                                )}
                                <span className="text-xs font-bold text-slate-500">
                                  📅 {new Date(exam.exam_date || exam.created_at).toLocaleDateString('es-ES', {
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>

                              <h5 className="text-base font-black text-slate-900 leading-snug">{exam.title}</h5>

                              {exam.notes && (
                                <p className="text-xs text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200 italic">
                                  💡 {exam.notes}
                                </p>
                              )}
                            </div>

                            {/* Actions: View, Edit, Delete */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={getFileUrl(exam.file_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition"
                                title="Ver o descargar archivo"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Ver Archivo</span>
                              </a>

                              <button
                                onClick={() => handleStartEditExam(exam)}
                                className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition"
                                title="Editar título o notas"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleDeleteExam(exam.id, exam.title)}
                                className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-red-600 hover:bg-red-50 transition"
                                title="Eliminar examen"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* AI Summary Card */}
                          {exam.summary_ai && (
                            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-slate-800 space-y-1.5">
                              <div className="flex items-center gap-1.5 font-black text-amber-900">
                                <Sparkles className="w-4 h-4 fill-amber-500 text-amber-600 shrink-0" />
                                <span>Resumen Explicativo de la IA (Gemini):</span>
                              </div>
                              <p className="whitespace-pre-line font-medium leading-relaxed text-slate-800">
                                {exam.summary_ai}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SECTION 2: TIMELINE VIEW */}
        {viewMode === 'timeline' && (
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide px-1">
              {filteredEvents.length} evento{filteredEvents.length !== 1 ? 's' : ''} en orden cronológico
            </p>

            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-3xl border border-slate-200">
                <p className="font-bold text-slate-600">No hay eventos para mostrar</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-slate-200 z-0" />
                <div className="space-y-3 relative z-10">
                  {filteredEvents.map((event) => {
                    const statusCfg = STATUS_CONFIG[event.computed_status || 'pendiente'] || STATUS_CONFIG['pendiente'];
                    const typeIcon = TYPE_ICONS[event.appointment_type || 'consulta'];
                    const hasDetails = !!(
                      event.doctor_notes ||
                      event.summary_ai ||
                      (event.attached_results && event.attached_results.length > 0) ||
                      (event.medical_orders && event.medical_orders.length > 0) ||
                      event.notes ||
                      event.file_url
                    );
                    const isExpanded = expandedIds.has(event.id);

                    return (
                      <div key={event.id} className="flex gap-4">
                        <div
                          className={`w-10 h-10 rounded-2xl border-2 flex items-center justify-center shrink-0 z-10 bg-white ${statusCfg.border}`}
                        >
                          {typeIcon}
                        </div>

                        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-1">
                          <div
                            className={`p-3.5 ${hasDetails ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                            onClick={() => hasDetails && toggleExpand(event.id)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black border ${statusCfg.bg} ${statusCfg.color} ${statusCfg.border}`}
                                  >
                                    {statusCfg.icon}
                                    {statusCfg.label}
                                  </span>
                                  {event.specialty && (
                                    <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                                      {event.specialty}
                                    </span>
                                  )}
                                </div>
                                <p className="font-black text-slate-900 text-sm leading-tight">{event.title}</p>
                                <p className="text-xs text-slate-500 font-semibold">
                                  📅 {event.date.toLocaleDateString('es-ES', {
                                    weekday: 'short',
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                  })}
                                  {event.specialist ? ` · 👨‍⚕️ ${event.specialist}` : ''}
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
                            <div className="border-t border-slate-100 p-3.5 space-y-2.5 bg-slate-50/50 animate-in fade-in">
                              {event.doctor_notes && (
                                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-1">
                                  <p className="text-[10px] font-black text-blue-700 uppercase">Notas del Doctor</p>
                                  <p className="text-xs font-medium text-slate-800 whitespace-pre-line">
                                    {event.doctor_notes}
                                  </p>
                                </div>
                              )}

                              {event.summary_ai && (
                                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                                  <p className="text-[10px] font-black text-amber-700 flex items-center gap-1">
                                    <Sparkles className="w-3.5 h-3.5 fill-amber-500" /> Resumen IA
                                  </p>
                                  <p className="text-xs font-medium text-slate-800 whitespace-pre-line leading-relaxed">
                                    {event.summary_ai}
                                  </p>
                                </div>
                              )}

                              {event.file_url && (
                                <a
                                  href={getFileUrl(event.file_url)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-xs font-bold transition shadow-sm"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" /> Ver Archivo Adjunto
                                </a>
                              )}

                              {event.attached_results && event.attached_results.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-black text-slate-400 uppercase mb-1">
                                    Resultados vinculados ({event.attached_results.length})
                                  </p>
                                  {event.attached_results.map((r) => (
                                    <div
                                      key={r.id}
                                      className="flex items-center justify-between p-2 rounded-xl bg-white border border-emerald-100 mb-1"
                                    >
                                      <span className="text-xs font-bold text-slate-800">{r.title}</span>
                                      <a
                                        href={getFileUrl(r.file_url)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs text-emerald-600 font-bold flex items-center gap-1"
                                      >
                                        Ver <ExternalLink className="w-3 h-3" />
                                      </a>
                                    </div>
                                  ))}
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
            )}
          </div>
        )}

        {/* SECTION 3: BY SPECIALTY VIEW */}
        {viewMode === 'by_specialty' && (
          <div className="space-y-4">
            {Object.entries(eventsBySpecialty()).map(([spec, events]) => (
              <div key={spec} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
                  <div className="flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-blue-600" />
                    <h4 className="font-black text-slate-900 text-base">{spec}</h4>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                      {events.length} evento{events.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                <div className="p-4 space-y-2">
                  {events.map((e) => (
                    <div
                      key={e.id}
                      className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{e.title}</p>
                        <p className="text-slate-500 font-medium">
                          {e.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <span className="px-2 py-1 rounded-lg bg-white border text-slate-700 font-bold uppercase text-[10px]">
                        {e.appointment_type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Edit Exam Modal */}
      {examToEdit && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Edit className="w-5 h-5 text-blue-600" />
              Editar Resultado de Examen
            </h3>

            <form onSubmit={handleSaveEditExam} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nombre del Examen</label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-blue-600 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Especialidad</label>
                <select
                  value={editSpecialty}
                  onChange={(e) => setEditSpecialty(e.target.value)}
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-blue-600 font-semibold"
                >
                  <option value="">Sin especialidad específica</option>
                  {specialties.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notas o Indicaciones</label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Notas adicionales..."
                  className="w-full p-3 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-blue-600 font-medium resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setExamToEdit(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md disabled:opacity-50"
                >
                  {savingEdit ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Exam Modal */}
      {showUploadExamModal && (
        <ExamModal
          patients={[patient]}
          appointments={appointments}
          specialties={specialties}
          initialPatientId={patient.id}
          initialSpecialty={uploadPresetSpecialty}
          onClose={() => setShowUploadExamModal(false)}
          onSaved={() => {
            setShowUploadExamModal(false);
            loadData();
          }}
        />
      )}
    </div>
  );
};
