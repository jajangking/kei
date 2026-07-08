#include "wifi.h"
#include "config.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <DNSServer.h>

WiFiState wifiState = WIFI_STATE_INIT;
String cachedIP = "";
String cachedAPIP = "";
int cachedRssi = 0;

static unsigned long connectStart = 0;
static unsigned long lastAttempt = 0;
static unsigned long apTimeout = 0;
static bool hasSavedCreds = false;
static DNSServer dnsServer;

static const unsigned long STA_TIMEOUT = 15000;
static const unsigned long AP_TIMEOUT = 300000; // 5 menit AP, lalu restart & coba lagi

void connectWiFi() {
  wifiState = WIFI_STATE_CONNECTING;
  connectStart = millis();
  cachedIP = "";
  hasSavedCreds = false;

  String ssid = wifiCfg.ssid;
  String pass = wifiCfg.pass;
  if (ssid.length() > 0) {
    hasSavedCreds = true;
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(WIFI_PS_NONE);
    WiFi.setAutoReconnect(true);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
    WiFi.begin(ssid.c_str(), pass.c_str());
    Serial.printf("[WIFI] connecting to '%s'...\n", ssid.c_str());
  } else {
    Serial.println("[WIFI] no saved credentials, starting AP");
    startAPMode();
  }
}

void startAPMode() {
    wifiState = WIFI_STATE_AP;
  apTimeout = millis();

  String apName = "KEI-" + WiFi.macAddress();
  apName.replace(":", "");
  apName = apName.substring(0, 11);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str(), "12345678");
  delay(100);
  cachedAPIP = WiFi.softAPIP().toString();
  cachedIP = cachedAPIP;
  Serial.printf("[WIFI] AP mode: '%s' IP: %s\n", apName.c_str(), cachedAPIP.c_str());

  dnsServer.start(53, "*", WiFi.softAPIP());
  MDNS.begin("kei");

  Serial.println("[WIFI] captive portal active — connect & open any URL");
}

void handleWiFi() {
  switch (wifiState) {
    case WIFI_STATE_INIT:
      connectWiFi();
      break;

    case WIFI_STATE_CONNECTING: {
      if (WiFi.status() == WL_CONNECTED) {
        wifiState = WIFI_STATE_CONNECTED;
        cachedIP = WiFi.localIP().toString();
        cachedRssi = WiFi.RSSI();
        Serial.printf("[WIFI] connected %s (%d dBm)\n", cachedIP.c_str(), cachedRssi);
        if (!MDNS.begin("kei")) Serial.println("[WIFI] mDNS failed");
        else {
          MDNS.addService("http", "tcp", 80);
          Serial.println("[WIFI] mDNS: kei.local");
        }
        return;
      }
      unsigned long elapsed = millis() - connectStart;
      if (elapsed > STA_TIMEOUT) {
        Serial.printf("[WIFI] timeout (%lu ms)", elapsed);
        if (hasSavedCreds) {
          Serial.println(", starting AP");
          startAPMode();
        } else {
          startAPMode();
        }
      }
      break;
    }

    case WIFI_STATE_CONNECTED:
      if (WiFi.status() != WL_CONNECTED) {
  wifiState = WIFI_STATE_CONNECTING;
        connectStart = millis();
        Serial.println("[WIFI] disconnected, reconnecting...");
        WiFi.reconnect();
      } else {
        cachedRssi = WiFi.RSSI();
      }
      break;

    case WIFI_STATE_AP:
      dnsServer.processNextRequest();
      if (millis() - apTimeout > AP_TIMEOUT) {
        Serial.println("[WIFI] AP timeout, retrying STA...");
        WiFi.softAPdisconnect(true);
        dnsServer.stop();
        connectWiFi();
      }
      break;
  }
}
