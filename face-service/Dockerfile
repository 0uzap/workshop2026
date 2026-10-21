FROM python:3.12-slim AS models

# Modèles OpenCV Zoo figés sur un commit et vérifiés par empreinte SHA-256
ARG ZOO_COMMIT=48b10fa505aeb51fbd127fc60a5c660040e823b7
ADD --checksum=sha256:8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4 \
    https://github.com/opencv/opencv_zoo/raw/${ZOO_COMMIT}/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
    /models/face_detection_yunet_2023mar.onnx
ADD --checksum=sha256:0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79 \
    https://github.com/opencv/opencv_zoo/raw/${ZOO_COMMIT}/models/face_recognition_sface/face_recognition_sface_2021dec.onnx \
    /models/face_recognition_sface_2021dec.onnx

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODELS_DIR=/app/models

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 555 : le dossier doit être traversable (x) par l'utilisateur non-root
COPY --from=models --chmod=555 /models ./models
COPY app ./app

RUN useradd --system --uid 10001 face
USER 10001

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-server-header"]
