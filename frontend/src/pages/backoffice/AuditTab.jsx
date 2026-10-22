import { useEffect, useState } from 'react';
import { api } from '../../api';

const FAILURE = /failure|rejected|locked|denied|error/;

export default function AuditTab({ token }) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () =>
      api('/api/auth/admin/audit', { token })
        .then((data) => setEvents(data.events))
        .catch((err) => setError(err.message));

    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [token]);

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-400">
          <tr>
            <th className="py-2 pr-3">Date</th>
            <th className="py-2 pr-3">Événement</th>
            <th className="py-2 pr-3">Identifiant</th>
            <th className="py-2 pr-3">Par</th>
            <th className="py-2">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {events.map((e) => (
            <tr key={e.id}>
              <td className="py-1.5 pr-3 text-slate-400">{new Date(e.ts).toLocaleString('fr-FR')}</td>
              <td className={`py-1.5 pr-3 font-mono text-xs ${FAILURE.test(e.event) ? 'text-red-300' : ''}`}>
                {e.event}
              </td>
              <td className="py-1.5 pr-3">{e.username || (e.user_id ? `#${e.user_id}` : '—')}</td>
              <td className="py-1.5 pr-3">{e.actor_id ? `#${e.actor_id}` : '—'}</td>
              <td className="py-1.5 font-mono text-xs text-slate-400">{e.ip || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
