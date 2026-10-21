const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({ register });

// Tentatives d'authentification par étape (mot de passe, visage, enrôlement)
const authAttempts = new client.Counter({
  name: 'auth_attempts_total',
  help: 'Tentatives d\'authentification par etape et resultat',
  labelNames: ['step', 'result'],
  registers: [register]
});

// Dernier contact du module LED (ESP8266) : alerte si le poste est hors ligne
const iotLastSeen = new client.Gauge({
  name: 'iot_led_last_seen_timestamp_seconds',
  help: 'Horodatage du dernier appel du module LED ESP8266',
  registers: [register]
});

module.exports = { register, authAttempts, iotLastSeen };
