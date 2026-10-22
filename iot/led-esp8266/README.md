# led-esp8266

Module LED bicolore (rouge/vert) du poste d'authentification du back-office,
sur ESP8266. Projet **PlatformIO**, développé avec **JetBrains CLion** (plugin
PlatformIO).

## Comportement

L'ESP8266 se connecte en WiFi au point d'accès du PC Hôte (RESILIENCE-G<n>)
et interroge `GET http://192.168.137.1:<port>/api/iot/led` toutes les 250 ms.
Il affiche l'état commandé par auth-service :

| État | LED | Déclencheur |
|---|---|---|
| `off` | éteinte | par défaut |
| `green_blink` | vert clignotant | visage reconnu, attente du mot de passe |
| `green_on` | vert fixe 30 s | mot de passe validé |
| `red_on` | rouge fixe 30 s | visage non reconnu |
| `red_blink` | 10 clignotements rouges | mot de passe incorrect |

Sans réponse du serveur pendant 5 s, la LED s'éteint.

## Câblage

LED bicolore à cathode commune, une résistance de 220 Ω sur chaque anode :

| LED | NodeMCU / D1 mini |
|---|---|
| anode rouge | D1 (GPIO5) |
| anode verte | D2 (GPIO4) |
| cathode commune | GND |

LED à anode commune : relier l'anode à 3V3 et passer `LED_ACTIVE_LOW` à `true`
dans `src/main.cpp`.

## Configuration

```powershell
Copy-Item include\secrets.example.h include\secrets.h
```

Renseigner dans `include/secrets.h` (fichier ignoré par git) :

- `WIFI_SSID` / `WIFI_PASSWORD` : point d'accès sans fil mobile du PC Hôte ;
- `SERVER_PORT` : valeur de `FRONTEND_PORT` du `.env` (8080 par défaut) ;
- `DEVICE_TOKEN` : valeur de `IOT_DEVICE_TOKEN` du `.env`.

## Compilation et téléversement

Dans CLion : *File › Open* sur ce dossier (le plugin PlatformIO détecte
`platformio.ini`), puis cibles *Upload* et *Monitor*. En ligne de commande :

```bash
pio run -e nodemcuv2 -t upload     # ou -e d1_mini
pio device monitor
```

Le moniteur série affiche l'adresse IP obtenue et chaque changement d'état.

## Réseau

Le pare-feu Windows du PC Hôte doit autoriser les connexions entrantes sur
le port du frontal depuis le réseau du point d'accès (192.168.137.0/24).
L'état du module (en ligne / hors ligne) est visible dans l'onglet
*Poste & LED* du back-office.
