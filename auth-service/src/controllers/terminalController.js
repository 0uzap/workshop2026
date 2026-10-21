const terminal = require('../terminal');
const { TerminalError } = require('../terminal/createTerminal');
const { signAccessToken } = require('../security/tokens');
const { authAttempts } = require('../metrics');

// La session du poste circule dans un en-tête dédié, jamais dans l'URL
const sessionId = (req) => req.get('x-terminal-session') || '';

const handleError = (res, error) => {
  if (error instanceof TerminalError) {
    return res.status(error.status).json({ error: error.message, ...error.extra });
  }
  console.error(error);
  res.status(500).json({ error: 'Erreur du poste d\'authentification' });
};

/** Étape 1 : saisie de l'identifiant, allumage de la caméra. */
const identify = async (req, res) => {
  const { username } = req.body || {};

  if (typeof username !== 'string' || username.trim().length < 1 || username.trim().length > 100) {
    return res.status(400).json({ error: 'Identifiant requis' });
  }

  try {
    res.json(await terminal.identify(username, {
      ip: req.ip,
      user_agent: (req.get('user-agent') || '').slice(0, 200)
    }));
  } catch (error) {
    handleError(res, error);
  }
};

/** Suivi de l'identification (sondé par le navigateur). */
const state = (req, res) => {
  const current = terminal.state(sessionId(req));
  if (!current) return res.status(404).json({ error: 'Session terminée' });
  res.json(current);
};

/** Image courante de la caméra du PC Hôte, pendant l'identification. */
const frame = async (req, res) => {
  try {
    const jpeg = await terminal.frame(sessionId(req));
    if (!jpeg) return res.status(404).end();
    res.set('Cache-Control', 'no-store').type('image/jpeg').send(jpeg);
  } catch (error) {
    res.status(503).end();
  }
};

/** Étape 2 : mot de passe, uniquement après reconnaissance du visage. */
const password = async (req, res) => {
  try {
    const user = await terminal.submitPassword(sessionId(req), req.body?.password);
    authAttempts.inc({ step: 'terminal', result: 'success' });

    res.json({
      message: 'Connexion réussie',
      token: signAccessToken(user, ['face', 'pwd']),
      token_type: 'Bearer',
      expires_in: 3600
    });
  } catch (error) {
    authAttempts.inc({ step: 'terminal', result: 'failure' });
    handleError(res, error);
  }
};

const cancel = async (req, res) => {
  await terminal.cancel(sessionId(req));
  res.status(204).end();
};

module.exports = { identify, state, frame, password, cancel, handleError };
