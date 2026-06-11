#ifndef SERVER_H
#define SERVER_H

#include <Arduino.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <ArduinoOTA.h>
#include <Update.h>

extern WebServer http;
extern WebSocketsServer ws;

void initServer();
void handleServer();
void wsBroadcast(String msg);
void wsSend(uint8_t client, String msg);
void wsLog(String msg);

#endif
