import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'medfamilia.db');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const DEFAULT_SPECIALTIES = [
  'Medicina General',
  'Cardiología',
  'Oftalmología',
  'Dermatología',
  'Odontología',
  'Traumatología / Ortopedia',
  'Neurología',
  'Endocrinología',
  'Gastroenterología',
  'Ginecología / Urología',
  'Neumología',
  'Otorrinolaringología',
  'Nutrición',
  'Radiología / Imágenes',
  'Laboratorio Clínico',
];

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      name TEXT NOT NULL,
      relationship TEXT,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      google_calendar_id TEXT,
      google_refresh_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES families (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      title TEXT NOT NULL,
      appointment_type TEXT NOT NULL DEFAULT 'consulta', -- 'consulta', 'examen', 'laboratorio', 'procedimiento'
      specialist TEXT,
      specialty TEXT,
      location TEXT,
      date_time TEXT NOT NULL, -- ISOString
      requires_fasting INTEGER DEFAULT 0, -- 0 or 1
      prep_instructions TEXT,
      photo_url TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente', 'completada', 'cancelada'
      google_event_id TEXT,
      doctor_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES families (id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exam_results (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      appointment_id TEXT,
      title TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_type TEXT NOT NULL, -- 'pdf', 'image'
      summary_ai TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES families (id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      keys_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES families (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS specialties (
      id TEXT PRIMARY KEY,
      family_id TEXT, -- NULL for system defaults
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe migration for existing installations
  try {
    db.exec('ALTER TABLE appointments ADD COLUMN doctor_notes TEXT;');
  } catch (e) {
    // Column already exists
  }

  // Populate default system specialties if empty
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM specialties WHERE family_id IS NULL').get() as any)?.cnt;
  if (count === 0) {
    const insertStmt = db.prepare('INSERT INTO specialties (id, family_id, name) VALUES (?, NULL, ?)');
    for (const spec of DEFAULT_SPECIALTIES) {
      insertStmt.run([uuidv4(), spec]);
    }
  }

  console.log('Database initialized successfully at:', dbPath);
}

export default db;
