import React, { useState } from 'react';
import { Heart, Users, KeyRound, ShieldCheck, ArrowRight } from 'lucide-react';
import { apiRequest, setToken } from '../api';
import { Family } from '../types';

interface LoginProps {
  onLoginSuccess: (family: Family) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const body = isRegister ? { name, code, password } : { code, password };

      const res = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      setToken(res.token);
      onLoginSuccess(res.family);
    } catch (err: any) {
      setError(err.message || 'Error en el inicio de sesión.');
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
            {isRegister ? 'Crear un nuevo grupo familiar' : 'Organizador de Citas Médicas para la Familia'}
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {isRegister && (
            <div>
              <label className="block text-base font-bold text-slate-800 mb-1.5">
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
                  className="w-full pl-12 pr-4 py-3.5 text-lg rounded-2xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none bg-slate-50 focus:bg-white transition"
                />
              </div>
            </div>
          )}

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
              <span>Cargando...</span>
            ) : (
              <>
                <span>{isRegister ? 'Registrar Grupo Familiar' : 'Ingresar a Citas'}</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        {/* Toggle Register / Login */}
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
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
