const express = require('express');
const router = express.Router();

const authenticate = require('../middlewares/authMiddleware');
const { requireFaceForPayments } = authenticate;

const {
  getPayments,
  createPayment
} = require('../controllers/paymentController');

router.get('/', authenticate, getPayments);
router.post('/', authenticate, requireFaceForPayments, createPayment);

module.exports = router;