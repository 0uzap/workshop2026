
const { randomUUID } = require('crypto');
const pool = require('../config/database');

const getPayments = async (req, res) => {
  try {
    const [payments] = await pool.query(
      'SELECT * FROM payments ORDER BY created_at DESC'
    );

    res.json(payments);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des paiements'
    });
  }
};

const createPayment = async (req, res) => {
  try {
    const { amount, currency = 'EUR' } = req.body;

    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(amount * 100) ||
      currency !== 'EUR'
    ) {
      return res.status(400).json({
        error: 'Montant invalide ou devise non supportée'
      });
    }

    const transactionId = randomUUID();

    await pool.query(
      `INSERT INTO payments
       (transaction_id, amount, currency, status)
       VALUES (?, ?, ?, ?)`,
      [transactionId, amount, currency, 'SUCCESS']
    );

    res.status(201).json({
      transaction_id: transactionId,
      amount,
      currency,
      status: 'SUCCESS'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Erreur lors du paiement'
    });
  }
};

module.exports = { getPayments, createPayment };
