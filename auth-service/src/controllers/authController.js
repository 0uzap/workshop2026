
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

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

    if (users.length === 0) {
      return res.status(401).json({
        error: 'Identifiants incorrects'
      });
    }

    const user = users[0];

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        error: 'Identifiants incorrects'
      });
    }

    const token = jwt.sign(
      {
        sub: String(user.id),
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: '1h',
        algorithm: 'HS256',
        issuer: 'resilience-auth'
      }
    );

    res.json({
      message: 'Connexion réussie',
      token,
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
