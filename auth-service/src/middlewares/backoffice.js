const pool = require('../config/database');
const { verifyAccessToken } = require('../security/tokens');
const { can, permissionsOf } = require('../security/permissions');

/**
 * Accès au back-office : jeton obtenu via le poste d'authentification
 * (visage + mot de passe), compte toujours actif et permission requise.
 * Le compte est relu en base à chaque requête : une désactivation ou un
 * changement de rôle s'applique immédiatement, sans attendre l'expiration.
 */
const requireBackoffice = (permission = 'backoffice:access') => async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  let claims;
  try {
    claims = verifyAccessToken(authHeader.substring(7));
  } catch (error) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  const amr = claims.amr || [];
  if (!amr.includes('face') || !amr.includes('pwd')) {
    return res.status(403).json({ error: 'Authentification visage + mot de passe requise' });
  }

  try {
    const [users] = await pool.query(
      'SELECT id, username, role, is_active FROM users WHERE id = ?',
      [Number(claims.sub)]
    );
    const user = users[0];

    if (!user || !user.is_active || !can(user.role, 'backoffice:access')) {
      return res.status(403).json({ error: 'Compte désactivé ou non habilité' });
    }

    if (!can(user.role, permission)) {
      return res.status(403).json({ error: 'Permission insuffisante' });
    }

    req.user = user;
    req.permissions = permissionsOf(user.role);
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = requireBackoffice;
