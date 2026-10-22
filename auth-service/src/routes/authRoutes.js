const express = require('express');
const router = express.Router();

const { register, login } = require('../controllers/authController');
const { loginLimiter } = require('../middlewares/rateLimit');

router.post('/register', loginLimiter, register);
router.post('/login', loginLimiter, login);

module.exports = router;
