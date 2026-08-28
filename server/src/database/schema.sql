-- MedFamilia SaaS PostgreSQL Schema

CREATE SCHEMA IF NOT EXISTS evolution_api;

CREATE TABLE IF NOT EXISTS families (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone_number VARCHAR(32) UNIQUE,
  subscription_status VARCHAR(32) NOT NULL DEFAULT 'trial', -- 'active', 'trial', 'pending_approval', 'expired'
  subscription_expires_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP + INTERVAL '7 days',
  payment_receipt_url TEXT,
  plan_type VARCHAR(32) NOT NULL DEFAULT 'gratuito', -- 'gratuito', 'pago'
  max_daily_whatsapp_queries INT NOT NULL DEFAULT 5,
  is_admin INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Up to 4 Authorized WhatsApp Phone Numbers per Family
CREATE TABLE IF NOT EXISTS family_whatsapp_numbers (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  phone_number VARCHAR(32) UNIQUE NOT NULL,
  label VARCHAR(64) NOT NULL DEFAULT 'Principal', -- 'Mamá', 'Papá', 'Hijo', 'Cuidador'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Usage tracker for WhatsApp AI processing rate limiting per family
CREATE TABLE IF NOT EXISTS whatsapp_ai_usage (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_family_date UNIQUE(family_id, request_date)
);

CREATE TABLE IF NOT EXISTS patients (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  relationship VARCHAR(64),
  color VARCHAR(16) NOT NULL DEFAULT '#3b82f6',
  google_calendar_id VARCHAR(255),
  google_refresh_token TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  appointment_type VARCHAR(64) NOT NULL DEFAULT 'consulta',
  specialist VARCHAR(255),
  specialty VARCHAR(255),
  location TEXT,
  date_time VARCHAR(64) NOT NULL,
  requires_fasting INT DEFAULT 0,
  prep_instructions TEXT,
  photo_url TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pendiente',
  google_event_id VARCHAR(255),
  doctor_notes TEXT,
  origin_order_id VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_results (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id VARCHAR(64) REFERENCES appointments(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(16) NOT NULL,
  summary_ai TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  keys_json TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS specialties (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) REFERENCES families(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id VARCHAR(64) PRIMARY KEY,
  phone_number VARCHAR(32) NOT NULL,
  code VARCHAR(16) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medical_orders (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  appointment_id VARCHAR(64) NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id VARCHAR(64) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  order_type VARCHAR(64) NOT NULL DEFAULT 'examen',
  title VARCHAR(255) NOT NULL,
  description TEXT,
  file_url TEXT,
  file_type VARCHAR(16),
  status VARCHAR(32) NOT NULL DEFAULT 'pendiente',
  linked_appointment_id VARCHAR(64) REFERENCES appointments(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upload_staging (
  id VARCHAR(64) PRIMARY KEY,
  family_id VARCHAR(64) NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for high-performance multi-tenancy querying
CREATE INDEX IF NOT EXISTS idx_medical_orders_family ON medical_orders(family_id);
CREATE INDEX IF NOT EXISTS idx_medical_orders_patient ON medical_orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_orders_appointment ON medical_orders(appointment_id);
CREATE INDEX IF NOT EXISTS idx_patients_family ON patients(family_id);
CREATE INDEX IF NOT EXISTS idx_appointments_family ON appointments(family_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_family ON exam_results(family_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_patient ON exam_results(patient_id);
CREATE INDEX IF NOT EXISTS idx_push_family ON push_subscriptions(family_id);
CREATE INDEX IF NOT EXISTS idx_wa_numbers_phone ON family_whatsapp_numbers(phone_number);
CREATE INDEX IF NOT EXISTS idx_wa_numbers_family ON family_whatsapp_numbers(family_id);
CREATE INDEX IF NOT EXISTS idx_upload_staging_family ON upload_staging(family_id);
CREATE INDEX IF NOT EXISTS idx_upload_staging_filename ON upload_staging(filename);

