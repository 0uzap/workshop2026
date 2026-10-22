// Client de l'agent caméra natif du PC Hôte (camera-agent/agent.py).

const AGENT_URL = process.env.CAMERA_AGENT_URL || 'http://host.docker.internal:8765';

class CameraUnavailable extends Error {}

const call = async (method, path, timeoutMs) => {
  let response;

  try {
    response = await fetch(`${AGENT_URL}${path}`, {
      method,
      headers: { 'X-Agent-Token': process.env.CAMERA_AGENT_TOKEN },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new CameraUnavailable(`Agent caméra injoignable : ${error.message}`);
  }

  if (!response.ok) {
    throw new CameraUnavailable(`Agent caméra HTTP ${response.status}`);
  }

  return response;
};

// L'ouverture d'une webcam USB peut prendre quelques secondes
const start = () => call('POST', '/v1/camera/start', 10000);

const stop = () => call('POST', '/v1/camera/stop', 5000).catch(() => {});

const frame = async () => {
  const response = await call('GET', '/v1/frame', 3000);
  return Buffer.from(await response.arrayBuffer());
};

const health = async () => {
  try {
    return await (await call('GET', '/health', 2000)).json();
  } catch (error) {
    return { status: 'unreachable' };
  }
};

module.exports = { start, stop, frame, health, CameraUnavailable };
