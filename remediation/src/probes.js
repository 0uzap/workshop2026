const config = require('./config');

// Appels HTTP courts, sans jamais lever : renvoie { ok, status } ou { ok:false }.
const probe = async (url, headers = {}) => {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(config.httpTimeoutMs)
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
};

const health = (target) => probe(target.health);

// Canari metier : prouve que le chemin d'ecriture (transaction) fonctionne
const canary = (target) =>
  probe(target.canary, { 'X-Internal-Token': process.env.REMEDIATION_TOKEN || '' });

// Etat du detecteur ML : { anomaly, target, reason, score } ou null si injoignable
const mlStatus = async () => {
  const res = await probe(config.mlStatusUrl);
  return res.ok ? res.body : null;
};

module.exports = { health, canary, mlStatus };
