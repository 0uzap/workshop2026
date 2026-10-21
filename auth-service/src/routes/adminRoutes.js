const express = require('express');
const router = express.Router();

const requireBackoffice = require('../middlewares/backoffice');
const admin = require('../controllers/adminController');

router.get('/me', requireBackoffice(), admin.me);

// Habilitations
router.get('/users', requireBackoffice('users:read'), admin.listUsers);
router.post('/users', requireBackoffice('users:write'), admin.createUser);
router.patch('/users/:id', requireBackoffice('users:write'), admin.updateUser);
router.post('/users/:id/unlock', requireBackoffice('locks:manage'), admin.unlockUser);

// Visages (enrôlement avec la caméra du poste)
router.post('/users/:id/face/session', requireBackoffice('faces:manage'), admin.startFaceEnrollment);
router.post('/users/:id/face', requireBackoffice('faces:manage'), admin.captureFace);
router.delete('/users/:id/face', requireBackoffice('faces:manage'), admin.deleteFace);
router.post('/face/cancel', requireBackoffice('faces:manage'), admin.cancelFaceEnrollment);
router.get('/face/frame', requireBackoffice('faces:manage'), admin.enrollmentFrame);

// Supervision
router.get('/audit', requireBackoffice('audit:read'), admin.listAudit);
router.get('/terminal', requireBackoffice('terminal:read'), admin.terminalStatus);

module.exports = router;
