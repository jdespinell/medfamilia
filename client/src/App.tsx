import React, { useState, useEffect } from 'react';
import { apiRequest, getToken, removeToken } from './api';
import { Family } from './types';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';

export const App: React.FC = () => {
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    apiRequest('/auth/me')
      .then((res) => {
        setFamily(res.family);
      })
      .catch(() => {
        removeToken();
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleLogout = () => {
    removeToken();
    setFamily(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-bold text-slate-700">Cargando MedFamilia...</p>
        </div>
      </div>
    );
  }

  if (!family) {
    return <Login onLoginSuccess={(fam) => setFamily(fam)} />;
  }

  return <Dashboard family={family} onLogout={handleLogout} />;
};

export default App;
