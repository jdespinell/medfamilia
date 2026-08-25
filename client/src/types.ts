export interface Family {
  id: string;
  code: string;
  name: string;
  phone_number?: string;
  subscription_status?: string;
  subscription_expires_at?: string;
  plan_type?: 'gratuito' | 'pago';
  max_daily_whatsapp_queries?: number;
  is_admin?: boolean;
  queries_used_today?: number;
  created_at?: string;
}

export interface AdminStats {
  total_families: number;
  paid_families: number;
  free_families: number;
  total_queries_today: number;
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

export interface Specialty {
  id: string;
  family_id?: string;
  name: string;
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
  doctor_notes?: string;
  status: 'pendiente' | 'completada' | 'cancelada';
  google_event_id?: string;
  attached_results?: ExamResult[];
}
