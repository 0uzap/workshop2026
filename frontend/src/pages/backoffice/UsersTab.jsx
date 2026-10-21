import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import EnrollPanel from './EnrollPanel';

const ROLE_LABELS = {
  admin: 'Administrateur',
  operator: 'Opérateur',
  auditor: 'Auditeur',
  user: 'Client API'
};

const input = 'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm';
const smallButton = 'rounded-md border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800';

export default function UsersTab({ token, me }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [message, setMessage] = useState(null);
  const [enrolling, setEnrolling] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'operator' });
  const [passwordFor, setPasswordFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const canWrite = me.permissions.includes('users:write');
  const canFaces = me.permissions.includes('faces:manage');
  const canUnlock = me.permissions.includes('locks:manage');

  const load = useCallback(() => {
    api('/api/auth/admin/users', { token })
      .then((data) => {
        setUsers(data.users);
        setRoles(data.roles);
      })
      .catch((err) => setMessage({ error: true, text: err.message }));
  }, [token]);

  useEffect(load, [load]);

  const run = async (action, success) => {
    try {
      await action();
      setMessage({ text: success });
      load();
    } catch (err) {
      setMessage({ error: true, text: err.message });
    }
  };

  const createUser = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/api/auth/admin/users', { method: 'POST', token, body: form });
      setForm({ username: '', password: '', role: 'operator' });
    }, 'Utilisateur créé. Pensez à enrôler son visage.');
  };

  const update = (user, body, success) =>
    run(() => api(`/api/auth/admin/users/${user.id}`, { method: 'PATCH', token, body }), success);

  const changePassword = (e) => {
    e.preventDefault();
    update(passwordFor, { password: newPassword }, 'Mot de passe modifié');
    setPasswordFor(null);
    setNewPassword('');
  };

  if (enrolling) {
    return (
      <EnrollPanel
        token={token}
        user={enrolling}
        onClose={(text) => {
          setEnrolling(null);
          if (text) setMessage({ text });
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-400">
            <tr>
              <th className="py-2 pr-3">Identifiant</th>
              <th className="py-2 pr-3">Rôle</th>
              <th className="py-2 pr-3">Statut</th>
              <th className="py-2 pr-3">Visage</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                <td className="py-2 pr-3 font-medium">
                  {u.username}
                  {u.id === me.id && <span className="ml-1 text-xs text-slate-500">(vous)</span>}
                </td>
                <td className="py-2 pr-3">
                  {canWrite ? (
                    <select
                      className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5"
                      value={u.role}
                      onChange={(e) => update(u, { role: e.target.value }, 'Rôle modifié')}
                    >
                      {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                    </select>
                  ) : (ROLE_LABELS[u.role] || u.role)}
                </td>
                <td className="py-2 pr-3">
                  {u.locked_until ? (
                    <span className="text-red-400">Bloqué</span>
                  ) : u.is_active ? 'Actif' : 'Désactivé'}
                </td>
                <td className="py-2 pr-3">
                  {u.face_enrolled_at
                    ? <span className="text-emerald-300">Enrôlé</span>
                    : <span className="text-amber-300">Non enrôlé</span>}
                </td>
                <td className="flex flex-wrap gap-1 py-2">
                  {canFaces && u.role !== 'user' && (
                    <button className={smallButton} onClick={() => setEnrolling(u)}>
                      {u.face_enrolled_at ? 'Ré-enrôler' : 'Enrôler'} le visage
                    </button>
                  )}
                  {canFaces && u.face_enrolled_at && (
                    <button
                      className={`${smallButton} border-red-800 text-red-300`}
                      onClick={() => run(
                        () => api(`/api/auth/admin/users/${u.id}/face`, { method: 'DELETE', token }),
                        'Données biométriques supprimées'
                      )}
                    >
                      Supprimer le visage
                    </button>
                  )}
                  {canWrite && (
                    <button
                      className={smallButton}
                      onClick={() => update(
                        u,
                        { is_active: !u.is_active },
                        u.is_active ? 'Compte désactivé' : 'Compte réactivé'
                      )}
                    >
                      {u.is_active ? 'Désactiver' : 'Réactiver'}
                    </button>
                  )}
                  {canWrite && (
                    <button className={smallButton} onClick={() => setPasswordFor(u)}>
                      Mot de passe
                    </button>
                  )}
                  {canUnlock && u.locked_until && (
                    <button
                      className={smallButton}
                      onClick={() => run(
                        () => api(`/api/auth/admin/users/${u.id}/unlock`, { method: 'POST', token }),
                        'Identifiant débloqué'
                      )}
                    >
                      Débloquer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {passwordFor && (
        <form onSubmit={changePassword} className="flex flex-wrap gap-2 rounded-xl border border-slate-800 p-4">
          <span className="w-full text-sm">Nouveau mot de passe pour {passwordFor.username}</span>
          <input
            type="password"
            className={`${input} flex-1`}
            placeholder="12 caractères minimum"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={12}
            required
          />
          <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500">
            Enregistrer
          </button>
          <button type="button" className={smallButton} onClick={() => setPasswordFor(null)}>Annuler</button>
        </form>
      )}

      {canWrite && (
        <form onSubmit={createUser} className="space-y-3 rounded-xl border border-slate-800 p-4">
          <h3 className="font-semibold">Nouvel utilisateur</h3>
          <div className="flex flex-wrap gap-2">
            <input
              className={`${input} flex-1`}
              placeholder="Identifiant"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              minLength={3}
              required
            />
            <input
              type="password"
              className={`${input} flex-1`}
              placeholder="Mot de passe (12 car. min.)"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={12}
              required
            />
            <select
              className={input}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
            </select>
            <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500">
              Créer
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className={`text-sm ${message.error ? 'text-red-400' : 'text-emerald-300'}`}>{message.text}</p>
      )}
    </div>
  );
}
