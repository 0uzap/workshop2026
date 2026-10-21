/**
 * Création du premier administrateur du back-office, avec enrôlement de son
 * visage par la caméra du PC Hôte. Sans lui, personne ne pourrait se
 * connecter au back-office pour enrôler les autres comptes.
 *
 *   docker exec -it resilience-auth node src/cli/bootstrap-admin.js
 *
 * Refuse de s'exécuter si un administrateur actif avec visage existe déjà :
 * la suite se fait depuis le back-office.
 */

const readline = require('readline');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const camera = require('../services/cameraAgent');
const { ensureSchema } = require('../config/schema');
const { analyzeFace } = require('../services/faceClient');
const { buildTemplate } = require('../security/faceMatcher');
const { encryptTemplate } = require('../security/templateCrypto');
const { auditEvent } = require('../services/audit');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ask = (question, hidden = false) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  if (hidden) {
    // Masque la saisie du mot de passe
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) rl.output.write(question);
    };
  }

  rl.question(question, (answer) => {
    rl.close();
    if (hidden) process.stdout.write('\n');
    resolve(answer.trim());
  });
});

const captureTemplate = async () => {
  await camera.start();

  try {
    for (let s = 3; s > 0; s--) {
      process.stdout.write(`  Regardez la caméra de face… ${s}\r`);
      await sleep(1000);
    }
    process.stdout.write('\n');

    const analyses = [];
    for (let i = 0; i < 3; i++) {
      const analysis = await analyzeFace((await camera.frame()).toString('base64'));
      if (!analysis.ok) throw new Error(`Image refusée : ${analysis.reason}`);
      analyses.push(analysis);
      await sleep(400);
    }

    const result = buildTemplate(analyses);
    if (!result.ok) throw new Error(`Enrôlement refusé : ${result.reason}`);
    return result.template;
  } finally {
    await camera.stop();
  }
};

const main = async () => {
  await ensureSchema(1);

  const [admins] = await pool.query(
    `SELECT u.id FROM users u JOIN face_templates f ON f.user_id = u.id
     WHERE u.role = 'admin' AND u.is_active = 1`
  );
  if (admins.length > 0) {
    throw new Error('Un administrateur avec visage existe déjà : utilisez le back-office');
  }

  console.log('Création du premier administrateur du back-office\n');

  const username = await ask('Identifiant : ');
  if (username.length < 3 || username.length > 100) throw new Error('Identifiant invalide');

  const password = await ask('Mot de passe (12 caractères min.) : ', true);
  if (password.length < 12 || Buffer.byteLength(password) > 72) {
    throw new Error('Mot de passe invalide');
  }
  if (await ask('Confirmation : ', true) !== password) {
    throw new Error('Les mots de passe ne correspondent pas');
  }

  const consent = await ask('La personne consent-elle à l\'enregistrement de son gabarit facial ? (oui/non) : ');
  if (consent.toLowerCase() !== 'oui') throw new Error('Consentement requis');

  console.log('\nPlacez-vous seul devant la caméra USB du PC Hôte.');
  const template = await captureTemplate();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT id FROM users WHERE username = ?', [username]);
    const hash = await bcrypt.hash(password, 12);
    let userId;

    if (existing.length > 0) {
      userId = existing[0].id;
      await connection.query(
        'UPDATE users SET password_hash = ?, role = \'admin\', is_active = 1 WHERE id = ?',
        [hash, userId]
      );
    } else {
      const [result] = await connection.query(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, \'admin\')',
        [username, hash]
      );
      userId = result.insertId;
    }

    await connection.query(
      `INSERT INTO face_templates (user_id, template_enc, consent_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE template_enc = VALUES(template_enc), consent_at = NOW()`,
      [userId, encryptTemplate(userId, template)]
    );

    await connection.commit();
    auditEvent('admin.bootstrap', { user_id: userId, username });
    console.log(`\nAdministrateur « ${username} » créé et visage enrôlé.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

main()
  .catch((error) => {
    console.error(`\nÉchec : ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 200));
