// Règles de la consigne additionnelle 1, vérifiées sur la machine d'états du
// poste avec une caméra, une base, un face-service et une LED simulés.

const test = require('node:test');
const assert = require('node:assert');
const { unitVector, jitter } = require('./helpers');
const matcher = require('../src/security/faceMatcher');
const { createTerminal, TerminalError } = require('../src/terminal/createTerminal');

const TEMPLATE = unitVector(1);
const ALICE = { id: 1, username: 'alice', role: 'admin' };

const FACES = {
  aliceFront: { ok: true, embedding: jitter(TEMPLATE, 0.3, 1), yaw_ratio: 0.5 },
  aliceLeft: { ok: true, embedding: jitter(TEMPLATE, 0.5, 2), yaw_ratio: 0.78 },
  aliceRight: { ok: true, embedding: jitter(TEMPLATE, 0.5, 3), yaw_ratio: 0.22 },
  stranger: { ok: true, embedding: unitVector(9), yaw_ratio: 0.5 },
  noFace: { ok: false, reason: 'no_face' }
};

class CameraDown extends Error {}

const setup = ({ frames = () => FACES.noFace, identities = { alice: ALICE } } = {}) => {
  const events = [];
  const ledModes = [];
  const camera = { on: false, starts: 0 };
  const failures = new Map();
  const locks = new Map();
  let direction = null;

  const terminal = createTerminal({
    camera: {
      start: async () => { camera.on = true; camera.starts++; },
      stop: async () => { camera.on = false; },
      frame: async () => Buffer.from('jpeg')
    },
    // La séquence d'images dépend de la direction tirée par le serveur
    analyzeFrame: async () => frames(direction),
    loadIdentity: async (username) =>
      identities[username] ? { user: identities[username], template: TEMPLATE } : null,
    guard: {
      status: async (u) => ({ lockedUntil: locks.get(u) || null }),
      failure: async (u) => {
        const n = (failures.get(u) || 0) + 1;
        if (n >= 2) {
          locks.set(u, new Date(Date.now() + 300_000));
          failures.set(u, 0);
        } else {
          failures.set(u, n);
        }
        return { lockedUntil: locks.get(u) || null };
      },
      reset: async (u) => { failures.delete(u); locks.delete(u); }
    },
    verifyPassword: async (user, password) => password === 'bon-mot-de-passe',
    led: { set: (mode) => ledModes.push(mode) },
    audit: (event) => events.push(event),
    matcher,
    isInfrastructureError: (error) => error instanceof CameraDown,
    timings: {
      verifyWindowMs: 150,
      rejectCooldownMs: 60,
      passwordTimeoutMs: 1000,
      enrollTimeoutMs: 1000,
      registerTimeoutMs: 1000,
      frameIntervalMs: 2,
      enrollFrameIntervalMs: 1
    }
  });

  const identify = async (username) => {
    const res = await terminal.identify(username);
    direction = res.direction;
    return res;
  };

  return { terminal, identify, camera, events, ledModes, locks, failures };
};

const waitForPhase = async (terminal, id, phase, timeout = 1000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const s = terminal.state(id);
    if (s?.phase === phase) return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`phase ${phase} jamais atteinte (actuelle : ${terminal.state(id)?.phase})`);
};

// La vraie personne : de face, puis tête tournée dans la direction demandée
const realPerson = () => {
  let n = 0;
  return (direction) => {
    n++;
    if (n < 3) return FACES.aliceFront;
    return direction === 'left' ? FACES.aliceLeft : FACES.aliceRight;
  };
};

test('visage reconnu : caméra éteinte, LED verte clignotante, puis accès avec le bon mot de passe', async () => {
  const t = setup({ frames: realPerson() });
  const { session_id: id } = await t.identify('alice');
  assert.strictEqual(t.camera.on, true);

  await waitForPhase(t.terminal, id, 'awaiting_password');
  assert.strictEqual(t.camera.on, false);
  assert.deepStrictEqual(t.ledModes, ['green_blink']);

  const user = await t.terminal.submitPassword(id, 'bon-mot-de-passe');
  assert.strictEqual(user.id, ALICE.id);
  assert.deepStrictEqual(t.ledModes, ['green_blink', 'green_on']);
  assert.strictEqual(t.terminal.state(id), null);
});

test('visage non reconnu : LED rouge fixe, caméra allumée pendant le délai puis éteinte', async () => {
  const t = setup({ frames: () => FACES.stranger });
  const { session_id: id } = await t.identify('alice');

  await waitForPhase(t.terminal, id, 'rejected');
  assert.deepStrictEqual(t.ledModes, ['red_on']);
  assert.strictEqual(t.camera.on, true);

  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(t.camera.on, false);
  assert.strictEqual(t.terminal.state(id), null);
});

test('photo immobile (pas de rotation de tête) : refusée', async () => {
  const t = setup({ frames: () => FACES.aliceFront });
  const { session_id: id } = await t.identify('alice');
  await waitForPhase(t.terminal, id, 'rejected');
});

