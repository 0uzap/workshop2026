const crypto = require('crypto');

/**
 * Poste d'authentification du back-office (consigne additionnelle 1).
 *
 *   identifiant ──► caméra ON ──► visage reconnu ? ──oui──► LED verte clignotante,
 *                                    │                     caméra OFF, saisie du mot de passe
 *                                    │                        ├─ bon  : LED verte fixe 30 s, accès
 *                                    │                        └─ faux : LED rouge 10 clignotements,
 *                                    │                                  retour à l'identifiant
 *                                    └─non──► LED rouge fixe 30 s, puis caméra OFF
 *                                             et retour à l'identifiant
 *
 * Un seul poste, une seule caméra, une seule LED : une session à la fois.
 * Deux échecs (visage ou mot de passe) bloquent l'identifiant 5 minutes.
 *
 * Les dépendances sont injectées pour pouvoir tester la machine d'états
 * sans caméra, sans base et sans face-service.
 */

class TerminalError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createTerminal = ({
  camera,
  analyzeFrame,
  loadIdentity,
  guard,
  verifyPassword,
  led,
  audit,
  matcher,
  isInfrastructureError,
  timings
}) => {
  let session = null;

  const sameId = (a, b) =>
    typeof a === 'string' &&
    a.length === b.length &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  // Événement d'audit enrichi du contexte de la requête d'origine (IP…)
  const log = (s, event, fields) => audit(event, { ...s.ctx, ...fields });

  const current = (id) => (session && sameId(id, session.id) ? session : null);

  const reserve = (fields) => {
    if (session) {
      throw new TerminalError(409, 'Poste d\'authentification occupé, patientez');
    }
    // Réservation synchrone : deux requêtes simultanées ne peuvent pas
    // obtenir la caméra en même temps
    session = { id: crypto.randomBytes(32).toString('base64url'), ...fields };
    return session;
  };

  const stopCamera = async (s) => {
    if (s.cameraOn) {
      s.cameraOn = false;
      await camera.stop();
    }
  };

  const end = async (s) => {
    s.closed = true;
    clearTimeout(s.timer);
    if (session === s) session = null;
    await stopCamera(s);
  };

  const later = (s, ms, fn) => {
    clearTimeout(s.timer);
    s.timer = setTimeout(fn, ms);
    s.timer.unref?.();
  };

  const startCamera = async (s) => {
    try {
      await camera.start();
      s.cameraOn = true;
    } catch (error) {
      await end(s);
      throw new TerminalError(503, 'Caméra du poste d\'authentification indisponible');
    }
  };

  // ---------------------------------------------------------------- identification

  const recognized = async (s, scores) => {
    await stopCamera(s);
    s.phase = 'awaiting_password';
    s.step = null;
    led.set('green_blink');
    log(s, 'terminal.face.recognized', {
      username: s.username,
      user_id: s.identity.user.id,
      scores
    });

    later(s, timings.passwordTimeoutMs, async () => {
      led.set('off');
      log(s, 'terminal.password.timeout', { username: s.username });
      await end(s);
    });
  };

  const rejected = async (s, scores) => {
    s.phase = 'rejected';
    s.step = null;
    s.cooldownUntil = Date.now() + timings.rejectCooldownMs;
    led.set('red_on');

    const result = await guard.failure(s.username);
    s.lockedUntil = result.lockedUntil;

    log(s, 'terminal.face.rejected', {
      username: s.username,
      user_id: s.identity?.user.id ?? null,
      best_score: scores.best,
      locked: Boolean(result.lockedUntil)
    });

    // La caméra reste allumée pendant les 30 s de LED rouge, puis s'éteint
    later(s, timings.rejectCooldownMs, () => end(s));
  };

  const failed = async (s, error) => {
    // Panne technique (agent caméra, face-service) : pas comptée comme échec
    await stopCamera(s);
    s.phase = 'error';
    s.error = 'Service de reconnaissance indisponible, réessayez';
    led.set('off');
    log(s, 'terminal.error', { username: s.username, detail: error.message });
    later(s, 10_000, () => end(s));
  };

  const runVerification = async (s) => {
    const template = s.identity?.template;
    const scores = { best: 0 };
    let frontal = null;

    try {
      while (!s.closed && Date.now() < s.deadline) {
        const analysis = await analyzeFrame();
        if (s.closed) return;

        // Identifiant inconnu ou sans visage enrôlé : même déroulé, même
        // durée qu'un visage non reconnu (pas d'énumération des comptes)
        if (analysis.ok && template) {
          if (s.step === 'look') {
            const r = matcher.matchesFrontal(template, analysis);
            scores.best = Math.max(scores.best, r.score);
            if (r.ok) {
              frontal = analysis;
              scores.frontal = r.score;
              s.step = 'turn';
            }
          } else {
            const r = matcher.matchesTurned(template, frontal, analysis, s.direction);
            if (r.ok) {
              scores.turned = r.score;
              return await recognized(s, scores);
            }
          }
        }

        await sleep(timings.frameIntervalMs);
      }

      if (!s.closed) await rejected(s, scores);
    } catch (error) {
      if (s.closed) return;
      if (isInfrastructureError(error)) return failed(s, error);
      console.error(error);
      await failed(s, error);
    }
  };

  const identify = async (rawUsername, ctx = {}) => {
    const display = rawUsername.trim();
    const username = display.toLowerCase();

    const s = reserve({
      phase: 'starting',
      ctx,
      username,
      step: 'look',
      direction: crypto.randomInt(2) === 0 ? 'left' : 'right'
    });

    try {
      const lock = await guard.status(username);
      if (lock.lockedUntil) {
        await end(s);
        log(s, 'terminal.identify.locked', { username });
        throw new TerminalError(423, 'Identifiant bloqué suite à des échecs répétés', {
          locked_until: lock.lockedUntil
        });
      }

      s.identity = await loadIdentity(display);
    } catch (error) {
      if (!s.closed) await end(s);
      throw error;
    }

    await startCamera(s);

    s.phase = 'identifying';
    s.deadline = Date.now() + timings.verifyWindowMs;
    log(s, 'terminal.identify.start', { username });

    runVerification(s);

    return {
      session_id: s.id,
      direction: s.direction,
      timeout_ms: timings.verifyWindowMs
    };
  };

  const submitPassword = async (id, password) => {
    const s = current(id);

    if (!s || s.phase !== 'awaiting_password') {
      throw new TerminalError(401, 'Session expirée, recommencez l\'identification', {
        restart: true
      });
    }

    s.phase = 'checking';
    clearTimeout(s.timer);

    const valid = typeof password === 'string' &&
      await verifyPassword(s.identity.user, password);

    if (!valid) {
      const result = await guard.failure(s.username);
      led.set('red_blink');
      log(s, 'terminal.password.failure', {
        username: s.username,
        user_id: s.identity.user.id,
        locked: Boolean(result.lockedUntil)
      });
      await end(s);
      throw new TerminalError(401, 'Mot de passe incorrect, recommencez l\'identification', {
        restart: true,
        locked_until: result.lockedUntil
      });
    }

    await guard.reset(s.username);
    led.set('green_on');
    log(s, 'terminal.login.success', { username: s.username, user_id: s.identity.user.id });
    await end(s);

    return s.identity.user;
  };

  const state = (id) => {
    const s = current(id);
    if (!s) return null;

    const now = Date.now();
    return {
      phase: s.phase,
      step: s.step,
      direction: s.direction,
      remaining_ms: s.phase === 'identifying' ? Math.max(0, s.deadline - now) : null,
      cooldown_ms: s.phase === 'rejected' ? Math.max(0, s.cooldownUntil - now) : null,
      locked_until: s.lockedUntil || null,
      error: s.error || null
    };
  };

  /** Abandon volontaire à l'étape du mot de passe (pas pendant l'analyse). */
  const cancel = async (id) => {
    const s = current(id);
    if (!s || s.phase !== 'awaiting_password') return false;
    led.set('off');
    log(s, 'terminal.cancel', { username: s.username });
    await end(s);
    return true;
  };

  // ---------------------------------------------------------------- enrôlement

  const startEnrollment = async (targetUserId, actorId) => {
    const s = reserve({ phase: 'enrolling', ctx: {}, targetUserId, actorId });
    await startCamera(s);
    later(s, timings.enrollTimeoutMs, () => end(s));
    return { session_id: s.id };
  };

  const enrollmentSession = (id, actorId) => {
    const s = current(id);
    if (!s || s.phase !== 'enrolling' || s.actorId !== actorId) {
      throw new TerminalError(404, 'Session d\'enrôlement introuvable ou expirée');
    }
    return s;
  };

  const captureEnrollment = async (id, actorId, frames = 3) => {
    const s = enrollmentSession(id, actorId);
    const analyses = [];

    for (let i = 0; i < frames; i++) {
      const analysis = await analyzeFrame();
      if (!analysis.ok) return { ok: false, reason: analysis.reason };
      analyses.push(analysis);
      await sleep(timings.enrollFrameIntervalMs);
    }

    const result = matcher.buildTemplate(analyses);
    if (!result.ok) return result;

    await end(s);
    return { ok: true, targetUserId: s.targetUserId, template: result.template };
  };

  const cancelEnrollment = async (id, actorId) => end(enrollmentSession(id, actorId));

  // ---------------------------------------------------------------- caméra / supervision

  /** Image courante, uniquement pendant une session caméra active. */
  const frame = async (id, actorId = null) => {
    const s = current(id);
    if (!s || !s.cameraOn) return null;
    if (s.phase === 'enrolling' && s.actorId !== actorId) return null;
    if (!['identifying', 'rejected', 'enrolling'].includes(s.phase)) return null;
    return camera.frame();
  };

  const overview = () => ({
    phase: session ? session.phase : 'idle',
    camera_on: Boolean(session?.cameraOn)
  });

  return {
    identify,
    submitPassword,
    state,
    cancel,
    startEnrollment,
    captureEnrollment,
    cancelEnrollment,
    frame,
    overview
  };
};

module.exports = { createTerminal, TerminalError };
