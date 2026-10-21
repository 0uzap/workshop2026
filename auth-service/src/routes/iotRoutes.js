const express = require('express');
const router = express.Router();

const { ledState } = require('../controllers/iotController');

router.get('/led', ledState);

module.exports = router;
