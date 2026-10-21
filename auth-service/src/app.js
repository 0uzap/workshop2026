require('dotenv').config();

const express = require('express');
const pool = require('./config/database');
const { ensureSchema } = require('./config/schema');
const authRoutes = require('./routes/authRoutes');
const terminalRoutes = require('./routes/terminalRoutes');
const adminRoutes = require('./routes/adminRoutes');
const iotRoutes = require('./routes/iotRoutes');
const { register } = require('./metrics');
const { getKey } = require('./security/templateCrypto');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET doit contenir au moins 32 caractères');
}

for (const name of ['FACE_SERVICE_TOKEN', 'CAMERA_AGENT_TOKEN', 'IOT_DEVICE_TOKEN']) {
  if (!process.env[name] || process.env[name].length < 32) {
    throw new Error(`${name} doit contenir au moins 32 caractères`);
  }
}

// Échoue au démarrage plutôt qu'à la première connexion si la clé est absente
getKey();

const app = express();

app.disable('x-powered-by');

// Derrière le reverse proxy du frontal : l'IP client vient de X-Forwarded-For
app.set('trust proxy', 1);

// Les images ne transitent plus par le navigateur : 10 ko suffisent partout
app.use(express.json({ limit: '10kb' }));

app.use('/api/auth/terminal', terminalRoutes);
app.use('/api/auth/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/iot', iotRoutes);

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      status: 'healthy',
      service: 'auth-service',
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'auth-service',
      database: 'disconnected'
    });
  }
});

const PORT = process.env.PORT || 3001;

// Aucun endpoint /metrics sur le port de l'API.
const metricsApp = express();

metricsApp.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const start = async () => {
  await ensureSchema();

  metricsApp.listen(9092, '0.0.0.0', () => {
    console.log('Metrics endpoint running on internal port 9092');
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Auth service running on port ${PORT}`);
  });
};

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
