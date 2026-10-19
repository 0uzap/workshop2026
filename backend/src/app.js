
require('dotenv').config();

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
