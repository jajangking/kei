#include "server.h"
#include "pins.h"
#include "wifi.h"
#include "page_index.h"

WebServer http(80);
WebSocketsServer ws(81);

static void handleRoot() { http.send(200, "text/html", PAGE_INDEX); }
static void handleVersion() { http.send(200, "application/json", "{\"fw\":\"" + String(FW_VERSION) + "\"}"); }

void wsBroadcast(String msg) { ws.broadcastTXT(msg); }
void wsSend(uint8_t client, String msg) { ws.sendTXT(client, msg); }

void wsLog(String msg) {
  ws.broadcastTXT("{\"type\":\"log\",\"msg\":\"" + msg + "\"}");
  Serial.println(msg);
}

static void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t len) {
  if (type == WStype_CONNECTED) {
    wsLog("[WS] client connected");
  } else if (type == WStype_DISCONNECTED) {
    wsLog("[WS] client disconnected");
  } else if (type == WStype_TEXT) {
    extern void handleMessage(const String &msg);
    handleMessage(String((char*)payload));
  }
}

void initServer() {
  http.on("/", handleRoot);
  http.on("/version", handleVersion);

  http.on("/cmd", []() {
    if (http.hasArg("plain")) {
      extern void handleMessage(const String &msg);
      handleMessage(http.arg("plain"));
      http.send(200, "text/plain", "ok");
    } else {
      http.send(400, "text/plain", "no body");
    }
  });

  http.on("/telemetry", []() {
    extern String buildTelemetryJson();
    http.send(200, "application/json", buildTelemetryJson());
  });

  http.on("/ping", []() {
    String j = "{\"pong\":true,\"ip\":\"" + cachedIP + "\",\"rssi\":" + String(cachedRssi) + ",\"fw\":\"" + String(FW_VERSION) + "\"}";
    http.send(200, "application/json", j);
  });

  http.on("/update", []() {
    http.send(200, "text/html", String(PAGE_INDEX)); // placeholder: real OTA page
  });

  http.on("/upload", HTTP_POST, []() {
    http.send(200, "text/plain", "Firmware updated, rebooting...");
    delay(1000);
    ESP.restart();
  }, []() {
    HTTPUpload &u = http.upload();
    if (u.status == UPLOAD_FILE_START) {
      if (!Update.begin(UPDATE_SIZE_UNKNOWN)) Update.printError(Serial);
    } else if (u.status == UPLOAD_FILE_WRITE) {
      if (Update.write(u.buf, u.currentSize) != u.currentSize) Update.printError(Serial);
    } else if (u.status == UPLOAD_FILE_END) {
      if (!Update.end(true)) Update.printError(Serial);
    }
  });

  http.begin();
  ws.begin();
  ws.enableHeartbeat(15000, 5000, 3);
  ws.onEvent(onWsEvent);

  ArduinoOTA.onStart([]() { extern void stopMotors(); stopMotors(); });
  ArduinoOTA.begin();
}

void handleServer() {
  http.handleClient();
  ws.loop();
  ArduinoOTA.handle();
}
