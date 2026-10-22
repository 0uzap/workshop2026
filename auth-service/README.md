# auth-service

Service d'authentification (Node.js / Express) et **poste d'authentification
du back-office** (consigne additionnelle 1) : identifiant, puis reconnaissance
faciale par la caméra USB du PC Hôte, puis mot de passe. Pilote aussi la LED
bicolore de l'ESP8266.

## Architecture

```
Navigateur ──► nginx (frontend) ──► auth-service ──► face-service (IA, réseau interne)
                                       │   ▲
                                       │   └── ESP8266 (GET /api/iot/led, WiFi RESILIENCE-G<n>)
                                       ▼
                          camera-agent (Windows natif, 127.0.0.1:8765)
                                       │
                                  caméra USB du PC Hôte
```

Le navigateur n'accède jamais à une webcam : c'est le serveur qui capture les
images sur la caméra du PC Hôte. Un client distant ne peut donc pas injecter
de photo ou de vidéo par l'API. Docker Desktop (WSL2) n'ayant pas accès aux
périphériques USB, la caméra est pilotée par un agent natif Windows
([camera-agent](../camera-agent/README.md)).

## Parcours de connexion au back-office

| Étape | Caméra | LED | Suite |
|---|---|---|---|
| Saisie de l'identifiant | s'allume | éteinte | analyse du flux (15 s max) |
| Visage reconnu (de face, puis tête tournée dans la direction tirée au hasard) | s'éteint | **vert clignotant** | saisie du mot de passe (2 min max) |
| Mot de passe correct | — | **vert fixe 30 s** puis éteinte | accès au back-office |
| Mot de passe incorrect | — | **rouge, 10 clignotements** puis éteinte | retour à l'identifiant (vidé) |
| Visage non reconnu | reste allumée 30 s puis s'éteint | **rouge fixe 30 s** | retour à l'identifiant (vidé) |

Deux échecs (visage ou mot de passe) → identifiant **bloqué 5 minutes**, et
ainsi de suite. Un identifiant inexistant suit exactement le même déroulé
qu'un visage non reconnu (pas d'énumération des comptes). Un seul poste, une
seule caméra : une identification à la fois (HTTP 409 sinon).

## Habilitations

| Rôle | Back-office | Permissions |
|---|---|---|
| `admin` | oui | utilisateurs (lecture/écriture), visages, déblocage, journal, poste, paiements |
| `operator` | oui | poste, paiements (lecture + transaction de test) |
| `auditor` | oui | utilisateurs (lecture), journal, poste, paiements (lecture) |
| `user` | non | client de l'API de paiement : connexion par mot de passe seul (`/api/auth/login`) |

- Les comptes du back-office **ne peuvent pas** se connecter par mot de passe seul (403).
- Le back-office exige un jeton `amr: ["face","pwd"]`. Le compte est relu en
  base à chaque requête : désactivation ou changement de rôle immédiats.
- Le dernier administrateur actif ne peut être ni rétrogradé ni désactivé.
- L'enrôlement d'un visage se fait depuis le back-office (administrateur),
  la personne étant devant la caméra du poste, avec son consentement.

### Création de compte

Depuis la page de connexion, lien **Créer un compte** : identifiant, mot de
passe, consentement, puis capture du visage par la caméra du PC Hôte (la
personne doit être physiquement devant le poste).

- **Premier compte** (aucun administrateur actif) : il devient administrateur
  et peut se connecter immédiatement. C'est l'amorçage du back-office.
- **Comptes suivants** : créés désactivés, *en attente de validation*. Un
  administrateur choisit leur rôle puis clique sur *Valider le compte*.
  Sans cela, n'importe qui pourrait s'octroyer un accès au back-office.

Alternative en ligne de commande pour le premier administrateur :
`docker exec -it resilience-auth node src/cli/bootstrap-admin.js`.

Mot de passe oublié : un administrateur le réinitialise depuis le back-office.

