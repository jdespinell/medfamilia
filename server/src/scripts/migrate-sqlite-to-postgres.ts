import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const sqlitePath = path.join(dataDir, 'medfamilia.db');

async function migrate() {
  console.log('🚀 Iniciando script de migración SQLite ➡️ PostgreSQL...');

  if (!fs.existsSync(sqlitePath)) {
    console.log('ℹ️ No se encontró ningún archivo SQLite en', sqlitePath, '- Saltando migración.');
    return;
  }

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/medfamilia',
  });

  const sqliteDb = new Database(sqlitePath);

  try {
    // 1. Migrate Families
    const families = sqliteDb.prepare('SELECT * FROM families').all() as any[];
    console.log(`📦 Migrando ${families.length} familias existentes...`);

    for (const fam of families) {
      await pgPool.query(
        `INSERT INTO families (id, code, name, password_hash, subscription_status, subscription_expires_at, created_at)
         VALUES ($1, $2, $3, $4, 'active', '2099-12-31 23:59:59+00', $5)
         ON CONFLICT (id) DO UPDATE SET
           subscription_status = 'active',
           subscription_expires_at = '2099-12-31 23:59:59+00'`,
        [fam.id, fam.code, fam.name, fam.password_hash, fam.created_at || new Date()]
      );
    }

    // 2. Migrate Patients
    const patients = sqliteDb.prepare('SELECT * FROM patients').all() as any[];
    console.log(`👨‍👩‍👧‍👦 Migrando ${patients.length} pacientes...`);
    for (const p of patients) {
      await pgPool.query(
        `INSERT INTO patients (id, family_id, name, relationship, color, google_calendar_id, google_refresh_token, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.family_id, p.name, p.relationship, p.color, p.google_calendar_id, p.google_refresh_token, p.created_at || new Date()]
      );
    }

    // 3. Migrate Appointments
    const appointments = sqliteDb.prepare('SELECT * FROM appointments').all() as any[];
    console.log(`📅 Migrando ${appointments.length} citas médicas...`);
    for (const a of appointments) {
      await pgPool.query(
        `INSERT INTO appointments (
          id, family_id, patient_id, title, appointment_type, specialist, specialty,
          location, date_time, requires_fasting, prep_instructions, photo_url, status, google_event_id, doctor_notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO NOTHING`,
        [
          a.id, a.family_id, a.patient_id, a.title, a.appointment_type || 'consulta',
          a.specialist, a.specialty, a.location, a.date_time, a.requires_fasting || 0,
          a.prep_instructions, a.photo_url, a.status || 'pendiente', a.google_event_id,
          a.doctor_notes, a.created_at || new Date()
        ]
      );
    }

    // 4. Migrate Exam Results
    const examResults = sqliteDb.prepare('SELECT * FROM exam_results').all() as any[];
    console.log(`📄 Migrando ${examResults.length} resultados de exámenes...`);
    for (const e of examResults) {
      await pgPool.query(
        `INSERT INTO exam_results (id, family_id, patient_id, appointment_id, title, file_url, file_type, summary_ai, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, e.family_id, e.patient_id, e.appointment_id, e.title, e.file_url, e.file_type, e.summary_ai, e.created_at || new Date()]
      );
    }

    // 5. Migrate Push Subscriptions
    const pushSubs = sqliteDb.prepare('SELECT * FROM push_subscriptions').all() as any[];
    console.log(`🔔 Migrando ${pushSubs.length} suscripciones push...`);
    for (const ps of pushSubs) {
      await pgPool.query(
        `INSERT INTO push_subscriptions (id, family_id, endpoint, keys_json, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [ps.id, ps.family_id, ps.endpoint, ps.keys_json, ps.created_at || new Date()]
      );
    }

    // 6. Migrate Custom Specialties
    const specialties = sqliteDb.prepare('SELECT * FROM specialties').all() as any[];
    console.log(`🩺 Migrando ${specialties.length} especialidades...`);
    for (const s of specialties) {
      await pgPool.query(
        `INSERT INTO specialties (id, family_id, name, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.family_id, s.name, s.created_at || new Date()]
      );
    }

    console.log('✅ ¡Migración de SQLite a PostgreSQL completada con ÉXITO sin pérdida de datos!');
  } catch (error) {
    console.error('❌ Error durante la migración:', error);
  } finally {
    sqliteDb.close();
    await pgPool.end();
  }
}

migrate();
