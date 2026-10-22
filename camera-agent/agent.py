"""
Agent caméra du PC Hôte.

Docker Desktop (WSL2) ne donne pas accès aux webcams USB : cet agent tourne
donc nativement sous Windows et pilote la caméra USB branchée sur le PC Hôte.
Il n'écoute que sur 127.0.0.1 (injoignable depuis le réseau RESILIENCE-G<n>) ;
auth-service le contacte via host.docker.internal avec un jeton partagé.

La caméra n'est allumée qu'à la demande d'auth-service, et s'éteint
d'elle-même après une période d'inactivité (sécurité).

Usage :
    python agent.py           # démarre l'agent
    python agent.py --list    # liste les caméras disponibles
"""

import argparse
import hmac
import logging
import os
import sys
import threading
import time

import cv2
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Response

HOST = os.getenv("CAMERA_AGENT_HOST", "127.0.0.1")
PORT = int(os.getenv("CAMERA_AGENT_PORT", "8765"))
TOKEN = os.getenv("CAMERA_AGENT_TOKEN", "")
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
IDLE_TIMEOUT = float(os.getenv("CAMERA_IDLE_TIMEOUT", "45"))

# DirectShow ouvre la caméra bien plus vite que Media Foundation sous Windows
BACKEND = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("camera-agent")


class Camera:
    def __init__(self, index):
        self.index = index
        self.lock = threading.Lock()
        self.capture = None
        self.thread = None
        self.running = False
        self.frame = None
        self.last_request = 0.0

    @property
    def active(self):
        return self.running

    def start(self):
        with self.lock:
            self.last_request = time.monotonic()
            if self.running:
                return

            capture = cv2.VideoCapture(self.index, BACKEND)
            if not capture.isOpened():
                capture.release()
                raise RuntimeError(f"Caméra {self.index} introuvable")

            capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

            self.capture = capture
            self.frame = None
            self.running = True
            self.thread = threading.Thread(target=self._loop, daemon=True)
            self.thread.start()
            log.info("camera %s ON", self.index)

    def stop(self):
        with self.lock:
            if not self.running:
                return
            self.running = False

        self.thread.join(timeout=2)
        self.capture.release()
        self.capture = None
        self.frame = None
        log.info("camera %s OFF", self.index)

    def latest_jpeg(self):
        self.last_request = time.monotonic()
        frame = self.frame
        if frame is None:
            return None
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return buf.tobytes() if ok else None

    def _loop(self):
        while self.running:
            ok, frame = self.capture.read()
            if ok:
                self.frame = frame
            else:
                time.sleep(0.05)

    def watchdog(self):
        # Coupe la caméra si auth-service ne la sollicite plus (crash, réseau…)
        while True:
            time.sleep(2)
            if self.running and time.monotonic() - self.last_request > IDLE_TIMEOUT:
                log.warning("camera idle for %ss, switching off", IDLE_TIMEOUT)
                self.stop()


camera = Camera(CAMERA_INDEX)
app = FastAPI(title="camera-agent", docs_url=None, redoc_url=None, openapi_url=None)


def require_token(x_agent_token: str = Header(default="")):
    if not hmac.compare_digest(x_agent_token.encode(), TOKEN.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.post("/v1/camera/start", dependencies=[Depends(require_token)])
def start():
    try:
        camera.start()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # Laisse le temps au capteur de livrer une première image exposée
    deadline = time.monotonic() + 3
    while camera.frame is None and time.monotonic() < deadline:
        time.sleep(0.05)

    return {"active": True}


@app.post("/v1/camera/stop", dependencies=[Depends(require_token)])
def stop():
    camera.stop()
    return {"active": False}


@app.get("/v1/frame", dependencies=[Depends(require_token)])
def frame():
    if not camera.active:
        raise HTTPException(status_code=409, detail="camera off")
    jpeg = camera.latest_jpeg()
    if jpeg is None:
        raise HTTPException(status_code=503, detail="no frame yet")
    return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/health", dependencies=[Depends(require_token)])
def health():
    return {"status": "healthy", "camera_index": CAMERA_INDEX, "camera_active": camera.active}


def list_cameras():
    for index in range(5):
        capture = cv2.VideoCapture(index, BACKEND)
        if capture.isOpened():
            ok, frame = capture.read()
            size = f"{frame.shape[1]}x{frame.shape[0]}" if ok else "pas d'image"
            print(f"  CAMERA_INDEX={index} : {size}")
        capture.release()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true", help="liste les caméras")
    args = parser.parse_args()

    if args.list:
        list_cameras()
        sys.exit(0)

    if len(TOKEN) < 32:
        sys.exit("CAMERA_AGENT_TOKEN doit contenir au moins 32 caractères")

    threading.Thread(target=camera.watchdog, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
