// État de la LED bicolore du poste d'authentification (ESP8266).
// L'ESP8266 interroge cet état en WiFi ; chaque changement incrémente `seq`
// pour que le module rejoue les séquences finies (10 clignotements rouges).

const MODES = ['off', 'green_blink', 'green_on', 'red_on', 'red_blink'];

const DURATIONS = {
  green_on: 30_000,
  red_on: 30_000,
  // 10 clignotements de 300 ms allumé / 300 ms éteint côté ESP8266
  red_blink: 6_000
};

let state = { mode: 'off', seq: 0 };
let timer = null;
let deviceLastSeen = null;

const set = (mode) => {
  if (!MODES.includes(mode)) throw new Error(`Mode LED inconnu : ${mode}`);

  clearTimeout(timer);
  state = { mode, seq: state.seq + 1 };

  if (DURATIONS[mode]) {
    timer = setTimeout(() => set('off'), DURATIONS[mode]);
    timer.unref?.();
  }
};

const get = () => ({ ...state });

const markDeviceSeen = () => { deviceLastSeen = new Date(); };

const status = () => ({ ...state, device_last_seen: deviceLastSeen });

module.exports = { set, get, status, markDeviceSeen, DURATIONS };
