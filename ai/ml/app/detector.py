"""
Detecteur d'anomalie sur les metriques de l'API de paiement.

Modele : Isolation Forest (scikit-learn). On n'ecrit AUCUNE regle en dur
sur les seuils : le modele apprend ce qu'est un trafic "normal" (debit,
latence, taux d'erreur) et signale ce qui s'en ecarte.

- Amorcage : une base normale synthetique (trafic faible, peu d'erreurs,
  faible latence) rend le modele operationnel des le demarrage.
- Apprentissage en ligne : les observations jugees normales alimentent une
  fenetre glissante, et le modele est re-entraine periodiquement dessus
  (jamais pendant une anomalie, pour ne pas apprendre l'attaque).
"""

import os
import time
from collections import deque

import httpx
import numpy as np
from sklearn.ensemble import IsolationForest

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
JOB = os.getenv("TARGET_JOB", "payment-api")
TARGET_KEY = os.getenv("TARGET_KEY", "backend")

# Fenetre de metriques (rate sur 30s) interrogee a chaque tick
QUERIES = {
    "req_rate": f'sum(rate(http_requests_total{{job="{JOB}"}}[30s]))',
    "err_ratio": (
        f'sum(rate(http_requests_total{{job="{JOB}",status=~"4..|5.."}}[30s]))'
        f' / clamp_min(sum(rate(http_requests_total{{job="{JOB}"}}[30s])), 0.001)'
    ),
    "p95_latency": (
        f'histogram_quantile(0.95, sum by (le) '
        f'(rate(http_request_duration_seconds_bucket{{job="{JOB}"}}[30s])))'
    ),
}

FEATURES = ["req_rate", "err_ratio", "p95_latency"]
LABELS = {
    "req_rate": "debit de requetes anormal",
    "err_ratio": "taux d'erreur eleve",
    "p95_latency": "latence elevee",
}


class Detector:
    def __init__(self, consecutive=2, refit_every=30, window=240):
        self.buffer = deque(maxlen=window)
        self.model = None
        self.mean = np.zeros(len(FEATURES))
        self.std = np.ones(len(FEATURES))
        self.consecutive = consecutive
        self.refit_every = refit_every
        self._last_fit = 0.0
        self._streak = 0
        self.last = {"anomaly": False, "score": 0.0, "reason": None, "features": {}}
        self._bootstrap()

    # Base normale synthetique : operation calme (peu de trafic, peu d'erreurs)
    def _bootstrap(self):
        rng = np.random.default_rng(42)
        base = np.array([1.0, 0.02, 0.05])  # req/s, ratio, secondes
        for _ in range(60):
            noise = rng.normal(0, [0.8, 0.02, 0.03])
            self.buffer.append(np.clip(base + noise, 0, None))
        self._fit()

    def _fit(self):
        data = np.array(self.buffer)
        self.mean = data.mean(axis=0)
        self.std = data.std(axis=0) + 1e-6
        scaled = (data - self.mean) / self.std
        self.model = IsolationForest(
            n_estimators=120, contamination=0.03, random_state=0
        ).fit(scaled)
        self._last_fit = time.time()

    async def fetch_features(self):
        values = {}
        async with httpx.AsyncClient(timeout=3.0) as client:
            for name, query in QUERIES.items():
                try:
                    r = await client.get(
                        f"{PROMETHEUS_URL}/api/v1/query", params={"query": query}
                    )
                    result = r.json()["data"]["result"]
                    v = float(result[0]["value"][1]) if result else 0.0
                    values[name] = 0.0 if np.isnan(v) else v
                except Exception:
                    values[name] = 0.0
        return values

    def score(self, values):
        x = np.array([values[f] for f in FEATURES])
        scaled = (x - self.mean) / self.std
        # score_samples : plus c'est bas, plus c'est anormal -> on inverse
        raw = -float(self.model.score_samples([scaled])[0])
        is_outlier = self.model.predict([scaled])[0] == -1

        self._streak = self._streak + 1 if is_outlier else 0
        anomaly = self._streak >= self.consecutive

        # Cause : la variable la plus au-dessus de sa normale
        z = (x - self.mean) / self.std
        reason = LABELS[FEATURES[int(np.argmax(z))]] if anomaly else None

        # Apprentissage en ligne : on n'enrichit la base QUE si c'est normal
        if not is_outlier:
            self.buffer.append(x)
        if time.time() - self._last_fit > self.refit_every and self._streak == 0:
            self._fit()

        self.last = {
            "anomaly": anomaly,
            "target": TARGET_KEY,
            "score": round(raw, 4),
            "reason": reason,
            "features": {k: round(v, 4) for k, v in values.items()},
            "model_ready": True,
        }
        return self.last
