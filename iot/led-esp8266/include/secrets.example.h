// Copier ce fichier en secrets.h (ignoré par git) et renseigner les valeurs.
#pragma once

// Point d'accès sans fil mobile du PC Hôte
#define WIFI_SSID "RESILIENCE-G1"
#define WIFI_PASSWORD "change-me"

// PC Hôte sur le réseau du point d'accès, port publié du frontal (FRONTEND_PORT)
#define SERVER_HOST "192.168.137.1"
#define SERVER_PORT 8080

// Même valeur que IOT_DEVICE_TOKEN dans le .env du PC Hôte
#define DEVICE_TOKEN "change-me-with-at-least-32-random-characters"
