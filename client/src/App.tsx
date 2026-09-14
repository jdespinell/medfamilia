import React, { useState, useEffect } from 'react';
import { apiRequest, getToken, removeToken } from './api';
import { Family, Patient, Specialty } from './types';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { AdminPage } from './pages/AdminPage';
import { PatientTimelinePage } from './pages/PatientTimelinePage';

export const App: React.FC = () => {
  const [isAdminRoute, setIsAdminRoute] = useState(window.location.pathname.startsWith('/admin'));
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);

  // Patient timeline navigation state
  const [timelinePatient, setTimelinePatient] = useState<Patient | null>(null);
  const [specialtiesList, setSpecialtiesList] = useState<Specialty[]>([]);

  useEffect(() => {
    const handlePopState = () => {
      setIsAdminRoute(window.location.pathname.startsWith('/admin'));
    };

    window.addEventListener('popstate', handlePopState);

    if (window.location.pathname.startsWith('/admin')) {
      setLoading(false);
      return () => window.removeEventListener('popstate', handlePopState);
    }

    const token = getToken();
    if (!token) {
      setLoading(false);
      return () => window.removeEventListener('popstate', handlePopState);
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

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Route: /admin -> Render standalone Superadmin Page
  if (isAdminRoute) {
    return <AdminPage />;
  }

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

  // Show patient timeline page when a patient is selected
  if (timelinePatient) {
    return (
      <PatientTimelinePage
        patient={timelinePatient}
        specialties={specialtiesList}
        onBack={() => setTimelinePatient(null)}
      />
    );
  }

  return (
    <Dashboard
      family={family}
      onLogout={handleLogout}
      onViewPatientTimeline={(patient, specialties) => {
        setSpecialtiesList(specialties || []);
        setTimelinePatient(patient);
      }}
    />
  );

  function handleLogout() {
    removeToken();
    setFamily(null);
  }
};

export default App;
