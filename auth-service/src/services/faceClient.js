const { EMBEDDING_SIZE } = require('../security/templateCrypto');

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://face-service:8000';

class FaceServiceUnavailable extends Error {}

/**
 * Envoie une image (JPEG base64) au service interne d'analyse faciale.
 * Retourne { ok: true, embedding, yaw_ratio, ... } ou { ok: false, reason }.
 */
const analyzeFace = async (image) => {
  let response;

  try {
    response = await fetch(`${FACE_SERVICE_URL}/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': process.env.FACE_SERVICE_TOKEN
      },
      body: JSON.stringify({ image }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    throw new FaceServiceUnavailable(error.message);
  }

  if (!response.ok) {
    throw new FaceServiceUnavailable(`face-service HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result.ok && (
    !Array.isArray(result.embedding) ||
    result.embedding.length !== EMBEDDING_SIZE ||
    !result.embedding.every(Number.isFinite) ||
    !Number.isFinite(result.yaw_ratio)
  )) {
    throw new FaceServiceUnavailable('Réponse invalide du face-service');
  }

  return result;
};

module.exports = { analyzeFace, FaceServiceUnavailable };
