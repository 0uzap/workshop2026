const crypto = require('crypto');

// Gabarit biométrique = donnée sensible (RGPD art. 9) : chiffré au repos en
// AES-256-GCM. L'identifiant utilisateur sert de données associées (AAD),
// ce qui empêche de déplacer un gabarit d'une ligne à une autre en base.

const EMBEDDING_SIZE = 128;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const getKey = () => {
  const hex = process.env.FACE_TEMPLATE_KEY || '';

  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('FACE_TEMPLATE_KEY doit contenir 64 caractères hexadécimaux (32 octets)');
  }

  return Buffer.from(hex, 'hex');
};

const aad = (userId) => Buffer.from(`face-template:v1:user:${userId}`);

const encryptTemplate = (userId, embedding) => {
  if (embedding.length !== EMBEDDING_SIZE) {
    throw new Error('Taille de gabarit invalide');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  cipher.setAAD(aad(userId));

  const plaintext = Buffer.from(Float32Array.from(embedding).buffer);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};

const decryptTemplate = (userId, blob) => {
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return Array.from(
    new Float32Array(plaintext.buffer, plaintext.byteOffset, EMBEDDING_SIZE)
  );
};

module.exports = { EMBEDDING_SIZE, getKey, encryptTemplate, decryptTemplate };
