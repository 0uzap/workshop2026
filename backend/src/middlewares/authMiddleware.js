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
        issuer: 'resilience-auth'
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

module.exports = authenticate;