const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Token manquant'
    });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
      {
        algorithms: ['HS256'],
        issuer: 'resilience-auth',
        audience: 'resilience-api'
      }
    );

    req.user = decoded;
    next();

  } catch (error) {
    return res.status(401).json({
      error: 'Token invalide ou expiré'
    });
  }
};

// Politique d'authentification forte pour les opérations sensibles :
// si PAYMENT_REQUIRE_FACE=true, le jeton doit avoir été obtenu avec le visage.
const requireFaceForPayments = (req, res, next) => {
  if (process.env.PAYMENT_REQUIRE_FACE !== 'true') {
    return next();
  }

  if (!(req.user.amr || []).includes('face')) {
    return res.status(403).json({
      error: 'Authentification faciale requise pour effectuer un paiement'
    });
  }

  next();
};

module.exports = authenticate;
module.exports.requireFaceForPayments = requireFaceForPayments;