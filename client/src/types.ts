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
  is_google_connected?: boolean;
}

export interface Specialty {
  id: string;
  family_id?: string;
  name: string;
}

export interface AppointmentHistory {
  id: string;
  appointment_id: string;
  family_id: string;
  previous_status?: string;
  new_status: string;
  previous_date_time?: string;
  new_date_time?: string;
  reason?: string;
  changed_by?: string;
  created_at: string;
}

export interface ExamResult {
  id: string;
  family_id: string;
  patient_id: string;
  patient_name?: string;
  patient_color?: string;
  appointment_id?: string;         // legacy field (backward compat)
  exam_appointment_id?: string;    // the exam appointment where it was performed
  title: string;
  file_url: string;
  file_type: 'pdf' | 'image';
  summary_ai?: string;
  specialty?: string;
  notes?: string;
  exam_date?: string;
  created_at: string;
}

export interface MedicalOrder {
  id: string;
  family_id: string;
  appointment_id: string;
  patient_id: string;
  patient_name?: string;
  order_type: 'examen' | 'especialista' | 'procedimiento' | 'laboratorio';
  title: string;
  description?: string;
  file_url?: string;
  file_type?: 'pdf' | 'image';
  status: 'pendiente' | 'agendada' | 'completada';
  linked_appointment_id?: string;
  linked_appointment?: Appointment;
  source_appointment_title?: string;
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
  status: 'pendiente' | 'realizada' | 'cancelada' | 'reprogramada';
  computed_status?: 'pendiente' | 'realizada' | 'cancelada' | 'reprogramada';
  google_event_id?: string;
  attached_results?: ExamResult[];   // linked via appointment_exam_links
  origin_order_id?: string;
  origin_order?: MedicalOrder;
  medical_orders?: MedicalOrder[];
  history?: AppointmentHistory[];
  rescheduled_to_id?: string;
}
