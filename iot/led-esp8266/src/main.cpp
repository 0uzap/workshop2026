/*
 * Module LED bicolore (rouge/vert) du poste d'authentification du back-office.
 *
 * L'ESP8266 se connecte au point d'accès RESILIENCE-G<n> et interroge
 * auth-service (GET /api/iot/led) plusieurs fois par seconde. Il ne fait
 * qu'afficher l'état commandé par le serveur :
 *
 *   off          éteinte (par défaut)
 *   green_blink  vert clignotant : visage reconnu, attente du mot de passe
 *   green_on     vert fixe : mot de passe validé (30 s, durée gérée par le serveur)
 *   red_on       rouge fixe : visage non reconnu (30 s, durée gérée par le serveur)
 *   red_blink    10 clignotements rouges : mot de passe incorrect, puis éteinte
 *
 * Chaque changement d'état porte un numéro `seq` : la séquence finie des
 * 10 clignotements rouges est jouée une seule fois par changement.
 *
 * Câblage (LED bicolore à cathode commune, résistance 220 ohms sur chaque anode) :
 *   D1 (GPIO5) -> rouge, D2 (GPIO4) -> vert, cathode -> GND
 * Pour une LED à anode commune, passer LED_ACTIVE_LOW à true.
 */

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>

#include "secrets.h"

static const uint8_t RED_PIN = D1;
static const uint8_t GREEN_PIN = D2;
static const bool LED_ACTIVE_LOW = false;

static const unsigned long POLL_INTERVAL_MS = 250;
static const unsigned long BLINK_HALF_PERIOD_MS = 300;
static const int RED_BLINK_COUNT = 10;
// Sans nouvelles du serveur, la LED s'éteint (pas d'état périmé affiché)
static const unsigned long SERVER_TIMEOUT_MS = 5000;

enum class Mode { Off, GreenBlink, GreenOn, RedOn, RedBlink };

static Mode mode = Mode::Off;
static long currentSeq = -1;
static unsigned long modeStartedAt = 0;
static unsigned long lastPoll = 0;
static unsigned long lastServerContact = 0;

static void writeLed(bool red, bool green) {
  digitalWrite(RED_PIN, red != LED_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(GREEN_PIN, green != LED_ACTIVE_LOW ? HIGH : LOW);
}

static Mode parseMode(const char *value) {
  if (strcmp(value, "green_blink") == 0) return Mode::GreenBlink;
  if (strcmp(value, "green_on") == 0) return Mode::GreenOn;
  if (strcmp(value, "red_on") == 0) return Mode::RedOn;
  if (strcmp(value, "red_blink") == 0) return Mode::RedBlink;
  return Mode::Off;
}

static void applyState(Mode newMode, long seq) {
  // Le mode est aussi comparé : la numérotation repart de 0 si le serveur redémarre
  if (seq == currentSeq && newMode == mode) return;
  currentSeq = seq;
  mode = newMode;
  modeStartedAt = millis();
  Serial.printf("LED -> mode %d (seq %ld)\n", static_cast<int>(mode), seq);
}

// Rendu non bloquant : appelé à chaque tour de boucle
static void renderLed() {
  const unsigned long elapsed = millis() - modeStartedAt;
  const bool blinkPhaseOn = (elapsed / BLINK_HALF_PERIOD_MS) % 2 == 0;

  switch (mode) {
    case Mode::GreenBlink:
      writeLed(false, blinkPhaseOn);
      break;
    case Mode::GreenOn:
      writeLed(false, true);
      break;
    case Mode::RedOn:
      writeLed(true, false);
      break;
    case Mode::RedBlink:
      if (elapsed < 2UL * RED_BLINK_COUNT * BLINK_HALF_PERIOD_MS) {
        writeLed(blinkPhaseOn, false);
      } else {
        writeLed(false, false);
      }
      break;
    case Mode::Off:
    default:
      writeLed(false, false);
  }
}

static void pollServer() {
  WiFiClient client;
  HTTPClient http;

  http.setTimeout(1500);
  if (!http.begin(client, SERVER_HOST, SERVER_PORT, "/api/iot/led")) return;
  http.addHeader("X-Device-Token", DEVICE_TOKEN);

  const int status = http.GET();
  if (status == HTTP_CODE_OK) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      applyState(parseMode(doc["mode"] | "off"), doc["seq"] | -1L);
      lastServerContact = millis();
    }
  } else {
    Serial.printf("Serveur : HTTP %d\n", status);
  }

  http.end();
}

static void connectWifi() {
  Serial.printf("Connexion au WiFi %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print('.');
  }
  Serial.printf("\nConnecté, IP %s\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  writeLed(false, false);

  WiFi.setAutoReconnect(true);
  connectWifi();
}

void loop() {
  const unsigned long now = millis();

  if (WiFi.status() == WL_CONNECTED && now - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = now;
    pollServer();
  }

  if (mode != Mode::Off && now - lastServerContact > SERVER_TIMEOUT_MS) {
    mode = Mode::Off;
    currentSeq = -1;
  }

  renderLed();
  delay(10);
}
