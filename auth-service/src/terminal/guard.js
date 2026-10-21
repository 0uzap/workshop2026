const pool = require('../config/database');

// Verrouillage par identifiant : l'utilisateur peut recommencer 1 fois,
// puis l'identifiant est bloqué 5 minutes (et ainsi de suite).
// Les identifiants inexistants sont traités de la même manière.

const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 2);
const LOCK_SECONDS = Number(process.env.LOGIN_LOCK_SECONDS || 300);

const status = async (username) => {
  const [rows] = await pool.query(
    'SELECT locked_until FROM login_guard WHERE username = ? AND locked_until > NOW()',
    [username]
  );
  return { lockedUntil: rows[0]?.locked_until || null };
};

const failure = async (username) => {
  await pool.query(
    `INSERT INTO login_guard (username, failures) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE failures = failures + 1`,
    [username]
  );

  // MySQL évalue les affectations de gauche à droite : verrouillage puis remise à zéro
  await pool.query(
    `UPDATE login_guard
     SET locked_until = NOW() + INTERVAL ? SECOND, failures = 0
     WHERE username = ? AND failures >= ?`,
    [LOCK_SECONDS, username, MAX_FAILURES]
  );

  return status(username);
};

const reset = (username) =>
  pool.query('DELETE FROM login_guard WHERE username = ?', [username]);

module.exports = { status, failure, reset };
