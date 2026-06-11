#include "wifi.h"
#include "config.h"
#include <WiFi.h>
#include <ESPmDNS.h>

String cachedIP = "";
int cachedRssi = 0;
bool wifiConnecting = false;

static unsigned long connectStart = 0;
static unsigned long lastAttempt = 0;

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin(wifiCfg.ssid.c_str(), wifiCfg.pass.c_str());
  wifiConnecting = true;
  connectStart = millis();
}

void handleWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiConnecting) {
      wifiConnecting = false;
      cachedIP = WiFi.localIP().toString();
      cachedRssi = WiFi.RSSI();
      Serial.printf("[WIFI] connected %s (%d dBm)\n", cachedIP.c_str(), cachedRssi);
      MDNS.begin("kei");
    }
    return;
  }
  if (!wifiConnecting) {
    wifiConnecting = true;
    connectStart = millis();
  }
  if (millis() - lastAttempt > 10000) {
    lastAttempt = millis();
    WiFi.disconnect();
    WiFi.begin(wifiCfg.ssid.c_str(), wifiCfg.pass.c_str());
  }
}
