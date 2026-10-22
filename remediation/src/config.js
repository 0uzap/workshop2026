// Configuration du moteur de remediation.

module.exports = {
  tickMs: Number(process.env.TICK_MS || 2000),

  // Services surveilles. `business: true` => sa reprise est prouvee par un
  // canari metier (transaction annulee), pas seulement par un /health.
  targets: [
    {
      key: 'backend',
      label: 'API de paiement',
      container: 'resilience-backend',
      health: 'http://backend:3000/health',
      canary: 'http://backend:3000/internal/canary',
      business: true
    },
    {
      key: 'auth',
      label: 'Service d\'authentification',
      container: 'resilience-auth',
      health: 'http://auth-service:3001/health'
    }
  ],

  // Nombre de ticks consecutifs en echec (sante ou conteneur arrete) avant
  // de declencher une action. Evite de reagir a un faux positif isole.
  failThreshold: Number(process.env.FAIL_THRESHOLD || 3),

  // Fenetre de verification de la reprise apres une action
  verifyTimeoutMs: Number(process.env.VERIFY_TIMEOUT_MS || 40000),
  verifyIntervalMs: 1500,

  // Garde-fou anti-boucle : au-dela, on cesse d'agir et on escalade (humain)
  maxActionsPerWindow: Number(process.env.MAX_ACTIONS_PER_WINDOW || 3),
  actionWindowMs: Number(process.env.ACTION_WINDOW_MS || 600000),

  // Delai de stabilite avant de relever la limite de debit du WAF
  wafCooldownMs: Number(process.env.WAF_COOLDOWN_MS || 30000),
  wafContainer: 'resilience-waf',

  // Detecteur ML (anomalie sur les metriques). Optionnel : si injoignable,
  // le moteur fonctionne sur la sante et l'etat des conteneurs seuls.
  mlStatusUrl: process.env.ML_STATUS_URL || 'http://ml-detector:8000/status',

  httpTimeoutMs: 2500
};
