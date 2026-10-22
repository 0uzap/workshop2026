const fs = require('fs/promises');
const path = require('path');
const docker = require('./docker');
const config = require('./config');
const { log } = require('./log');

// Repertoire de l'interrupteur de limite de debit du WAF, monte depuis l'hote
// (security/waf/ratelimit). Deposer state/active.conf puis HUP = limite active.
const WAF_DIR = process.env.WAF_RATELIMIT_DIR || '/waf-ratelimit';
const ACTIVE = path.join(WAF_DIR, 'state', 'active.conf');
const SOURCE = path.join(WAF_DIR, 'limits.on.conf');

let wafLimited = false;

// Redemarre un conteneur ; s'il est arrete, le demarre.
const recoverContainer = async (target, state) => {
  if (state.exists && !state.running) {
    await docker.start(target.container);
    return 'start';
  }
  await docker.restart(target.container);
  return 'restart';
};

// Active la limite de debit du WAF : copie limits.on.conf -> state/active.conf,
// puis recharge nginx (signal HUP) via le proxy Docker restreint.
const enableWafRateLimit = async () => {
  if (wafLimited) return false;
  const content = await fs.readFile(SOURCE, 'utf8');
  await fs.writeFile(ACTIVE, content);
  await docker.signal(config.wafContainer, 'HUP');
  wafLimited = true;
  log('remediation.waf.ratelimit', { state: 'on' });
  return true;
};

const disableWafRateLimit = async () => {
  if (!wafLimited) return false;
  await fs.rm(ACTIVE, { force: true });
  await docker.signal(config.wafContainer, 'HUP');
  wafLimited = false;
  log('remediation.waf.ratelimit', { state: 'off' });
  return true;
};

const isWafLimited = () => wafLimited;

module.exports = {
  recoverContainer,
  enableWafRateLimit,
  disableWafRateLimit,
  isWafLimited
};
