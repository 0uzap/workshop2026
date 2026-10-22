// Règles de décision biométrique, isolées en fonctions pures pour être testées.
//
// yaw_ratio (calculé par face-service) : position du nez entre les yeux,
// 0.5 = de face. Sur l'image brute de la caméra (non miroir), tourner la tête
// vers SA gauche augmente le ratio, vers SA droite le diminue.

const config = () => ({
  // Seuil de similarité cosinus SFace (valeur de référence OpenCV : 0.363)
  matchThreshold: Number(process.env.FACE_MATCH_THRESHOLD || 0.40),
  // Visage tourné : la similarité baisse naturellement, seuil plus bas
  turnedThreshold: Number(process.env.FACE_TURNED_THRESHOLD || 0.30),
  frontalTolerance: Number(process.env.FACE_FRONTAL_TOLERANCE || 0.15),
  turnMin: Number(process.env.FACE_TURN_MIN || 0.18),
  enrollConsistency: Number(process.env.FACE_ENROLL_CONSISTENCY || 0.50)
});

const cosine = (a, b) => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
};

const normalize = (v) => {
  const norm = Math.sqrt(cosine(v, v));
  return v.map((x) => x / norm);
};

const isFrontal = (analysis, cfg) =>
  Math.abs(analysis.yaw_ratio - 0.5) <= cfg.frontalTolerance;

const isTurned = (analysis, direction, cfg) =>
  direction === 'left'
    ? analysis.yaw_ratio >= 0.5 + cfg.turnMin
    : analysis.yaw_ratio <= 0.5 - cfg.turnMin;

/**
 * Étape 1 de la preuve de vie : visage de face reconnu.
 */
const matchesFrontal = (template, analysis) => {
  const cfg = config();
  const score = cosine(template, analysis.embedding);
  return {
    ok: isFrontal(analysis, cfg) && score >= cfg.matchThreshold,
    score: Number(score.toFixed(4))
  };
};

/**
 * Étape 2 : tête tournée dans la direction imposée par le serveur, même
 * personne que le gabarit ET que l'image de face retenue à l'étape 1
 * (une photo ne peut pas tourner la tête).
 */
const matchesTurned = (template, frontal, analysis, direction) => {
  const cfg = config();
  const score = cosine(template, analysis.embedding);
  const samePerson = cosine(frontal.embedding, analysis.embedding);
  return {
    ok: isTurned(analysis, direction, cfg) &&
      score >= cfg.turnedThreshold &&
      samePerson >= cfg.turnedThreshold,
    score: Number(score.toFixed(4))
  };
};

/**
 * Enrôlement : plusieurs images de face cohérentes entre elles, moyennées
 * pour obtenir un gabarit plus stable qu'une capture unique.
 */
const buildTemplate = (analyses) => {
  const cfg = config();

  if (!analyses.every((a) => isFrontal(a, cfg))) {
    return { ok: false, reason: 'enroll_not_frontal' };
  }

  for (let i = 0; i < analyses.length; i++) {
    for (let j = i + 1; j < analyses.length; j++) {
      if (cosine(analyses[i].embedding, analyses[j].embedding) < cfg.enrollConsistency) {
        return { ok: false, reason: 'enroll_inconsistent' };
      }
    }
  }

  const sum = new Array(analyses[0].embedding.length).fill(0);
  for (const a of analyses) {
    a.embedding.forEach((x, i) => { sum[i] += x; });
  }

  return { ok: true, template: normalize(sum) };
};

module.exports = { matchesFrontal, matchesTurned, buildTemplate, cosine };
