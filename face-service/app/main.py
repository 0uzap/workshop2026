"""
Service interne d'analyse faciale.

- Détection : YuNet (OpenCV Zoo)
- Reconnaissance : SFace (OpenCV Zoo), embedding de 128 dimensions

Le service est sans état : il ne stocke ni image ni gabarit biométrique.
Il n'est joignable que par auth-service (réseau Docker interne, jeton partagé).
"""

import base64
import binascii
import hmac
import logging
import os
import time
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from prometheus_client import Counter, Histogram, start_http_server
from pydantic import BaseModel, Field

MODELS_DIR = os.getenv("MODELS_DIR", "/app/models")
INTERNAL_TOKEN = os.getenv("FACE_SERVICE_TOKEN", "")

MAX_IMAGE_BYTES = 1_500_000
MAX_SIDE = 1280
MIN_FACE_SIZE = int(os.getenv("FACE_MIN_SIZE", "80"))
MIN_DETECTION_SCORE = float(os.getenv("FACE_MIN_DETECTION_SCORE", "0.85"))
MIN_SHARPNESS = float(os.getenv("FACE_MIN_SHARPNESS", "30"))

if len(INTERNAL_TOKEN) < 32:
    raise RuntimeError("FACE_SERVICE_TOKEN doit contenir au moins 32 caractères")

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("face-service")

detector = cv2.FaceDetectorYN.create(
    os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx"),
    "",
    (320, 320),
    score_threshold=0.6,
    nms_threshold=0.3,
    top_k=10,
)
recognizer = cv2.FaceRecognizerSF.create(
    os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx"), ""
)

ANALYSES = Counter(
    "face_analysis_total", "Analyses faciales effectuées", ["result"]
)
LATENCY = Histogram(
    "face_analysis_duration_seconds",
    "Durée d'une analyse faciale",
    buckets=[0.05, 0.1, 0.25, 0.5, 1, 2, 5],
)



@asynccontextmanager
async def lifespan(_app):
    # Métriques Prometheus sur un port interne séparé, comme payment-api
    start_http_server(9093)
    log.info("face-service ready, metrics on internal port 9093")
    yield


app = FastAPI(
    title="face-service",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


class AnalyzeRequest(BaseModel):
    # Image JPEG/PNG encodée en base64 (sans préfixe data:)
    image: str = Field(min_length=100, max_length=2_100_000)


class AnalysisError(Exception):
    def __init__(self, reason: str):
        self.reason = reason


def require_internal_token(x_internal_token: str = Header(default="")):
    if not hmac.compare_digest(x_internal_token.encode(), INTERNAL_TOKEN.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


def decode_image(data: str) -> np.ndarray:
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise AnalysisError("invalid_image")

    if len(raw) > MAX_IMAGE_BYTES:
        raise AnalysisError("image_too_large")

    # Seuls JPEG et PNG sont acceptés (signatures de fichier)
    if not (raw.startswith(b"\xff\xd8\xff") or raw.startswith(b"\x89PNG\r\n\x1a\n")):
        raise AnalysisError("unsupported_format")

    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise AnalysisError("invalid_image")

    h, w = img.shape[:2]
    if max(h, w) > MAX_SIDE:
        scale = MAX_SIDE / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))

    return img


def yaw_ratio(face: np.ndarray) -> float:
    """
    Position horizontale du nez entre les deux yeux (0.5 = visage de face).
    Image non miroir : si la personne tourne la tête vers SA gauche,
    le nez se déplace vers la droite de l'image et le ratio augmente.
    """
    eye_a_x, eye_b_x, nose_x = face[4], face[6], face[8]
    left, right = min(eye_a_x, eye_b_x), max(eye_a_x, eye_b_x)
    width = right - left
    if width < 1:
        raise AnalysisError("invalid_landmarks")
    return float((nose_x - left) / width)


def analyze(img: np.ndarray) -> dict:
    h, w = img.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)

    if faces is None or len(faces) == 0:
        raise AnalysisError("no_face")

    faces = [f for f in faces if f[14] >= MIN_DETECTION_SCORE]
    if len(faces) == 0:
        raise AnalysisError("low_confidence")
    if len(faces) > 1:
        # Refus : une autre personne dans le champ pourrait être reconnue à la place
        raise AnalysisError("multiple_faces")

    face = faces[0]
    if min(face[2], face[3]) < MIN_FACE_SIZE:
        raise AnalysisError("face_too_small")

    aligned = recognizer.alignCrop(img, face)
    gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if sharpness < MIN_SHARPNESS:
        raise AnalysisError("too_blurry")

    feature = recognizer.feature(aligned).flatten().astype(np.float32)
    norm = float(np.linalg.norm(feature))
    if norm == 0:
        raise AnalysisError("invalid_embedding")

    return {
        "embedding": (feature / norm).tolist(),
        "yaw_ratio": round(yaw_ratio(face), 4),
        "detection_score": round(float(face[14]), 4),
        "sharpness": round(sharpness, 1),
    }


@app.post("/v1/analyze", dependencies=[Depends(require_internal_token)])
def analyze_endpoint(body: AnalyzeRequest):
    start = time.perf_counter()
    try:
        result = analyze(decode_image(body.image))
        ANALYSES.labels(result="ok").inc()
        return {"ok": True, **result}
    except AnalysisError as e:
        ANALYSES.labels(result=e.reason).inc()
        # Erreur métier attendue : 200 avec ok=false pour que l'appelant décide
        return {"ok": False, "reason": e.reason}
    finally:
        LATENCY.observe(time.perf_counter() - start)


@app.get("/health")
def health():
    return {"status": "healthy", "service": "face-service"}

