# Architecture de la plateforme

Plateforme de paiement fictive, conteneurisée (Docker Compose), conçue pour
encaisser un incident de sécurité et se rétablir sans intervention humaine.

## Services

| Service | Rôle | Réseau |
|---|---|---|
| `waf` | ModSecurity CRS devant le frontal, seule entrée exposée | front |
| `frontend` | Frontal React/Tailwind (back-office + poste d'authentification) | front |
| `backend` | API de paiement (Node.js), métriques Prometheus | front, data, obs |
| `auth-service` | Authentification (mot de passe + visage), habilitations | front, data, obs, face |
| `face-service` | Analyse faciale (YuNet + SFace), interne, sans état | face (isolé) |
| `mysql` | Base de données | data (interne) |
| `prometheus` | Métriques | obs |
| `grafana` | Tableaux de bord et alertes (SOC) | obs |
| `loki` + `alloy` | Journaux centralisés | obs |
| `ml-detector` | Détection d'anomalie (Isolation Forest) | obs |
| `remediation` | Moteur de reprise autonome | obs + proxys Docker |

## Authentification du back-office

Poste d'authentification à la caméra USB du PC Hôte : saisie de l'identifiant,
reconnaissance faciale (visage de face puis rotation de tête imposée, preuve de
vie), puis mot de passe. Une LED bicolore ESP8266 signale l'état. Deux échecs
bloquent l'identifiant 5 minutes. Rôles : administrateur, opérateur, auditeur.

## Sécurité

- Segmentation réseau : bases et services internes jamais exposés ; le WAF est
  la seule entrée.
- Secrets chiffrés avec SOPS + age.
- Gabarits biométriques chiffrés (AES-256-GCM), aucune image conservée.
- Proxys Docker à privilèges séparés : lecture seule pour Alloy, actions
  restreintes (restart/start/kill) pour la remédiation.

## Observabilité

Prometheus récupère les métriques des services (API, auth, face, ML,
remédiation). Grafana présente les tableaux de bord sécurité et résilience.
Loki centralise les journaux via Alloy. Le SIEM/SOC s'appuie sur ces journaux
et sur des alertes (ex. pic de blocages WAF).
