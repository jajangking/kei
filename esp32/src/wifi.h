#ifndef WIFI_HELPER_H
#define WIFI_HELPER_H

#include <Arduino.h>

enum WiFiState {
  WIFI_STATE_INIT,
  WIFI_STATE_CONNECTING,
  WIFI_STATE_CONNECTED,
  WIFI_STATE_AP,
};

extern WiFiState wifiState;
extern String cachedIP;
extern String cachedAPIP;
extern int cachedRssi;

void connectWiFi();
void handleWiFi();
void startAPMode();

#endif
