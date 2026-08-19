export interface Family {
  id: string;
  code: string;
  name: string;
}

export interface Patient {
  id: string;
  family_id: string;
  name: string;
  relationship?: string;
  color: string;
  google_calendar_id?: string;
  google_refresh_token?: string;
}

export interface Appointment {
  id: string;
  family_id: string;
  patient_id: string;
  patient_name?: string;
  patient_color?: string;
  title: string;
  appointment_type: 'consulta' | 'examen' | 'laboratorio' | 'procedimiento';
  specialist?: string;
  specialty?: string;
  location?: string;
  date_time: string;
  requires_fasting: number | boolean;
  prep_instructions?: string;
  photo_url?: string;
  status: 'pendiente' | 'completada' | 'cancelada';
  google_event_id?: string;
}

export interface ExamResult {
  id: string;
  family_id: string;
  patient_id: string;
  patient_name?: string;
  patient_color?: string;
  appointment_id?: string;
  title: string;
  file_url: string;
  file_type: 'pdf' | 'image';
  summary_ai?: string;
  created_at: string;
}
