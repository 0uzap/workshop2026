// Moteur de remediation : une machine d'etats par service surveille.
//
//   healthy --(N ticks KO)--> remediating --(action)--> verifying
//      ^                                                     |
//      +--------(sante + canari OK)--------------------------+
//                                                            |
//                                       (echec repete) --> escalated (humain)
//
// Les dependances sont injectees pour pouvoir tester la logique sans Docker,
// sans WAF et sans reseau.

const createEngine = (deps) => {
  const { docker, probes, actions, metrics, log, config, now = () => Date.now() } = deps;

  const MAX_HISTORY = 50;
  const history = [];
  const targets = new Map();

  for (const t of config.targets) {
    targets.set(t.key, {
      def: t,
      state: 'healthy',
      failCount: 0,
      goodCount: 0,
      busy: false,
      actionTimes: [],
      incident: null,
      verifyUntil: 0
    });
  }

  const recentActions = (ts) => ts.filter((t) => now() - t < config.actionWindowMs);

  // --- Analyse des signaux d'un tick ---------------------------------------
  const assess = (cstate, healthRes, ml, def) => {
    if (!cstate.exists || !cstate.running) {
      return { bad: true, type: 'unavailable', reason: 'container_down' };
    }
    if (cstate.health === 'unhealthy') {
      return { bad: true, type: 'unavailable', reason: 'container_unhealthy' };
    }
    if (!healthRes.ok) {
      return { bad: true, type: 'unavailable', reason: 'health_failing' };
    }
    // Conteneur up + sante OK, mais le ML voit une anomalie sur ce service :
    // surcharge (ex. flood) -> on deleste
    if (ml && ml.anomaly && ml.target === def.key) {
      return { bad: true, type: 'overload', reason: ml.reason || 'ml_anomaly', score: ml.score };
    }
    return { bad: false };
  };

  // --- Verification de la reprise ------------------------------------------
  const verifyRecovered = async (def, ml) => {
    const cstate = await docker.inspect(def.container);
    if (!cstate.running || cstate.health === 'unhealthy') return false;

    const h = await probes.health(def);
    if (!h.ok) return false;

    // Preuve metier : une transaction (annulee) doit passer
    if (def.business) {
      const c = await probes.canary(def);
      if (!c.ok) return false;
    }

    // L'anomalie ML sur ce service ne doit plus etre active
    if (ml && ml.anomaly && ml.target === def.key) return false;

    return true;
  };

  // --- Execution d'une action de remediation -------------------------------
  const remediate = async (node, assessment) => {
    const def = node.def;
    const inWindow = recentActions(node.actionTimes);

    if (inWindow.length >= config.maxActionsPerWindow) {
      escalate(node, 'trop d\'actions dans la fenetre');
      return;
    }

    node.state = 'remediating';
    metrics.setState(def.key, 'remediating');

    const applied = [];
    try {
      if (assessment.type === 'overload') {
        // Delestage : limite de debit du WAF pour absorber le flood
        if (await actions.enableWafRateLimit()) applied.push('waf_ratelimit_on');
        metrics.actions.inc({ target: def.key, action: 'waf_ratelimit_on' });
        // Si une tentative a deja echoue, on redemarre aussi (purge du pool)
        if (node.incident.actions.length > 0) {
          const act = await actions.recoverContainer(def, await docker.inspect(def.container));
          applied.push(act);
          metrics.actions.inc({ target: def.key, action: act });
        }
      } else {
        const act = await actions.recoverContainer(def, await docker.inspect(def.container));
        applied.push(act);
        metrics.actions.inc({ target: def.key, action: act });
      }

      node.actionTimes.push(now());
      node.incident.actions.push(...applied);
      log('remediation.action', { target: def.key, actions: applied, reason: assessment.reason });

      node.state = 'verifying';
      node.verifyUntil = now() + config.verifyTimeoutMs;
      metrics.setState(def.key, 'verifying');
    } catch (error) {
      log('remediation.action.error', { target: def.key, detail: error.message });
      node.state = 'verifying';
      node.verifyUntil = now() + config.verifyTimeoutMs;
    }
  };

  const openIncident = (node, assessment) => {
    node.incident = {
      target: node.def.key,
      label: node.def.label,
      type: assessment.type,
      reason: assessment.reason,
      detectedAt: now(),
      actions: [],
      outcome: null,
      resolvedAt: null
    };
    metrics.targetUp.set({ target: node.def.key }, 0);
    log('remediation.incident.detected', {
      target: node.def.key, type: assessment.type, reason: assessment.reason
    });
  };

  const closeIncident = (node, outcome) => {
    const inc = node.incident;
    inc.outcome = outcome;
    inc.resolvedAt = now();
    inc.durationMs = inc.resolvedAt - inc.detectedAt;

    metrics.incidents.inc({ target: inc.target, outcome });
    if (outcome === 'recovered') {
      metrics.recoverySeconds.observe({ target: inc.target }, inc.durationMs / 1000);
      metrics.targetUp.set({ target: inc.target }, 1);
    }
    log('remediation.incident.' + outcome, {
      target: inc.target, duration_ms: inc.durationMs, actions: inc.actions
    });

    history.unshift(inc);
    if (history.length > MAX_HISTORY) history.pop();

    // Lever la limite de debit du WAF apres une periode de stabilite
    if (outcome === 'recovered' && actions.isWafLimited()) {
      setTimeout(() => {
        actions.disableWafRateLimit().catch((e) => log('remediation.waf.error', { detail: e.message }));
      }, config.wafCooldownMs).unref?.();
    }

    node.incident = null;
  };

  const escalate = (node, why) => {
    node.state = 'escalated';
    metrics.setState(node.def.key, 'escalated');
    if (node.incident && !node.incident.outcome) closeIncident(node, 'escalated');
    log('remediation.escalated', { target: node.def.key, reason: why });
  };

  // --- Un tick pour un service ---------------------------------------------
  const tickTarget = async (node, ml) => {
    if (node.busy) return;
    node.busy = true;
    const def = node.def;

    try {
      const cstate = await docker.inspect(def.container).catch(() => ({ exists: false, running: false }));
      const healthRes = cstate.running ? await probes.health(def) : { ok: false, status: 0 };
      const assessment = assess(cstate, healthRes, ml, def);

      if (node.state === 'verifying') {
        if (await verifyRecovered(def, ml)) {
          closeIncident(node, 'recovered');
          node.state = 'healthy';
          node.failCount = 0;
          metrics.setState(def.key, 'healthy');
          metrics.targetUp.set({ target: def.key }, 1);
        } else if (now() > node.verifyUntil) {
          // Pas retabli : nouvelle tentative si le budget le permet, sinon escalade
          if (recentActions(node.actionTimes).length >= config.maxActionsPerWindow) {
            escalate(node, 'service non retabli apres actions');
          } else {
            await remediate(node, { type: node.incident.type, reason: node.incident.reason });
          }
        }
        return;
      }

      if (node.state === 'escalated') {
        // Sortie d'escalade si le service redevient sain durablement
        if (!assessment.bad) {
          node.goodCount++;
          if (node.goodCount >= config.failThreshold) {
            node.state = 'healthy';
            node.failCount = 0;
            metrics.setState(def.key, 'healthy');
            metrics.targetUp.set({ target: def.key }, 1);
            if (actions.isWafLimited()) await actions.disableWafRateLimit();
            log('remediation.recovered.manual_or_natural', { target: def.key });
          }
        } else {
          node.goodCount = 0;
        }
        return;
      }

      // healthy / degraded
      if (assessment.bad) {
        node.failCount++;
        node.goodCount = 0;
        if (node.failCount === 1) metrics.setState(def.key, 'degraded');
        if (node.failCount >= config.failThreshold) {
          openIncident(node, assessment);
          await remediate(node, assessment);
        }
      } else {
        node.failCount = 0;
        if (node.state !== 'healthy') metrics.setState(def.key, 'healthy');
        node.state = 'healthy';
        metrics.targetUp.set({ target: def.key }, 1);
      }
    } finally {
      node.busy = false;
    }
  };

  const tick = async () => {
    const ml = await probes.mlStatus().catch(() => null);
    await Promise.all([...targets.values()].map((node) => tickTarget(node, ml)));
    return ml;
  };

  const snapshot = () => ({
    targets: [...targets.values()].map((n) => ({
      key: n.def.key,
      label: n.def.label,
      state: n.state,
      failCount: n.failCount,
      incident: n.incident
    })),
    wafRateLimited: actions.isWafLimited(),
    history: history.slice(0, 20)
  });

  return { tick, snapshot, _targets: targets };
};

module.exports = { createEngine };
