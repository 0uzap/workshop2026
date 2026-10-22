const crypto = require('crypto');
const led = require('../iot/led');
const { iotLastSeen } = require('../metrics');

const sameToken = (a, b) => {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
};

/**
 * Interrogé en boucle par l'ESP8266 (LED bicolore du poste).
 * Lecture seule : le module ne peut rien modifier côté serveur.
 */
const ledState = (req, res) => {
  if (!sameToken(req.get('x-device-token') || '', process.env.IOT_DEVICE_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  led.markDeviceSeen();
  iotLastSeen.setToCurrentTime();
  res.set('Cache-Control', 'no-store').json(led.get());
};

module.exports = { ledState };
