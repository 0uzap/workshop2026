"""
Service de detection d'anomalie (AIOps).

Boucle de fond : interroge Prometheus, score via Isolation Forest, expose
l'etat. Le moteur de remediation consomme /status ; Grafana lit /metrics.
"""

import asyncio
import contextlib
import os

from fastapi import FastAPI
from prometheus_client import CONTENT_TYPE_LATEST, Gauge, generate_latest
from starlette.responses import Response

from .detector import FEATURES, Detector

TICK_SECONDS = float(os.getenv("TICK_SECONDS", "3"))

detector = Detector()

anomaly_gauge = Gauge("ml_anomaly", "Anomalie detectee (1) ou non (0)")
score_gauge = Gauge("ml_anomaly_score", "Score d'anomalie (plus haut = plus anormal)")
feature_gauges = {f: Gauge(f"ml_feature_{f}", f"Caracteristique {f}") for f in FEATURES}


async def _loop():
    while True:
        try:
            values = await detector.fetch_features()
            result = detector.score(values)
            anomaly_gauge.set(1 if result["anomaly"] else 0)
            score_gauge.set(result["score"])
            for f in FEATURES:
                feature_gauges[f].set(result["features"].get(f, 0.0))
        except Exception as exc:  # ne jamais tuer la boucle
            print(f"ml-detector tick error: {exc}", flush=True)
        await asyncio.sleep(TICK_SECONDS)


@contextlib.asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="ml-detector", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/status")
def status():
    return detector.last


@app.get("/health")
def health():
    return {"status": "healthy", "service": "ml-detector"}


@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
