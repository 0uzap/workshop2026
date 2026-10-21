# camera-agent

Agent natif Windows qui pilote la **caméra USB du PC Hôte** pour le poste
d'authentification du back-office.

Pourquoi hors de Docker : Docker Desktop (WSL2) n'a pas accès aux
périphériques USB comme les webcams. L'agent tourne donc directement sous
Windows ; auth-service (conteneur) le contacte via `host.docker.internal`.

## Sécurité

- Écoute **uniquement sur 127.0.0.1** : injoignable depuis le réseau
  RESILIENCE-G<n> (PC Attaquant compris).
- Chaque appel exige le jeton `CAMERA_AGENT_TOKEN` (en-tête `X-Agent-Token`).
- La caméra n'est allumée qu'à la demande d'auth-service et s'éteint seule
  après 45 s sans sollicitation (`CAMERA_IDLE_TIMEOUT`).
- Aucune image n'est écrite sur disque.

## Démarrage

Prérequis : Python 3.10+ sur le PC Hôte. Le script crée un environnement
virtuel au premier lancement et lit `CAMERA_AGENT_TOKEN` / `CAMERA_INDEX`
dans le `.env` à la racine du projet.

```powershell
# Trouver l'index de la caméra USB (la webcam intégrée est souvent 0, l'USB 1)
powershell -ExecutionPolicy Bypass -File camera-agent\start-agent.ps1 -List

# Démarrer l'agent (laisser la fenêtre ouverte)
powershell -ExecutionPolicy Bypass -File camera-agent\start-agent.ps1
```

Renseigner ensuite `CAMERA_INDEX` dans `.env` puis redémarrer l'agent.

## API (127.0.0.1:8765, jeton requis)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/v1/camera/start` | Allume la caméra |
| POST | `/v1/camera/stop` | Éteint la caméra |
| GET | `/v1/frame` | Dernière image (JPEG) |
| GET | `/health` | État de l'agent et de la caméra |
