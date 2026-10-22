const path = require('path');
const express = require('express');
const { register } = require('./metrics');

// Interface de supervision + API d'etat, pour le jury et pour le reste de la stack.
const createServer = (engine) => {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'remediation' }));

  // Etat courant du moteur (consomme par le tableau de bord)
  app.get('/status', (req, res) => res.set('Cache-Control', 'no-store').json(engine.snapshot()));

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.use('/', express.static(path.join(__dirname, '..', 'public')));

  return app;
};

module.exports = { createServer };
