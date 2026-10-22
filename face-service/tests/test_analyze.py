"""
Tests du face-service, à lancer en local avec les modèles ONNX téléchargés
(voir README) :

    pip install -r requirements.txt pytest httpx
    MODELS_DIR=/chemin/vers/models pytest
"""

import base64
import os

import cv2
import numpy as np
import pytest

TOKEN = "t" * 32
os.environ["FACE_SERVICE_TOKEN"] = TOKEN

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, yaw_ratio  # noqa: E402

client = TestClient(app)
HEADERS = {"X-Internal-Token": TOKEN}


def jpeg_b64(img):
    return base64.b64encode(cv2.imencode(".jpg", img)[1].tobytes()).decode()


def analyze(image, headers=HEADERS):
    return client.post("/v1/analyze", json={"image": image}, headers=headers)


def test_rejects_missing_or_wrong_token():
    img = jpeg_b64(np.zeros((200, 200, 3), np.uint8))
    assert analyze(img, headers={}).status_code == 401
    assert analyze(img, headers={"X-Internal-Token": "x" * 32}).status_code == 401


def test_image_without_face():
    res = analyze(jpeg_b64(np.full((300, 300, 3), 127, np.uint8)))
    assert res.json() == {"ok": False, "reason": "no_face"}


def test_rejects_non_image_payload():
    payload = base64.b64encode(b"GIF89a" + b"\0" * 200).decode()
    assert analyze(payload).json()["reason"] == "unsupported_format"


def test_rejects_invalid_base64():
    assert analyze("!" * 200).json()["reason"] == "invalid_image"


def test_yaw_ratio_direction():
    # x, y, w, h, oeil droit (x, y), oeil gauche (x, y), nez (x, y), ...
    face = np.zeros(15, np.float32)
    face[4], face[6] = 100, 160
    face[8] = 130
    assert yaw_ratio(face) == pytest.approx(0.5)
    face[8] = 150  # nez vers la droite de l'image : tête tournée vers sa gauche
    assert yaw_ratio(face) > 0.5


def test_health():
    assert client.get("/health").json()["status"] == "healthy"
