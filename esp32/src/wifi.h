#ifndef WIFI_HELPER_H
#define WIFI_HELPER_H

#include <Arduino.h>

extern String cachedIP;
extern int cachedRssi;
extern bool wifiConnecting;

void connectWiFi();
void handleWiFi();

#endif
