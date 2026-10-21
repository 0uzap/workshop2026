
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const audit = require('../services/audit');
const { authAttempts } = require('../metrics');
const { signAccessToken } = require('../security/tokens');
const { can } = require('../security/permissions');

// Hash factice : la comparaison est faite même si l'utilisateur n'existe pas,
// pour ne pas révéler les identifiants valides par le temps de réponse.
const DUMMY_HASH = bcrypt.hashSync('resilience-dummy-password', 12);

const register = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (
      typeof username !== 'string' ||
      username.trim().length < 3 ||
      username.trim().length > 100 ||
      typeof password !== 'string' ||
      password.length < 12 ||
      Buffer.byteLength(password, 'utf8') > 72
    ) {
      return res.status(400).json({
        error: 'Identifiant invalide ou mot de passe trop court (12 caractères minimum)'
      });
    }

    const normalizedUsername = username.trim();

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE username = ?',
      [normalizedUsername]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        error: 'Cet utilisateur existe déjà'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [normalizedUsername, passwordHash]
    );

    res.status(201).json({
      message: 'Utilisateur créé',
      id: result.insertId,
      username: normalizedUsername
    });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'Cet utilisateur existe déjà'
      });
    }

    console.error(error);
    res.status(500).json({
      error: 'Erreur lors de l’inscription'
    });
  }
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        error: 'Identifiant et mot de passe requis'
      });
    }

    const [users] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username.trim()]
    );

    const user = users[0];

    const validPassword = await bcrypt.compare(
      password,
      user ? user.password_hash : DUMMY_HASH
    );

    if (!user || !validPassword) {
      authAttempts.inc({ step: 'password', result: 'failure' });
      audit(req, 'auth.password.failure', { username: username.trim().slice(0, 100) });
      return res.status(401).json({
        error: 'Identifiants incorrects'
      });
    }

    // Les comptes du back-office passent obligatoirement par le poste
    // d'authentification (caméra du PC Hôte) : pas de mot de passe seul
    if (can(user.role, 'backoffice:access') || !user.is_active) {
      authAttempts.inc({ step: 'password', result: 'denied' });
      audit(req, 'auth.password.denied', { user_id: user.id, role: user.role });
      return res.status(403).json({
        error: 'Ce compte doit se connecter via le poste d\'authentification du back-office'
      });
    }

    authAttempts.inc({ step: 'password', result: 'success' });
    audit(req, 'auth.login.success', { user_id: user.id, amr: ['pwd'] });

    res.json({
      message: 'Connexion réussie',
      token: signAccessToken(user, ['pwd']),
      token_type: 'Bearer',
      expires_in: 3600
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Erreur lors de la connexion'
    });
  }
};

module.exports = { register, login };
