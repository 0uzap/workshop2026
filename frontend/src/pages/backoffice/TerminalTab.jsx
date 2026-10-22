import { useEffect, useState } from 'react';
import { api } from '../../api';

const LED_LABELS = {
  off: { text: 'Éteinte', color: 'bg-slate-700' },
  green_blink: { text: 'Vert clignotant', color: 'bg-emerald-500 animate-pulse' },
  green_on: { text: 'Vert fixe', color: 'bg-emerald-500' },
  red_on: { text: 'Rouge fixe', color: 'bg-red-500' },
  red_blink: { text: 'Rouge clignotant', color: 'bg-red-500 animate-pulse' }
};

const PHASES = {
  idle: 'En attente',
  starting: 'Démarrage',
  identifying: 'Identification en cours',
  rejected: 'Refus (délai de 30 s)',
  awaiting_password: 'Attente du mot de passe',
  checking: 'Vérification du mot de passe',
  enrolling: 'Enrôlement en cours',
  error: 'Erreur'
};

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 border-b border-slate-800 py-2 text-sm">
    <span className="text-slate-400">{label}</span>
    <span className="text-right">{children}</span>
  </div>
);

export default function TerminalTab({ token }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () =>
      api('/api/auth/admin/terminal', { token })
        .then(setStatus)
        .catch((err) => setError(err.message));

    load();
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [token]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!status) return <p className="text-slate-400">Chargement…</p>;

  const led = LED_LABELS[status.led.mode] || LED_LABELS.off;
  const lastSeen = status.led.device_last_seen ? new Date(status.led.device_last_seen) : null;
  const deviceOnline = lastSeen && Date.now() - lastSeen.getTime() < 5000;
  const agentUp = status.camera_agent.status === 'healthy';

  return (
    <div className="space-y-1">
      <Row label="Poste d'authentification">{PHASES[status.terminal.phase] || status.terminal.phase}</Row>
      <Row label="Agent caméra (PC Hôte)">
        {agentUp
          ? <span className="text-emerald-300">Connecté (caméra {status.camera_agent.camera_index})</span>
          : <span className="text-red-400">Injoignable</span>}
      </Row>
      <Row label="Caméra">{status.terminal.camera_on ? 'Allumée' : 'Éteinte'}</Row>
      <Row label="LED (état commandé)">
        <span className="inline-flex items-center gap-2">
          <span className={`inline-block h-3 w-3 rounded-full ${led.color}`} />
          {led.text}
        </span>
      </Row>
      <Row label="Module ESP8266">
        {deviceOnline
          ? <span className="text-emerald-300">En ligne</span>
          : <span className="text-red-400">
            Hors ligne{lastSeen ? ` (vu à ${lastSeen.toLocaleTimeString('fr-FR')})` : ''}
          </span>}
      </Row>
    </div>
  );
}
