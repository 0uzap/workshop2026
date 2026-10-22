import { useEffect, useState } from 'react';
import CameraFeed from '../../components/CameraFeed';
import { api } from '../../api';

/**
 * Enrôlement d'un visage avec la caméra USB du PC Hôte : la personne
 * concernée se place devant le poste, l'administrateur déclenche la capture.
 */
export default function EnrollPanel({ token, user, onClose }) {
  const [session, setSession] = useState(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let sessionId = null;
    let closed = false;

    const release = (id) =>
      api('/api/auth/admin/face/cancel', { method: 'POST', token, body: { session_id: id } })
        .catch(() => {});

    api(`/api/auth/admin/users/${user.id}/face/session`, { method: 'POST', token })
      .then((res) => {
        // Panneau déjà fermé avant l'allumage de la caméra : on la rend aussitôt
        if (closed) return release(res.session_id);
        sessionId = res.session_id;
        setSession(res.session_id);
      })
      .catch((err) => setError(err.message));

    // Quitter le panneau éteint la caméra
    return () => {
      closed = true;
      if (sessionId) release(sessionId);
    };
  }, [token, user.id]);

  const capture = async () => {
    setError(null);
    setBusy(true);
    try {
      await api(`/api/auth/admin/users/${user.id}/face`, {
        method: 'POST',
        token,
        body: { session_id: session, consent }
      });
      setSession(null);
      onClose(`Visage de ${user.username} enrôlé`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Enrôlement du visage de {user.username}</h3>

      {session && (
        <CameraFeed
          path="/api/auth/admin/face/frame"
          headers={{ Authorization: `Bearer ${token}`, 'X-Terminal-Session': session }}
          overlay={busy ? 'Capture en cours, ne bougez pas…' : `${user.username} : regardez la caméra`}
        />
      )}

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          {user.username} consent à l'enregistrement de son gabarit facial (vecteur chiffré, aucune
          photo conservée), supprimable à tout moment.
        </span>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={capture}
          disabled={!session || !consent || busy}
          className="flex-1 rounded-lg bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
        >
          Capturer
        </button>
        <button
          onClick={() => onClose(null)}
          disabled={busy}
          className="flex-1 rounded-lg border border-slate-600 py-2 hover:bg-slate-800 disabled:opacity-50"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
