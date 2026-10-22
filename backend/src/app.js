
require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const pool = require('./config/database');
const paymentRoutes = require('./routes/paymentRoutes');

const {
  metricsMiddleware,
  register
} = require('./middlewares/metricsMiddleware');

const app = express();

app.use(cors());
app.use(express.json());

// Surveillance des requêtes HTTP
app.use(metricsMiddleware);

// Routes de paiement
app.use('/api/payments', paymentRoutes);

// Vérification de santé
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      status: 'healthy',
      service: 'payment-api',
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'payment-api',
      database: 'disconnected'
    });
  }
});

// Canari interne : prouve que le chemin d'écriture métier fonctionne de bout
// en bout (connexion + transaction + insert) sans rien laisser en base, grâce
// à un ROLLBACK. Utilisé par le moteur de remédiation pour vérifier que le
// service de paiement est réellement rétabli après un incident.
// Protégé par un jeton interne ; jamais exposé au réseau pédagogique.
const REMEDIATION_TOKEN = process.env.REMEDIATION_TOKEN || '';

app.get('/internal/canary', async (req, res) => {
  const provided = req.get('x-internal-token') || '';
  if (
    REMEDIATION_TOKEN.length < 16 ||
    provided.length !== REMEDIATION_TOKEN.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(REMEDIATION_TOKEN))
  ) {
    return res.status(401).json({ ok: false });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO payments (transaction_id, amount, currency, status)
       VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), 0.01, 'EUR', 'CANARY']
    );
    // On annule : le canari ne doit rien laisser en base
    await connection.rollback();
    res.json({ ok: true, checked_at: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, error: 'canary_failed' });
  } finally {
    connection.release();
  }
});

// Aucun endpoint /metrics sur le port public 3000.

const PORT = process.env.PORT || 3000;

const metricsApp = express();

metricsApp.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

metricsApp.listen(9091, '0.0.0.0', () => {
  console.log('Metrics endpoint running on internal port 9091');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Payment API running on port ${PORT}`);
});
