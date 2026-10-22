const rateLimit = require('express-rate-limit');

// Derriere le WAF et le frontal, toutes les requetes arrivent avec la meme
// adresse IP : compter par IP bloquerait TOUS les utilisateurs apres 20 essais.
// On compte donc par compte vise : username pour le login, session_id pour
// l'etape faciale. Le volume global d'une attaque est absorbe par la limite
// de debit du WAF, activee par le moteur de remediation pendant l'incident.
const accountKey = (req) => {
  const b = req.body || {};
  const id = b.username || b.session_id || b.email || '';
  return 'acct:' + String(id).trim().toLowerCase();
};

const limiter = (max, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: accountKey,
    message: { error: message }
  });

// Freine la force brute sur un meme compte, sans bloquer les autres utilisateurs
const loginLimiter = limiter(20, 'Trop de tentatives de connexion pour ce compte, réessayez plus tard');
const faceLimiter = limiter(30, 'Trop de tentatives d\'authentification faciale pour ce compte, réessayez plus tard');

module.exports = { loginLimiter, faceLimiter };