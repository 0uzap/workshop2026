const config = require('./config');
const docker = require('./docker');
const probes = require('./probes');
const actions = require('./actions');
const metrics = require('./metrics');
const { log } = require('./log');
const { createEngine } = require('./engine');
const { createServer } = require('./server');

if (!process.env.REMEDIATION_TOKEN || process.env.REMEDIATION_TOKEN.length < 16) {
  throw new Error('REMEDIATION_TOKEN doit contenir au moins 16 caracteres');
}

const engine = createEngine({ docker, probes, actions, metrics, log, config });

// Boucle de surveillance : un tick toutes les config.tickMs, sans chevauchement
let running = true;
const loop = async () => {
  while (running) {
    const start = Date.now();
    try {
      await engine.tick();
    } catch (error) {
      log('remediation.tick.error', { detail: error.message });
    }
    const elapsed = Date.now() - start;
    await new Promise((r) => setTimeout(r, Math.max(0, config.tickMs - elapsed)));
  }
};

const PORT = Number(process.env.PORT || 8080);
createServer(engine).listen(PORT, '0.0.0.0', () => {
  log('remediation.started', { port: PORT, targets: config.targets.map((t) => t.key) });
  loop();
});

const shutdown = () => { running = false; process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
