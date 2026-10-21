const express = require('express');
const router = express.Router();

const { loginLimiter } = require('../middlewares/rateLimit');
const {
  identify,
  state,
  frame,
  password,
  cancel
} = require('../controllers/terminalController');

// Poste d'authentification du back-office (caméra du PC Hôte)
router.post('/identify', loginLimiter, identify);
router.post('/password', loginLimiter, password);
router.post('/cancel', cancel);

// Sondés pendant l'identification : protégés par l'identifiant de session
router.get('/state', state);
router.get('/frame', frame);

module.exports = router;
