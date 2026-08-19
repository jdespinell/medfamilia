import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './database/db.js';
import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patients.js';
import appointmentRoutes from './routes/appointments.js';
import examRoutes from './routes/exams.js';
import calendarRoutes from './routes/calendar.js';
import pushRoutes from './routes/push.js';

dotenv.config();

// Initialize SQLite database
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploads directory static serving
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/push', pushRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MedFamilia API activa y saludable' });
});

// Serve frontend static build if available (for production / Docker)
const clientBuildDir = path.join(process.cwd(), '../client/dist');
if (fs.existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`🩺 MedFamilia Backend ejecutándose en puerto ${PORT}`);
  console.log(`================================================`);
});