## API

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| POST | `/api/auth/terminal/identify` | public | `{username}` → allume la caméra, `{session_id, direction}` |
| GET | `/api/auth/terminal/state` | en-tête `X-Terminal-Session` | Avancement (`identifying`, `awaiting_password`, `rejected`…) |
| GET | `/api/auth/terminal/frame` | `X-Terminal-Session` | Image JPEG de la caméra pendant l'identification |
| POST | `/api/auth/terminal/password` | `X-Terminal-Session` | `{password}` → jeton d'accès `amr: ["face","pwd"]` |
| POST | `/api/auth/terminal/cancel` | `X-Terminal-Session` | Abandon (étape du mot de passe ou création de compte) |
| POST | `/api/auth/terminal/register/start` | public | `{username}` → vérifie la disponibilité, allume la caméra |
| POST | `/api/auth/terminal/register` | `X-Terminal-Session` | `{password, consent: true}` → capture le visage, crée le compte |
| GET | `/api/auth/admin/me` | back-office | Compte et permissions |
| GET/POST | `/api/auth/admin/users` | `users:read` / `users:write` | Liste / création |
| PATCH | `/api/auth/admin/users/:id` | `users:write` | `{role?, is_active?, password?}` |
| POST | `/api/auth/admin/users/:id/unlock` | `locks:manage` | Lève le blocage de 5 min |
| POST | `/api/auth/admin/users/:id/face/session` | `faces:manage` | Allume la caméra pour l'enrôlement |
| GET | `/api/auth/admin/face/frame` | `faces:manage` + `X-Terminal-Session` | Retour caméra pendant l'enrôlement |
| POST | `/api/auth/admin/users/:id/face` | `faces:manage` | `{session_id, consent: true}` → capture 3 images |
| POST | `/api/auth/admin/face/cancel` | `faces:manage` | `{session_id}` → éteint la caméra |
| DELETE | `/api/auth/admin/users/:id/face` | `faces:manage` | Suppression du gabarit (droit à l'effacement) |
| GET | `/api/auth/admin/audit` | `audit:read` | 200 derniers événements |
| GET | `/api/auth/admin/terminal` | `terminal:read` | État du poste, de l'agent caméra et de la LED |
| GET | `/api/iot/led` | en-tête `X-Device-Token` | État LED `{mode, seq}` pour l'ESP8266 |
| POST | `/api/auth/register`, `/api/auth/login` | public | Clients de l'API de paiement (rôle `user`) |

## Mesures de sécurité

| Menace | Mesure |
|---|---|
| Photo / vidéo injectée par un client | Capture côté serveur sur la caméra physique du PC Hôte uniquement |
| Photo imprimée devant la caméra | Rotation de tête dans une direction tirée au hasard par le serveur |
| Force brute (visage ou mot de passe) | 2 échecs → blocage 5 min par identifiant, limitation de débit par IP |
| Énumération d'identifiants | Déroulé et durée identiques pour un identifiant inconnu |
| Mot de passe saisi sans visage | Session serveur : mot de passe refusé tant que le visage n'est pas reconnu |
| Vol de la base | Gabarit chiffré AES-256-GCM lié à l'utilisateur (AAD), aucune image conservée |
| Accès à la caméra depuis le réseau | Agent sur 127.0.0.1 uniquement + jeton ; caméra coupée après 45 s d'inactivité |
| Abus du face-service | Pas de port publié, réseau Docker `internal`, jeton partagé, conteneur read-only |
| Usurpation du module LED | Jeton d'appareil ; l'ESP8266 ne fait que lire un état (aucune commande) |

**Choix de disponibilité :** si l'agent caméra ou le face-service tombe,
l'accès au back-office est impossible (fail-closed) ; l'erreur n'est pas
comptée comme un échec d'authentification. L'API de paiement reste utilisable
par les clients (`/api/auth/login`).

## Observabilité

- Journal d'audit : JSON sur stdout → Alloy → Loki (ex. `{container="resilience-auth"} | json | event=~"terminal.*"`)
  et table `auth_events` (onglet *Journal* du back-office). Ni mot de passe, ni jeton, ni image, ni gabarit.
- Métriques Prometheus (port interne 9092) : `auth_attempts_total{step,result}`,
  `iot_led_last_seen_timestamp_seconds` (module LED hors ligne).

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `JWT_SECRET` | — | Secret JWT (≥ 32 caractères) |
| `FACE_SERVICE_TOKEN` | — | Jeton partagé avec face-service |
| `FACE_TEMPLATE_KEY` | — | Clé AES-256 des gabarits (64 caractères hex) |
| `CAMERA_AGENT_URL` | `http://host.docker.internal:8765` | Agent caméra du PC Hôte |
| `CAMERA_AGENT_TOKEN` | — | Jeton partagé avec l'agent caméra |
| `IOT_DEVICE_TOKEN` | — | Jeton du module ESP8266 |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_SECONDS` | `2` / `300` | Règle de blocage |
| `TERMINAL_VERIFY_WINDOW_MS` | `15000` | Durée maximale de l'analyse du visage |
| `FACE_MATCH_THRESHOLD` | `0.40` | Similarité minimale de face (réf. OpenCV SFace : 0.363) |
| `FACE_TURNED_THRESHOLD` | `0.30` | Similarité minimale tête tournée |
| `FACE_FRONTAL_TOLERANCE` / `FACE_TURN_MIN` | `0.15` / `0.18` | Tolérances de pose |

Générer un secret : `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`
(clé des gabarits : `randomBytes(32).toString('hex')`).

## Tests

```bash
npm install
npm test
```

`test/terminal.test.js` vérifie les règles de la consigne (LED, caméra,
blocage, poste unique…) sur la machine d'états avec caméra et base simulées.

## Limites connues

- Preuve de vie active mais simple (rotation de tête) : bloque une photo, pas
  une vidéo rejouée sur écran ou un masque. En contexte industriel : détection
  d'attaque de présentation certifiée (ISO/IEC 30107-3), caméra infrarouge.
- L'ESP8266 dialogue en HTTP (pas de TLS) sur le WiFi WPA2 du point d'accès ;
  il ne fait que lire un état, l'impact d'une interception est limité.
- L'état du poste est en mémoire : un redémarrage d'auth-service annule
  l'identification en cours (les blocages, eux, sont en base).
- Secrets dans `.env` : à migrer vers Vault/SOPS.
