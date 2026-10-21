const pool = require('./database');

// Tables créées au démarrage si absentes (volume MySQL existant compris).
const statements = [
  `CREATE TABLE IF NOT EXISTS face_templates (
    user_id BIGINT NOT NULL PRIMARY KEY,
    template_enc VARBINARY(600) NOT NULL,
    consent_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS login_guard (
    username VARCHAR(100) NOT NULL PRIMARY KEY,
    failures INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_events (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    event VARCHAR(64) NOT NULL,
    username VARCHAR(100) NULL,
    user_id BIGINT NULL,
    actor_id BIGINT NULL,
    ip VARCHAR(64) NULL,
    detail JSON NULL,
    INDEX idx_auth_events_ts (ts)
  )`
];

// Colonnes ajoutées aux tables métier existantes
const columns = [
  ['users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1']
];

const addMissingColumns = async () => {
  for (const [table, column, definition] of columns) {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (rows.length === 0) {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
  }
};

const ensureSchema = async (retries = 10) => {
  for (let attempt = 1; ; attempt++) {
    try {
      for (const sql of statements) {
        await pool.query(sql);
      }
      await addMissingColumns();
      return;
    } catch (error) {
      if (attempt >= retries) throw error;
      console.error(`Schéma non initialisé (tentative ${attempt}) : ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
};

module.exports = { ensureSchema };
