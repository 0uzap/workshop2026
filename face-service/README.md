# face-service

Microservice interne (Python / FastAPI / OpenCV) d'analyse faciale, appelé
uniquement par auth-service. **Sans état** : ne stocke ni image ni gabarit.

- Détection : [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) (230 Ko)
- Reconnaissance : [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) (38 Mo), embedding 128-d normalisé

Les modèles sont téléchargés au build Docker, figés sur un commit d'OpenCV Zoo
et vérifiés par SHA-256. Aucun accès Internet n'est nécessaire à l'exécution
(réseau `face-network` en mode `internal`). Modèles légers, exécutés sur CPU :
compatibles avec la RAM du PC Hôte.

## API

`POST /v1/analyze` — en-tête `X-Internal-Token` requis.

```json
{ "image": "<JPEG ou PNG en base64>" }
```

Réponse : `{ "ok": true, "embedding": [128 floats], "yaw_ratio": 0.51, "detection_score": 0.93, "sharpness": 412.0 }`
ou `{ "ok": false, "reason": "..." }` avec `no_face`, `multiple_faces`,
`face_too_small`, `too_blurry`, `low_confidence`, `invalid_image`,
`unsupported_format` ou `image_too_large`.

`yaw_ratio` : position du nez entre les deux yeux (0.5 = de face). Image non
miroir : tourner la tête vers sa gauche augmente le ratio.

`GET /health` — sonde de santé. Métriques Prometheus sur le port interne 9093
(`face_analysis_total{result}`, `face_analysis_duration_seconds`).

## Résultats mesurés (images d'exemple OpenCV)

| Comparaison | Similarité cosinus |
|---|---|
| Même visage, recadré / redimensionné | 0.84 |
| Même visage, retourné horizontalement | 0.92 |
| Deux personnes différentes | 0.13 |

Seuil retenu côté auth-service : 0.40.

## Tests

```bash
pip install -r requirements.txt pytest httpx
MODELS_DIR=/chemin/vers/models pytest
```
