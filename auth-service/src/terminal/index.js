const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const camera = require('../services/cameraAgent');
const led = require('../iot/led');
const guard = require('./guard');
const matcher = require('../security/faceMatcher');
const { analyzeFace, FaceServiceUnavailable } = require('../services/faceClient');
const { decryptTemplate } = require('../security/templateCrypto');
const { can } = require('../security/permissions');
const { auditEvent } = require('../services/audit');
const { createTerminal } = require('./createTerminal');

// Identité candidate : compte actif, habilité au back-office, visage enrôlé.
// Sinon null, et l'identification échouera comme un visage non reconnu.
const loadIdentity = async (username) => {
  const [rows] = await pool.query(
    `SELECT u.*, f.template_enc
     FROM users u JOIN face_templates f ON f.user_id = u.id
     WHERE u.username = ?`,
    [username]
  );

  const user = rows[0];
  if (!user || !user.is_active || !can(user.role, 'backoffice:access')) return null;

  const { template_enc: templateEnc, ...rest } = user;
  return { user: rest, template: decryptTemplate(user.id, templateEnc) };
};

const analyzeFrame = async () =>
  analyzeFace((await camera.frame()).toString('base64'));

const terminal = createTerminal({
  camera,
  analyzeFrame,
  loadIdentity,
  guard,
  led,
  matcher,
  verifyPassword: (user, password) => bcrypt.compare(password, user.password_hash),
  audit: auditEvent,
  isInfrastructureError: (error) =>
    error instanceof camera.CameraUnavailable || error instanceof FaceServiceUnavailable,
  timings: {
    verifyWindowMs: Number(process.env.TERMINAL_VERIFY_WINDOW_MS || 15_000),
    rejectCooldownMs: 30_000,
    passwordTimeoutMs: 120_000,
    enrollTimeoutMs: 120_000,
    frameIntervalMs: 150,
    enrollFrameIntervalMs: 400
  }
});

module.exports = terminal;
