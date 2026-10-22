import { useState } from 'react';
import CameraFeed from '../components/CameraFeed';
import { api } from '../api';

const input = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 disabled:opacity-60';

/**
 * Création de compte depuis le poste d'authentification :
 *   1. identifiant, mot de passe, consentement ;
 *   2. capture du visage par la caméra USB du PC Hôte ;
 *   3. compte créé (le tout premier devient administrateur, les suivants
 *      attendent la validation d'un administrateur).
 */
export default function RegisterKiosk({ onDone, onCancel }) {
  const [form, setForm] = useState({ username: '', password: '', confirm: '', consent: false });
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const headers = session ? { 'X-Terminal-Session': session } : {};
  const set = (field) => (e) =>
    setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const startCamera = async (e) => {
    e.preventDefault();
    setError(null);

    if (form.password.length < 12) return setError('Mot de passe trop court (12 caractères minimum)');
    if (form.password !== form.confirm) return setError('Les mots de passe ne correspondent pas');

    setBusy(true);
    try {
      const res = await api('/api/auth/terminal/register/start', {
        method: 'POST',
        body: { username: form.username }
      });
      setSession(res.session_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api('/api/auth/terminal/register', {
        method: 'POST',
        headers,
        body: { password: form.password, consent: form.consent }
      });
      onDone({ text: res.message, username: res.pending_approval ? '' : form.username });
    } catch (err) {
      setError(err.message);
      // Session expirée : retour au formulaire, la caméra est déjà éteinte
      if (err.status === 404) setSession(null);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (session) {
      await api('/api/auth/terminal/cancel', { method: 'POST', headers }).catch(() => {});
    }
    onCancel();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Créer un compte</h2>

      {!session ? (
        <form onSubmit={startCamera} className="space-y-3">
          <input
            className={input}
            placeholder="Identifiant (lettres, chiffres, . _ -)"
            autoComplete="username"
            value={form.username}
            onChange={set('username')}
            pattern="[A-Za-z0-9._\-]{3,100}"
            title="3 à 100 caractères : lettres, chiffres, point, tiret, tiret bas"
            disabled={busy}
            autoFocus
            required
          />
          <input
            className={input}
            type="password"
            placeholder="Mot de passe (12 caractères minimum)"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            disabled={busy}
            required
          />
          <input
            className={input}
            type="password"
            placeholder="Confirmation du mot de passe"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set('confirm')}
            disabled={busy}
            required
          />
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.consent}
              onChange={set('consent')}
              required
            />
            <span>
              J'accepte qu'un gabarit de mon visage (vecteur chiffré, aucune photo conservée) soit
              enregistré pour contrôler mon accès. Un administrateur peut le supprimer à ma demande.
            </span>
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              disabled={busy}
              className="flex-1 rounded-lg bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? 'Activation de la caméra…' : 'Suivant : mon visage'}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg border border-slate-600 px-4 py-2 hover:bg-slate-800"
            >
              Retour
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <CameraFeed
            path="/api/auth/terminal/frame"
            headers={headers}
            overlay={busy ? 'Capture en cours, ne bougez pas…' : 'Placez votre visage dans l\'ovale'}
          />
          <p className="text-center text-sm text-slate-400">
            Seul(e) devant la caméra du poste, regardez-la de face puis cliquez sur Capturer.
          </p>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={capture}
              disabled={busy}
              className="flex-1 rounded-lg bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              Capturer et créer le compte
            </button>
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-lg border border-slate-600 px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
