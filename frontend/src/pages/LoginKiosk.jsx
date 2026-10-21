import { useEffect, useRef, useState } from 'react';
import CameraFeed from '../components/CameraFeed';
import { api } from '../api';

// L'aperçu est en miroir : la gauche de l'utilisateur apparaît à gauche de l'écran
const DIRECTIONS = {
  left: { label: 'vers votre GAUCHE', arrow: '←' },
  right: { label: 'vers votre DROITE', arrow: '→' }
};

const formatTime = (date) =>
  new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Poste d'authentification du back-office :
 *   1. identifiant → la caméra USB du PC Hôte s'allume ;
 *   2. visage reconnu (+ rotation de tête demandée) → saisie du mot de passe ;
 *   3. sinon : 30 s d'attente (LED rouge), puis retour à l'identifiant.
 */
export default function LoginKiosk({ onToken }) {
  const [step, setStep] = useState('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [message, setMessage] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const lastState = useRef(null);

  const headers = session ? { 'X-Terminal-Session': session.session_id } : {};

  const restart = (msg = null) => {
    setStep('username');
    setUsername('');
    setPassword('');
    setSession(null);
    setState(null);
    lastState.current = null;
    setMessage(msg);
    setTimeout(() => usernameRef.current?.focus(), 0);
  };

  // Suivi de l'identification menée par le serveur
  useEffect(() => {
    if (step !== 'camera' && step !== 'rejected') return undefined;

    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        try {
          const s = await api('/api/auth/terminal/state', { headers });
          if (stopped) return;
          lastState.current = s;
          setState(s);

          if (s.phase === 'awaiting_password') {
            setStep('password');
            setMessage(null);
            setTimeout(() => passwordRef.current?.focus(), 0);
            return;
          }
          if (s.phase === 'rejected' && step !== 'rejected') {
            setStep('rejected');
          }
          if (s.phase === 'error') {
            restart({ error: true, text: s.error });
            return;
          }
        } catch (err) {
          // Session close : fin du délai d'attente après un refus
          if (!stopped) {
            const locked = lastState.current?.locked_until;
            restart(locked
              ? { error: true, text: `Identifiant bloqué jusqu'à ${formatTime(locked)}` }
              : null);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    };
    poll();

    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, session]);

  // Compte à rebours affiché pendant la LED rouge fixe
  useEffect(() => {
    if (step !== 'rejected' || state?.cooldown_ms == null) return undefined;
    setCountdown(Math.ceil(state.cooldown_ms / 1000));
    const timer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const submitUsername = async (e) => {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const res = await api('/api/auth/terminal/identify', { method: 'POST', body: { username } });
      setSession(res);
      setStep('camera');
    } catch (err) {
      const lockedUntil = err.body?.locked_until;
      restart({
        error: true,
        text: lockedUntil ? `Identifiant bloqué jusqu'à ${formatTime(lockedUntil)}` : err.message
      });
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/api/auth/terminal/password', {
        method: 'POST',
        headers,
        body: { password }
      });
      setPassword('');
      onToken(res.token);
    } catch (err) {
      const lockedUntil = err.body?.locked_until;
      restart({
        error: true,
        text: lockedUntil
          ? `Mot de passe incorrect. Identifiant bloqué jusqu'à ${formatTime(lockedUntil)}`
          : err.message
      });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await api('/api/auth/terminal/cancel', { method: 'POST', headers }).catch(() => {});
    restart();
  };

  const direction = session ? DIRECTIONS[session.direction] : null;
  const overlay = state?.step === 'turn'
    ? `${direction.arrow} Tournez la tête ${direction.label}`
    : 'Regardez la caméra';

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Accès au back-office</h2>

      <form onSubmit={submitUsername} className="space-y-3">
        <input
          ref={usernameRef}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 disabled:opacity-60"
          placeholder="Identifiant"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={step !== 'username' || busy}
          autoFocus
          required
        />
        {step === 'username' && (
          <button
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Activation de la caméra…' : 'Suivant'}
          </button>
        )}
      </form>

      {step === 'camera' && (
        <>
          <CameraFeed path="/api/auth/terminal/frame" headers={headers} overlay={overlay} />
          <p className="text-center text-sm text-slate-400">
            Vérification de l'identité par la caméra du poste…
          </p>
        </>
      )}

      {step === 'rejected' && (
        <div className="space-y-3">
          <CameraFeed path="/api/auth/terminal/frame" headers={headers} overlay="Visage non reconnu" />
          <p className="rounded-lg bg-red-950 p-3 text-center text-red-200">
            Identité non confirmée. Nouvel essai possible dans {countdown} s.
            {state?.locked_until && (
              <><br />Identifiant bloqué jusqu'à {formatTime(state.locked_until)}.</>
            )}
          </p>
        </div>
      )}

      {step === 'password' && (
        <form onSubmit={submitPassword} className="space-y-3">
          <p className="rounded-lg bg-emerald-950 p-3 text-sm text-emerald-200">
            Identité confirmée. Saisissez votre mot de passe.
          </p>
          <input
            ref={passwordRef}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            type="password"
            placeholder="Mot de passe"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="flex gap-3">
            <button
              disabled={busy}
              className="flex-1 rounded-lg bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="rounded-lg border border-slate-600 px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
            >
              Annuler
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
