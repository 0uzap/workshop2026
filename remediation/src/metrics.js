const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Service vu comme disponible (1) ou non (0) par le moteur
const targetUp = new client.Gauge({
  name: 'remediation_target_up',
  help: 'Disponibilite constatee du service (1=ok, 0=ko)',
  labelNames: ['target'],
  registers: [register]
});

// Phase de la machine d'etats (healthy, degraded, remediating, verifying, escalated)
const targetState = new client.Gauge({
  name: 'remediation_target_state',
  help: 'Phase du moteur pour le service (1 sur la phase courante)',
  labelNames: ['target', 'state'],
  registers: [register]
});

const incidents = new client.Counter({
  name: 'remediation_incidents_total',
  help: 'Incidents traites par resultat',
  labelNames: ['target', 'outcome'],
  registers: [register]
});

const actions = new client.Counter({
  name: 'remediation_actions_total',
  help: 'Actions de remediation executees',
  labelNames: ['target', 'action'],
  registers: [register]
});

const recoverySeconds = new client.Histogram({
  name: 'remediation_recovery_duration_seconds',
  help: 'Duree entre detection et service verifie retabli',
  labelNames: ['target'],
  buckets: [1, 2, 5, 10, 15, 20, 30, 45, 60, 120],
  registers: [register]
});

const STATES = ['healthy', 'degraded', 'remediating', 'verifying', 'escalated'];
const setState = (target, state) => {
  for (const s of STATES) targetState.set({ target, state: s }, s === state ? 1 : 0);
};

module.exports = {
  register, targetUp, incidents, actions, recoverySeconds, setState
};
