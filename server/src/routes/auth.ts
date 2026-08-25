import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth.js';
import { sendOtpVerificationCode } from '../services/whatsapp.js';

const router = Router();

// Send 6-Digit Verification Code via WhatsApp for Registration
router.post('/send-whatsapp-otp', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Número de WhatsApp requerido.' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `57${cleanPhone}` : cleanPhone;

    if (formattedPhone.length < 10) {
      return res.status(400).json({ error: 'Ingrese un número celular válido de 10 dígitos.' });
    }

    // Check if phone already registered
    const existingFamily = db.prepare('SELECT id FROM families WHERE phone_number = ?').get(formattedPhone);
    const existingNumber = db.prepare('SELECT id FROM family_whatsapp_numbers WHERE phone_number = ?').get(formattedPhone);

    if (existingFamily || existingNumber) {
      return res.status(400).json({ error: 'Este número de WhatsApp ya se encuentra registrado en otra familia.' });
    }

    // Generate 6-digit OTP code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes expiry

    // Save to database
    db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(formattedPhone);
    db.prepare('INSERT INTO otp_verifications (phone, code, expires_at) VALUES (?, ?, ?)').run(
      formattedPhone,
      otpCode,
      expiresAt
    );

    // Send code via WhatsApp
    const sent = await sendOtpVerificationCode(formattedPhone, otpCode);

    if (!sent) {
      return res.status(500).json({ error: 'No se pudo enviar el código por WhatsApp. Verifique el número de teléfono.' });
    }

    return res.json({
      message: 'Código de verificación de 6 dígitos enviado exitosamente a tu WhatsApp.',
      phone: formattedPhone
    });
  } catch (error) {
    console.error('Error enviando OTP de WhatsApp:', error);
    return res.status(500).json({ error: 'Error interno enviando código de verificación.' });
  }
});

// Register new family group (Requires WhatsApp OTP verification)
router.post('/register', async (req, res) => {
  try {
    const { name, code, password, phone, otp_code } = req.body;

    if (!name || typeof name !== 'string' || !code || typeof code !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Nombre de familia, código y contraseña son requeridos.' });
    }

    if (!phone || typeof phone !== 'string' || !otp_code || typeof otp_code !== 'string') {
      return res.status(400).json({ error: 'Número de WhatsApp y código de verificación de 6 dígitos requeridos.' });
    }

    const cleanName = name.trim();
    const cleanCode = code.toLowerCase().trim();
    const cleanPhone = phone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `57${cleanPhone}` : cleanPhone;
    const cleanOtp = otp_code.trim();

    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'El nombre de la familia debe tener al menos 2 caracteres.' });
    }

    if (cleanCode.length < 3 || !/^[a-z0-9_-]+$/.test(cleanCode)) {
      return res.status(400).json({ error: 'El código de familia debe tener al menos 3 caracteres alfanuméricos.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // Check OTP
    const otpRecord = db.prepare('SELECT code, expires_at FROM otp_verifications WHERE phone = ?').get(formattedPhone) as any;

    if (!otpRecord) {
      return res.status(400).json({ error: 'No se encontró una solicitud de código previa para este WhatsApp. Solicite uno nuevo.' });
    }

    if (otpRecord.code !== cleanOtp) {
      return res.status(400).json({ error: 'El código de verificación ingresado es incorrecto.' });
    }

    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ error: 'El código de verificación ha expirado. Solicite un nuevo código.' });
    }

    // Check if family code exists
    const existingCode = db.prepare('SELECT id FROM families WHERE code = ?').get(cleanCode);
    if (existingCode) {
      return res.status(400).json({ error: 'Este código de familia ya está registrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const familyId = uuidv4();

    // Create family with main phone number
    db.prepare('INSERT INTO families (id, code, name, password_hash, phone_number, subscription_status) VALUES (?, ?, ?, ?, ?, ?)').run([
      familyId,
      cleanCode,
      cleanName,
      passwordHash,
      formattedPhone,
      'trial'
    ]);

    // Add main phone number to authorized whatsapp numbers table
    db.prepare('INSERT INTO family_whatsapp_numbers (id, family_id, phone_number, label) VALUES (?, ?, ?, ?)').run(
      uuidv4(),
      familyId,
      formattedPhone,
      'Principal'
    );

    // Clean up OTP record
    db.prepare('DELETE FROM otp_verifications WHERE phone = ?').run(formattedPhone);

    // Create default initial patients: Papá y Mamá
    const papaId = uuidv4();
    const mamaId = uuidv4();
    db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run(
      papaId, familyId, 'Papá', 'Padre', '#3b82f6'
    );
    db.prepare('INSERT INTO patients (id, family_id, name, relationship, color) VALUES (?, ?, ?, ?, ?)').run(
      mamaId, familyId, 'Mamá', 'Madre', '#10b981'
    );

    const token = generateToken({ id: familyId, code: cleanCode, name: cleanName });

    return res.json({
      message: 'Familia registrada y verificada con éxito por WhatsApp.',
      token,
      family: { id: familyId, code: cleanCode, name: cleanName }
    });
  } catch (error) {
    console.error('Error registrando familia:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { code, password } = req.body;

    if (!code || typeof code !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Código de familia y contraseña requeridos.' });
    }

    const cleanCode = code.toLowerCase().trim();
    const family = db.prepare('SELECT * FROM families WHERE code = ?').get(cleanCode) as any;

    if (!family) {
      return res.status(401).json({ error: 'Código de familia o contraseña incorrectos.' });
    }

    const validPassword = await bcrypt.compare(password, family.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Código de familia o contraseña incorrectos.' });
    }

    const token = generateToken({ id: family.id, code: family.code, name: family.name });

    return res.json({
      token,
      family: { id: family.id, code: family.code, name: family.name }
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Get current session info
router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  return res.json({ family: req.family });
});

export default router;