test('mot de passe faux : LED rouge clignotante et retour à l\'identifiant', async () => {
  const t = setup({ frames: realPerson() });
  const { session_id: id } = await t.identify('alice');
  await waitForPhase(t.terminal, id, 'awaiting_password');

  await assert.rejects(
    t.terminal.submitPassword(id, 'mauvais'),
    (e) => e instanceof TerminalError && e.status === 401 && e.extra.restart === true
  );
  assert.deepStrictEqual(t.ledModes, ['green_blink', 'red_blink']);
  assert.strictEqual(t.terminal.state(id), null);
});

test('une seule nouvelle tentative, puis identifiant bloqué 5 minutes sans allumer la caméra', async () => {
  const t = setup({ frames: () => FACES.stranger });

  for (let i = 0; i < 2; i++) {
    const { session_id: id } = await t.identify('alice');
    await waitForPhase(t.terminal, id, 'rejected');
    await new Promise((r) => setTimeout(r, 100));
  }

  const starts = t.camera.starts;
  await assert.rejects(t.identify('alice'), (e) => e.status === 423 && Boolean(e.extra.locked_until));
  assert.strictEqual(t.camera.starts, starts);
});

test('identifiant inconnu : même déroulé qu\'un visage non reconnu (pas d\'énumération)', async () => {
  const t = setup({ frames: realPerson() });
  const { session_id: id } = await t.identify('mallory');
  assert.strictEqual(t.camera.on, true);
  await waitForPhase(t.terminal, id, 'rejected');
  assert.ok(t.events.includes('terminal.face.rejected'));
});

test('un seul poste : deuxième identification refusée tant que la première est en cours', async () => {
  const t = setup({ frames: () => FACES.noFace });
  await t.identify('alice');
  await assert.rejects(t.identify('bob'), (e) => e.status === 409);
});

test('mot de passe impossible avant la reconnaissance du visage', async () => {
  const t = setup({ frames: () => FACES.noFace });
  const { session_id: id } = await t.identify('alice');
  await assert.rejects(t.terminal.submitPassword(id, 'bon-mot-de-passe'), (e) => e.status === 401);
});

test('panne caméra pendant l\'analyse : erreur signalée, pas comptée comme échec', async () => {
  const t = setup({ frames: () => { throw new CameraDown('agent down'); } });
  const { session_id: id } = await t.identify('alice');
  await waitForPhase(t.terminal, id, 'error');
  assert.strictEqual(t.camera.on, false);
  assert.strictEqual(t.failures.size + t.locks.size, 0);
});

test('enrôlement : réservé à l\'administrateur qui l\'a lancé', async () => {
  const t = setup({ frames: () => FACES.aliceFront });
  const { session_id: id } = await t.terminal.startEnrollment(5, ALICE.id);

  await assert.rejects(t.terminal.captureEnrollment(id, 999), (e) => e.status === 404);

  const result = await t.terminal.captureEnrollment(id, ALICE.id);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.targetUserId, 5);
  assert.strictEqual(t.camera.on, false);
});

test('création de compte : gabarit capturé par la caméra du poste, identifiant conservé', async () => {
  const t = setup({ frames: () => FACES.aliceFront });
  const { session_id: id } = await t.terminal.startRegistration('  Bob.Martin ');
  assert.strictEqual(t.camera.on, true);
  assert.ok(await t.terminal.frame(id), 'retour caméra disponible pendant la création');

  const result = await t.terminal.captureRegistration(id);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.username, 'Bob.Martin');
  assert.strictEqual(result.template.length, 128);
  assert.strictEqual(t.camera.on, false);

  // Session consommée : pas de seconde capture
  await assert.rejects(t.terminal.captureRegistration(id), (e) => e.status === 404);
});

test('création de compte : image inexploitable, nouvel essai possible sur la même session', async () => {
  let n = 0;
  const t = setup({ frames: () => (n++ < 1 ? FACES.noFace : FACES.aliceFront) });
  const { session_id: id } = await t.terminal.startRegistration('bob');

  const first = await t.terminal.captureRegistration(id);
  assert.deepStrictEqual([first.ok, first.reason], [false, 'no_face']);
  assert.strictEqual(t.camera.on, true);

  assert.strictEqual((await t.terminal.captureRegistration(id)).ok, true);
});

test('création de compte annulée : caméra éteinte et poste libéré', async () => {
  const t = setup();
  const { session_id: id } = await t.terminal.startRegistration('bob');
  assert.strictEqual(await t.terminal.cancel(id), true);
  assert.strictEqual(t.camera.on, false);
  await t.terminal.startRegistration('carol');
});

test('annulation impossible pendant l\'analyse du visage (pas d\'esquive du blocage)', async () => {
  const t = setup({ frames: () => FACES.noFace });
  const { session_id: id } = await t.identify('alice');
  assert.strictEqual(await t.terminal.cancel(id), false);
});
