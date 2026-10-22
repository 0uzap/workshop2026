const Docker = require('dockerode');

// Deux proxys Docker distincts (principe de moindre privilege) :
//  - lecture seule  : lister / inspecter les conteneurs (socket-proxy-ro)
//  - action restreinte : restart / start / kill(HUP) uniquement (socket-proxy-remediation)
// Le moteur n'a JAMAIS acces direct a /var/run/docker.sock.

const readClient = new Docker({
  host: process.env.DOCKER_RO_HOST || 'socket-proxy-ro',
  port: 2375,
  protocol: 'http'
});

const actionClient = new Docker({
  host: process.env.DOCKER_ACTION_HOST || 'socket-proxy-remediation',
  port: 2375,
  protocol: 'http'
});

// Etat d'un conteneur via le proxy lecture seule
const inspect = async (name) => {
  try {
    const data = await readClient.getContainer(name).inspect();
    return {
      exists: true,
      running: data.State.Running === true,
      status: data.State.Status,
      // "healthy" / "unhealthy" / "starting" / null (pas de healthcheck)
      health: data.State.Health ? data.State.Health.Status : null,
      startedAt: data.State.StartedAt
    };
  } catch (error) {
    if (error.statusCode === 404) return { exists: false, running: false };
    throw error;
  }
};

// Actions (via le proxy restreint) : adressees par NOM, sans inspection prealable
const restart = (name) => actionClient.getContainer(name).restart({ t: 5 });
const start = (name) => actionClient.getContainer(name).start();
const signal = (name, sig) => actionClient.getContainer(name).kill({ signal: sig });

module.exports = { inspect, restart, start, signal };
