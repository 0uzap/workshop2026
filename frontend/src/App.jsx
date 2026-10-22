import { useEffect, useState } from 'react';
import LoginKiosk from './pages/LoginKiosk';
import RegisterKiosk from './pages/RegisterKiosk';
import BackOffice from './pages/BackOffice';
import { SESSION_EXPIRED_EVENT } from './api';

export default function App() {
  const [token, setToken] = useState(null);
  const [view, setView] = useState('login');
  const [notice, setNotice] = useState(null);

  // Jeton expiré ou compte désactivé pendant la session : retour à la connexion
  useEffect(() => {
    const onExpired = () => {
      setToken(null);
      setView('login');
      setNotice({ error: true, text: 'Session expirée, reconnectez-vous' });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const logout = () => {
    setToken(null);
    setView('login');
    setNotice({ text: 'Vous êtes déconnecté' });
  };

  let content;
  if (token) {
    content = <BackOffice token={token} onLogout={logout} />;
  } else if (view === 'register') {
    content = (
      <RegisterKiosk
        onCancel={() => setView('login')}
        onDone={(result) => {
          setNotice(result);
          setView('login');
        }}
      />
    );
  } else {
    content = (
      <LoginKiosk
        notice={notice}
        onToken={(t) => {
          setNotice(null);
          setToken(t);
        }}
        onRegister={() => {
          setNotice(null);
          setView('register');
        }}
      />
    );
  }

  return (
    <main className={`mx-auto px-4 py-10 ${token ? 'max-w-5xl' : 'max-w-lg'}`}>
      <h1 className="mb-8 text-center text-2xl font-bold tracking-tight">
        Resilience <span className="text-emerald-400">Pay</span>
      </h1>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">{content}</div>
    </main>
  );
}
