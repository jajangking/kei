#ifndef WIFI_HELPER_H
#define WIFI_HELPER_H

#include <Arduino.h>

enum WiFiState {
  WIFI_INIT,
  WIFI_CONNECTING,
  WIFI_CONNECTED,
  WIFI_AP,
};

extern WiFiState wifiState;
extern String cachedIP;
extern String cachedAPIP;
extern int cachedRssi;

void connectWiFi();
void handleWiFi();
void startAPMode();

#endif
