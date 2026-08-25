import React, { useState, useEffect } from 'react';
import { X, Phone, Plus, Trash2, ShieldCheck, AlertCircle, MessageSquare } from 'lucide-react';
import { apiRequest } from '../api';

interface WhatsAppNumberItem {
  id: string;
  family_id: string;
  phone_number: string;
  label: string;
  created_at: string;
}

interface WhatsAppNumbersModalProps {
  onClose: () => void;
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

export const WhatsAppNumbersModal: React.FC<WhatsAppNumbersModalProps> = ({ onClose }) => {
  const [numbers, setNumbers] = useState<WhatsAppNumberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [countryCode, setCountryCode] = useState('57'); // Predeterminado Colombia (+57)
  const [newPhone, setNewPhone] = useState('');
  const [newLabel, setNewLabel] = useState('Principal');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchNumbers = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/whatsapp-numbers');
      setNumbers(data);
    } catch (err: any) {
      setError(err.message || 'Error cargando números autorizados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNumbers();
  }, []);

  const handleAddNumber = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const cleanDigits = newPhone.replace(/\D/g, '');
    if (!cleanDigits) {
      setError('Por favor ingrese un número telefónico válido.');
      return;
    }

    // Prepend country code only if cleanDigits is 10 digits (local format)
    const finalPhone = cleanDigits.length === 10 ? `${countryCode}${cleanDigits}` : cleanDigits;

    setAdding(true);

    try {
      await apiRequest('/whatsapp-numbers', {
        method: 'POST',
        body: JSON.stringify({
          phone_number: finalPhone,
          label: newLabel,
        }),
      });

      setSuccess(`Número (+${finalPhone}) agregado con éxito.`);
      setNewPhone('');
      setNewLabel('Familiar');
      fetchNumbers();
    } catch (err: any) {
      setError(err.message || 'No se pudo agregar el número.');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteNumber = async (id: string) => {
    if (!window.confirm('¿Está seguro de eliminar este número de WhatsApp autorizado?')) return;
    setError('');
    setSuccess('');

    try {
      await apiRequest(`/whatsapp-numbers/${id}`, {
        method: 'DELETE',
      });
      setSuccess('Número de WhatsApp eliminado.');
      fetchNumbers();
    } catch (err: any) {
      setError(err.message || 'Error al eliminar número.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <MessageSquare className="w-6 h-6 fill-current text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Números de WhatsApp</h2>
              <p className="text-xs text-emerald-100">Autorizados para agendar con IA ({numbers.length} / 4)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {error && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Form to Add New Number */}
          {numbers.length < 4 ? (
            <form onSubmit={handleAddNumber} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-600" />
                <span>Agregar Celular Autorizado</span>
              </h3>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Indicativo de País y Celular</label>
                <div className="flex items-center gap-2">
                  {/* Country Selector */}
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="py-2.5 px-2 text-sm font-bold rounded-xl border border-slate-300 focus:border-emerald-600 focus:outline-none bg-white shrink-0 cursor-pointer"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} +{c.code}
                      </option>
                    ))}
                  </select>

                  {/* Phone Input */}
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="tel"
                      required
                      placeholder="ej. 3001234567"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-emerald-600 focus:outline-none bg-white"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Etiqueta / Parentesco</label>
                <select
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-emerald-600 focus:outline-none bg-white"
                >
                  <option value="Principal">Principal</option>
                  <option value="Papá">Papá</option>
                  <option value="Mamá">Mamá</option>
                  <option value="Hijo/a">Hijo/a</option>
                  <option value="Cuidador">Cuidador</option>
                  <option value="Familiar">Otro Familiar</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={adding}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-sm rounded-xl transition shadow-md shadow-emerald-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {adding ? 'Agregando...' : 'Guardar Número Autorizado'}
              </button>
            </form>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-xs font-medium">
              ⚠️ Has alcanzado el límite máximo de 4 números de WhatsApp autorizados por familia.
            </div>
          )}

          {/* List of Numbers */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800">Números Registrados</h3>

            {loading ? (
              <div className="py-8 text-center text-slate-400 text-sm">Cargando números...</div>
            ) : numbers.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-sm bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                No tienes números de WhatsApp vinculados.
              </div>
            ) : (
              numbers.map((num) => (
                <div
                  key={num.id}
                  className="flex items-center justify-between p-3.5 bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-200 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                      <Phone className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 text-sm">+{num.phone_number}</p>
                      <span className="inline-block text-[11px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md">
                        {num.label}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteNumber(num.id)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition"
                    title="Eliminar número"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-sm rounded-xl transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
