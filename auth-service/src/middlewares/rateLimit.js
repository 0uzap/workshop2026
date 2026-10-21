const rateLimit = require('express-rate-limit');

const limiter = (max, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message }
  });

// Freine le bourrage d'identifiants et la force brute sur l'étape faciale
const loginLimiter = limiter(20, 'Trop de tentatives de connexion, réessayez plus tard');
const faceLimiter = limiter(30, 'Trop de tentatives d\'authentification faciale, réessayez plus tard');

module.exports = { loginLimiter, faceLimiter };
