import { useState } from 'react';
import LoginKiosk from './pages/LoginKiosk';
import BackOffice from './pages/BackOffice';

export default function App() {
  const [token, setToken] = useState(null);

  return (
    <main className={`mx-auto px-4 py-10 ${token ? 'max-w-5xl' : 'max-w-lg'}`}>
      <h1 className="mb-8 text-center text-2xl font-bold tracking-tight">
        Resilience <span className="text-emerald-400">Pay</span>
      </h1>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        {token
          ? <BackOffice token={token} onLogout={() => setToken(null)} />
          : <LoginKiosk onToken={setToken} />}
      </div>
    </main>
  );
}
