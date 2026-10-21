const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const audit = require('../services/audit');
const terminal = require('../terminal');
const camera = require('../services/cameraAgent');
const led = require('../iot/led');
const { handleError } = require('./terminalController');
const { encryptTemplate } = require('../security/templateCrypto');
const { ROLES } = require('../security/permissions');

const QUALITY_MESSAGES = {
  no_face: 'Aucun visage détecté',
  multiple_faces: 'Plusieurs visages détectés : une seule personne devant la caméra',
  face_too_small: 'Visage trop éloigné de la caméra',
  too_blurry: 'Image trop floue',
  low_confidence: 'Visage mal éclairé ou partiellement masqué',
  enroll_not_frontal: 'Regardez la caméra de face',
  enroll_inconsistent: 'Images incohérentes, restez immobile et recommencez'
};

const isValidPassword = (password) =>
  typeof password === 'string' &&
  password.length >= 12 &&
  Buffer.byteLength(password, 'utf8') <= 72;

const fail = (res, error) => {
  console.error(error);
  res.status(500).json({ error: 'Erreur du back-office' });
};

// Empêche de retirer le dernier administrateur actif (back-office orphelin)
const isLastActiveAdmin = async (userId) => {
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE role = \'admin\' AND is_active = 1'
  );
  return rows.length === 1 && rows[0].id === userId;
};

const me = (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    permissions: req.permissions
  });
};

const listUsers = async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.username, u.role, u.is_active, u.created_at,
              f.updated_at AS face_enrolled_at,
              IF(g.locked_until > NOW(), g.locked_until, NULL) AS locked_until
       FROM users u
       LEFT JOIN face_templates f ON f.user_id = u.id
       LEFT JOIN login_guard g ON g.username = LOWER(u.username)
       ORDER BY u.id`
    );
    res.json({ users, roles: ROLES });
  } catch (error) {
    fail(res, error);
  }
};

const createUser = async (req, res) => {
  const { username, password, role } = req.body || {};

  if (
    typeof username !== 'string' ||
    username.trim().length < 3 ||
    username.trim().length > 100 ||
    !isValidPassword(password) ||
    !ROLES.includes(role)
  ) {
    return res.status(400).json({
      error: 'Identifiant (3 caractères min.), mot de passe (12 caractères min.) et rôle valides requis'
    });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username.trim(), await bcrypt.hash(password, 12), role]
    );

    audit(req, 'admin.user.created', {
      actor_id: req.user.id,
      user_id: result.insertId,
      username: username.trim(),
      role
    });

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Cet utilisateur existe déjà' });
    }
    fail(res, error);
  }
};

const updateUser = async (req, res) => {
  const userId = Number(req.params.id);
  const { role, is_active: isActive, password } = req.body || {};
  const changes = [];
  const values = [];

  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rôle inconnu' });
    changes.push('role = ?');
    values.push(role);
  }

  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'is_active invalide' });
    changes.push('is_active = ?');
    values.push(isActive ? 1 : 0);
  }

  if (password !== undefined) {
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'Mot de passe trop court (12 caractères minimum)' });
    }
    changes.push('password_hash = ?');
    values.push(await bcrypt.hash(password, 12));
  }

  if (changes.length === 0) return res.status(400).json({ error: 'Aucune modification' });

  try {
    const demoting = (role !== undefined && role !== 'admin') || isActive === false;
    if (demoting && await isLastActiveAdmin(userId)) {
      return res.status(409).json({ error: 'Impossible de retirer le dernier administrateur actif' });
    }

    const [result] = await pool.query(
      `UPDATE users SET ${changes.join(', ')} WHERE id = ?`,
      [...values, userId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });

    audit(req, 'admin.user.updated', {
      actor_id: req.user.id,
      user_id: userId,
      role,
      is_active: isActive,
      password_changed: password !== undefined
    });

    res.json({ message: 'Utilisateur mis à jour' });
  } catch (error) {
    fail(res, error);
  }
};

const unlockUser = async (req, res) => {
  try {
    const [[user]] = await pool.query('SELECT username FROM users WHERE id = ?', [Number(req.params.id)]);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    await pool.query('DELETE FROM login_guard WHERE username = ?', [user.username.toLowerCase()]);
    audit(req, 'admin.user.unlocked', { actor_id: req.user.id, user_id: Number(req.params.id) });
    res.json({ message: 'Identifiant débloqué' });
  } catch (error) {
    fail(res, error);
  }
};

// ------------------------------------------------------------ visages

/** Allume la caméra du poste pour enrôler l'utilisateur présent devant elle. */
const startFaceEnrollment = async (req, res) => {
  const userId = Number(req.params.id);

  try {
    const [[user]] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    res.json(await terminal.startEnrollment(userId, req.user.id));
  } catch (error) {
    handleError(res, error);
  }
};

const captureFace = async (req, res) => {
  const { session_id: sessionId, consent } = req.body || {};

  if (consent !== true) {
    return res.status(400).json({
      error: 'Le consentement de la personne au traitement biométrique est requis'
    });
  }

  try {
    const result = await terminal.captureEnrollment(String(sessionId || ''), req.user.id);

    if (!result.ok) {
      return res.status(422).json({
        error: QUALITY_MESSAGES[result.reason] || 'Image inexploitable',
        reason: result.reason
      });
    }

    await pool.query(
      `INSERT INTO face_templates (user_id, template_enc, consent_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE template_enc = VALUES(template_enc), consent_at = NOW()`,
      [result.targetUserId, encryptTemplate(result.targetUserId, result.template)]
    );

    audit(req, 'admin.face.enrolled', { actor_id: req.user.id, user_id: result.targetUserId });
    res.status(201).json({ message: 'Visage enrôlé' });
  } catch (error) {
    handleError(res, error);
  }
};

const cancelFaceEnrollment = async (req, res) => {
  try {
    await terminal.cancelEnrollment(String(req.body?.session_id || ''), req.user.id);
    res.status(204).end();
  } catch (error) {
    handleError(res, error);
  }
};

const enrollmentFrame = async (req, res) => {
  try {
    const jpeg = await terminal.frame(req.get('x-terminal-session') || '', req.user.id);
    if (!jpeg) return res.status(404).end();
    res.set('Cache-Control', 'no-store').type('image/jpeg').send(jpeg);
  } catch (error) {
    res.status(503).end();
  }
};

/** Droit à l'effacement : suppression du gabarit biométrique. */
const deleteFace = async (req, res) => {
  const userId = Number(req.params.id);

  try {
    await pool.query('DELETE FROM face_templates WHERE user_id = ?', [userId]);
    audit(req, 'admin.face.deleted', { actor_id: req.user.id, user_id: userId });
    res.json({ message: 'Données biométriques supprimées' });
  } catch (error) {
    fail(res, error);
  }
};

// ------------------------------------------------------------ supervision

const listAudit = async (req, res) => {
  try {
    const [events] = await pool.query(
      `SELECT id, ts, event, username, user_id, actor_id, ip, detail
       FROM auth_events ORDER BY id DESC LIMIT 200`
    );
    res.json({ events });
  } catch (error) {
    fail(res, error);
  }
};

const terminalStatus = async (req, res) => {
  res.json({
    terminal: terminal.overview(),
    camera_agent: await camera.health(),
    led: led.status()
  });
};

module.exports = {
  me,
  listUsers,
  createUser,
  updateUser,
  unlockUser,
  startFaceEnrollment,
  captureFace,
  cancelFaceEnrollment,
  enrollmentFrame,
  deleteFace,
  listAudit,
  terminalStatus
};
