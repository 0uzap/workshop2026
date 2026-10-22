import { useEffect, useState } from 'react';
import { api } from '../api';
import UsersTab from './backoffice/UsersTab';
import PaymentsTab from './backoffice/PaymentsTab';
import AuditTab from './backoffice/AuditTab';
import TerminalTab from './backoffice/TerminalTab';

// Chaque onglet n'apparaît que si le rôle possède la permission correspondante
const TABS = [
  { id: 'users', label: 'Utilisateurs & habilitations', permission: 'users:read', Component: UsersTab },
  { id: 'payments', label: 'Paiements', permission: 'payments:read', Component: PaymentsTab },
  { id: 'audit', label: 'Journal d\'authentification', permission: 'audit:read', Component: AuditTab },
  { id: 'terminal', label: 'Poste & LED', permission: 'terminal:read', Component: TerminalTab }
];

const ROLE_LABELS = { admin: 'Administrateur', operator: 'Opérateur', auditor: 'Auditeur' };

export default function BackOffice({ token, onLogout }) {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/auth/admin/me', { token })
      .then((data) => {
        setMe(data);
        setTab(TABS.find((t) => data.permissions.includes(t.permission))?.id);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-red-400">{error}</p>
        <button onClick={onLogout} className="text-sm text-slate-400 hover:text-slate-100">Retour</button>
      </div>
    );
  }

  if (!me) return <p className="text-slate-400">Chargement…</p>;

  const tabs = TABS.filter((t) => me.permissions.includes(t.permission));
  const Current = tabs.find((t) => t.id === tab)?.Component;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Back-office</h2>
          <p className="text-sm text-slate-400">
            {me.username} — {ROLE_LABELS[me.role] || me.role}
          </p>
        </div>
        <button onClick={onLogout} className="text-sm text-slate-400 hover:text-slate-100">
          Déconnexion
        </button>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === t.id ? 'bg-emerald-600 font-semibold' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {Current && <Current token={token} me={me} />}
    </div>
  );
}
