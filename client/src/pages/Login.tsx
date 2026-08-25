import React, { useState } from 'react';
import { Heart, Users, KeyRound, ShieldCheck, ArrowRight, Phone, MessageSquare, RefreshCw, CheckCircle2 } from 'lucide-react';
import { apiRequest, setToken } from '../api';
import { Family } from '../types';

interface LoginProps {
  onLoginSuccess: (family: Family) => void;
}

const COUNTRY_CODES = [
  { code: '57', flag: '🇨🇴', name: 'Colombia (+57)' },
  { code: '52', flag: '🇲🇽', name: 'México (+52)' },
  { code: '1', flag: '🇺🇸', name: 'EE.UU. / Canadá (+1)' },
  { code: '34', flag: '🇪🇸', name: 'España (+34)' },
  { code: '54', flag: '🇦🇷', name: 'Argentina (+54)' },
  { code: '56', flag: '🇨🇱', name: 'Chile (+56)' },
  { code: '51', flag: '🇵🇪', name: 'Perú (+51)' },
  { code: '593', flag: '🇪🇨', name: 'Ecuador (+593)' },
  { code: '58', flag: '🇻🇪', name: 'Venezuela (+58)' },
  { code: '55', flag: '🇧🇷', name: 'Brasil (+55)' },
  { code: '502', flag: '🇬🇹', name: 'Guatemala (+502)' },
  { code: '503', flag: '🇸🇻', name: 'El Salvador (+503)' },
  { code: '504', flag: '🇭🇳', name: 'Honduras (+504)' },
  { code: '506', flag: '🇨🇷', name: 'Costa Rica (+506)' },
  { code: '507', flag: '🇵🇦', name: 'Panamá (+507)' },
  { code: '591', flag: '🇧🇴', name: 'Bolivia (+591)' },
  { code: '595', flag: '🇵🇾', name: 'Paraguay (+595)' },
  { code: '598', flag: '🇺🇾', name: 'Uruguay (+598)' },
];

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [countryCode, setCountryCode] = useState('57'); // Default Colombia (+57)
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'form' | 'otp'>('form');

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const getFormattedFullPhone = () => {
    const cleanDigits = phone.replace(/\D/g, '');
    return cleanDigits.length === 10 ? `${countryCode}${cleanDigits}` : cleanDigits;
  };

  // Step 1: Send WhatsApp OTP Code
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    const fullPhone = getFormattedFullPhone();
    if (fullPhone.length < 10) {
      setError('Por favor ingrese un número celular válido.');
      return;
    }

    setLoading(true);

    try {
      const res = await apiRequest('/auth/send-whatsapp-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: fullPhone }),
      });

      setStep('otp');
      setInfo(`✅ Se ha enviado un código de verificación de 6 dígitos a tu WhatsApp (+${res.phone || fullPhone}).`);
    } catch (err: any) {
      setError(err.message || 'Error enviando el código de verificación por WhatsApp.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP & Register Account
  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const fullPhone = getFormattedFullPhone();

    try {
      const res = await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name,
          code,
          password,
          phone: fullPhone,
          otp_code: otpCode,
        }),
      });

      setToken(res.token);
      onLoginSuccess(res.family);
    } catch (err: any) {
      setError(err.message || 'Error al verificar el código de WhatsApp.');
    } finally {
      setLoading(false);
    }
  };

  // Login handler for existing accounts
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ code, password }),
      });

      setToken(res.token);
      onLoginSuccess(res.family);
    } catch (err: any) {
      setError(err.message || 'Código de familia o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-8 bg-gradient-to-b from-blue-50 to-slate-100">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-6 md:p-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/30 mb-2">
            <Heart className="w-9 h-9 fill-current" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">MedFamilia</h1>
          <p className="text-base font-medium text-slate-600">
            {isRegister
              ? step === 'otp'
                ? 'Verificación de WhatsApp'
                : 'Crear un nuevo grupo familiar'
              : 'Organizador de Citas Médicas para la Familia'}
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold text-center">
            {error}
          </div>
        )}

        {info && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold text-center flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{info}</span>
          </div>
        )}

        {!isRegister ? (
          /* LOGIN FORM */
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-base font-bold text-slate-800 mb-1.5">
                Código de Familia
              </label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="ej. perez2026"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 text-lg rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 focus:bg-white transition uppercase font-mono tracking-wider"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">Identificador único del grupo de la familia</p>
            </div>

            <div>
              <label className="block text-base font-bold text-slate-800 mb-1.5">
                Contraseña Compartida
              </label>
              <div className="relative">
                <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 text-lg rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 focus:bg-white transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 text-lg font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] rounded-2xl shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {loading ? (
                <span>Ingresando...</span>
              ) : (
                <>
                  <span>Ingresar a Citas</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        ) : step === 'form' ? (
          /* REGISTER STEP 1: FORM */
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-1">
                Nombre de la Familia
              </label>
              <div className="relative">
                <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="ej. Familia Pérez"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 focus:bg-white transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-800 mb-1">
                Código de Familia Único
              </label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="ej. perez2026"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 focus:bg-white transition uppercase font-mono tracking-wider"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-800 mb-1">
                Contraseña Compartida
              </label>
              <div className="relative">
                <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 text-base rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 focus:bg-white transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-800 mb-1">
                Número de WhatsApp (Para Código de Verificación)
              </label>

              <div className="flex items-center gap-2">
                {/* Country Code Selector */}
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="py-3 px-2 text-sm font-bold rounded-2xl border-2 border-slate-200 focus:border-emerald-600 focus:outline-none bg-slate-50 focus:bg-white transition shrink-0 cursor-pointer"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} +{c.code}
                    </option>
                  ))}
                </select>

                <div className="relative flex-1">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-600" />
                  <input
                    type="tel"
                    required
                    placeholder="ej. 3001234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 text-base rounded-2xl border-2 border-slate-200 focus:border-emerald-600 focus:outline-none bg-slate-50 focus:bg-white transition"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-1">Te enviaremos un código de 6 dígitos por WhatsApp para validar tu celular.</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] rounded-2xl shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {loading ? (
                <span>Enviando código WhatsApp...</span>
              ) : (
                <>
                  <MessageSquare className="w-5 h-5" />
                  <span>Enviar Código por WhatsApp</span>
                </>
              )}
            </button>
          </form>
        ) : (
          /* REGISTER STEP 2: VERIFY OTP */
          <form onSubmit={handleVerifyAndRegister} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-1.5 text-center">
                Ingresa el Código de 6 Dígitos
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full py-4 text-center text-3xl font-mono font-bold tracking-[8px] rounded-2xl border-2 border-emerald-500 focus:border-emerald-600 focus:outline-none bg-emerald-50/30 text-emerald-900"
                />
              </div>
              <p className="text-xs text-slate-500 mt-2 text-center">
                Revisa la conversación de WhatsApp en tu celular <b>+{getFormattedFullPhone()}</b>.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || otpCode.length !== 6}
              className="w-full py-4 text-lg font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] rounded-2xl shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {loading ? (
                <span>Verificando y registrando...</span>
              ) : (
                <>
                  <ShieldCheck className="w-6 h-6" />
                  <span>Verificar Código y Activar Cuenta</span>
                </>
              )}
            </button>

            <div className="flex justify-between items-center text-xs pt-1">
              <button
                type="button"
                onClick={() => setStep('form')}
                className="text-slate-500 hover:text-slate-700 font-semibold"
              >
                ← Cambiar número (+{getFormattedFullPhone()})
              </button>

              <button
                type="button"
                onClick={handleSendOtp}
                disabled={loading}
                className="text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reenviar código</span>
              </button>
            </div>
          </form>
        )}

        {/* Toggle Register / Login */}
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setStep('form');
              setError('');
              setInfo('');
            }}
            className="text-base font-semibold text-blue-700 hover:text-blue-900 underline underline-offset-4"
          >
            {isRegister
              ? '¿Ya tienes un código de familia? Inicia sesión aquí'
              : '¿Primera vez? Registrar una nueva familia'}
          </button>
        </div>
      </div>
    </div>
  );
};
