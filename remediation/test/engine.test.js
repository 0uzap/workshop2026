const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../src/engine');

// Horloge controlable
let clock = 0;
const now = () => clock;
const advance = (ms) => { clock += ms; };

const noopMetrics = () => ({
  setState: () => {},
  targetUp: { set: () => {} },
  incidents: { inc: () => {} },
  actions: { inc: () => {} },
  recoverySeconds: { observe: () => {} }
});

// Construit un moteur sur un "monde" mutable partage avec le test
const build = (world) => {
  const events = [];
  const calls = [];
  let wafOn = false;

  const docker = {
    inspect: async (name) => ({
      exists: true,
      running: world[name].running,
      health: world[name].health || null
    })
  };

  const probes = {
    health: async (def) => ({ ok: world[def.container].running && world[def.container].healthOk !== false }),
    canary: async (def) => ({ ok: world[def.container].canaryOk !== false }),
    mlStatus: async () => world.ml || null
  };

  const actions = {
    recoverContainer: async (def) => {
      calls.push('recover:' + def.container);
      // Le redemarrage repare le conteneur (sauf si le test l'interdit)
      if (!world[def.container].unfixable) {
        world[def.container] = { running: true, healthOk: true, canaryOk: true, health: 'healthy' };
      }
      return 'restart';
    },
    enableWafRateLimit: async () => { calls.push('waf_on'); wafOn = true; return true; },
    disableWafRateLimit: async () => { calls.push('waf_off'); wafOn = false; return true; },
    isWafLimited: () => wafOn
  };

  const config = {
    targets: [{ key: 'backend', label: 'API', container: 'resilience-backend',
      health: 'h', canary: 'c', business: true }],
    failThreshold: 2,
    verifyTimeoutMs: 10,
    maxActionsPerWindow: 3,
    actionWindowMs: 600000,
    wafCooldownMs: 5
  };

  const engine = createEngine({
    docker, probes, actions, metrics: noopMetrics(),
    log: (e, f) => events.push({ e, f }), config, now
  });

  return { engine, events, calls, world, wafState: () => wafOn };
};

const BACKEND = 'resilience-backend';

test('conteneur tombe -> redemarrage apres le seuil -> incident rétabli', async () => {
  const t = build({ [BACKEND]: { running: false } });

  await t.engine.tick(); // 1er echec
  assert.deepStrictEqual(t.calls, [], 'pas d\'action avant le seuil');

  await t.engine.tick(); // 2e echec => seuil atteint => action
  assert.ok(t.calls.includes('recover:' + BACKEND), 'le conteneur est redemarre');

  advance(20);
  await t.engine.tick(); // phase verifying => recupere
  const snap = t.engine.snapshot();
  assert.strictEqual(snap.targets[0].state, 'healthy');
  assert.strictEqual(snap.history[0].outcome, 'recovered');
  assert.ok(snap.history[0].durationMs >= 0);
});

test('surcharge detectee par le ML -> limite de debit WAF -> rétabli', async () => {
  const t = build({
    [BACKEND]: { running: true, healthOk: true, canaryOk: true, health: 'healthy' },
    ml: { anomaly: true, target: 'backend', reason: 'flood', score: 0.9 }
  });

  await t.engine.tick();
  await t.engine.tick(); // seuil => action overload
  assert.ok(t.calls.includes('waf_on'), 'la limite de debit WAF est activee');
  assert.ok(!t.calls.includes('recover:' + BACKEND), 'pas de redemarrage au 1er coup sur une surcharge');

  // L'anomalie disparait (flood absorbe)
  t.world.ml = { anomaly: false };
  advance(20);
  await t.engine.tick();
  assert.strictEqual(t.engine.snapshot().history[0].outcome, 'recovered');
});

test('canari KO maintient en verification (preuve metier exigee)', async () => {
  const t = build({ [BACKEND]: { running: false } });
  // Le redemarrage remet le conteneur mais le canari echoue encore
  t.world[BACKEND] = { running: false, unfixable: false };
  const orig = t.world[BACKEND];

  await t.engine.tick();
  await t.engine.tick(); // action
  // Force : conteneur up + health ok mais canari KO
  t.world[BACKEND] = { running: true, healthOk: true, canaryOk: false, health: 'healthy' };
  advance(5);
  await t.engine.tick();
  assert.strictEqual(t.engine.snapshot().targets[0].state, 'verifying', 'reste en verification tant que le canari echoue');
});

test('echecs repetes -> escalade apres epuisement du budget d\'actions', async () => {
  const t = build({ [BACKEND]: { running: false, unfixable: true } }); // redemarrage sans effet

  for (let i = 0; i < 12; i++) { await t.engine.tick(); advance(20); }

  const snap = t.engine.snapshot();
  assert.strictEqual(snap.targets[0].state, 'escalated');
  assert.ok(snap.history.some((h) => h.outcome === 'escalated'));
});
