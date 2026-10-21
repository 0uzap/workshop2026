const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { unitVector, jitter } = require('./helpers');

process.env.JWT_SECRET = 'test-secret-'.padEnd(48, 'x');
process.env.FACE_TEMPLATE_KEY = crypto.randomBytes(32).toString('hex');

const tokens = require('../src/security/tokens');
const { can } = require('../src/security/permissions');
const { encryptTemplate, decryptTemplate } = require('../src/security/templateCrypto');
const { matchesFrontal, matchesTurned, buildTemplate } = require('../src/security/faceMatcher');

test('le jeton d\'accès porte les facteurs d\'authentification', () => {
  const token = tokens.signAccessToken({ id: 42, role: 'admin' }, ['face', 'pwd']);
  const claims = tokens.verifyAccessToken(token);
  assert.deepStrictEqual(claims.amr, ['face', 'pwd']);
  assert.strictEqual(claims.aud, 'resilience-api');
});

test('habilitations : seuls les rôles du back-office y accèdent', () => {
  assert.ok(can('admin', 'faces:manage'));
  assert.ok(can('operator', 'backoffice:access'));
  assert.ok(!can('operator', 'users:write'));
  assert.ok(!can('auditor', 'faces:manage'));
  assert.ok(!can('user', 'backoffice:access'));
  assert.ok(!can('inconnu', 'backoffice:access'));
});

test('le gabarit chiffré se déchiffre pour le bon utilisateur uniquement', () => {
  const template = unitVector(1);
  const blob = encryptTemplate(7, template);

  assert.strictEqual(blob.length, 12 + 16 + 512);
  const decrypted = decryptTemplate(7, blob);
  decrypted.forEach((x, i) => assert.ok(Math.abs(x - template[i]) < 1e-6));

  // Gabarit recopié sur un autre compte : rejet par l'authentification GCM
  assert.throws(() => decryptTemplate(8, blob));
});

test('visage de face : même personne acceptée, autre personne refusée', () => {
  const template = unitVector(1);
  assert.ok(matchesFrontal(template, { embedding: jitter(template, 0.3, 1), yaw_ratio: 0.52 }).ok);
  assert.ok(!matchesFrontal(template, { embedding: unitVector(2), yaw_ratio: 0.5 }).ok);
  // Bonne personne mais tête tournée : pas une image « de face »
  assert.ok(!matchesFrontal(template, { embedding: template, yaw_ratio: 0.8 }).ok);
});

test('rotation : direction imposée respectée', () => {
  const template = unitVector(1);
  const frontal = { embedding: jitter(template, 0.3, 1), yaw_ratio: 0.5 };
  const left = { embedding: jitter(template, 0.5, 2), yaw_ratio: 0.75 };

  assert.ok(matchesTurned(template, frontal, left, 'left').ok);
  assert.ok(!matchesTurned(template, frontal, left, 'right').ok);
  // Photo immobile : aucune rotation
  assert.ok(!matchesTurned(template, frontal, frontal, 'left').ok);
});

test('enrôlement : images cohérentes moyennées, incohérentes refusées', () => {
  const base = unitVector(3);
  const ok = buildTemplate([0.2, 0.3, 0.25].map((a, i) => ({
    embedding: jitter(base, a, i), yaw_ratio: 0.5
  })));
  assert.strictEqual(ok.ok, true);
  assert.ok(Math.abs(Math.hypot(...ok.template) - 1) < 1e-9);

  const mixed = buildTemplate([
    { embedding: unitVector(3), yaw_ratio: 0.5 },
    { embedding: unitVector(4), yaw_ratio: 0.5 },
    { embedding: unitVector(3), yaw_ratio: 0.5 }
  ]);
  assert.strictEqual(mixed.reason, 'enroll_inconsistent');
});
