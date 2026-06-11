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
    String page = R"rawliteral(
<!DOCTYPE html><html><head>
<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>OTA Update</title>
<style>
body{background:#111;color:#eee;font-family:monospace;padding:2rem}
h2{color:#f59e0b}
input,button{background:#222;color:#eee;border:1px solid #444;padding:8px 16px;font:inherit;border-radius:6px}
button{background:#f59e0b;color:#111;font-weight:bold;cursor:pointer;margin-top:1rem}
button:disabled{opacity:.4}
#status{margin-top:1rem;color:#888;font-size:14px}
</style></head><body>
<h2>⬆ OTA Update</h2>
<form id=f action=/upload method=post enctype=multipart/form-data>
<input type=file name=firmware accept=.bin required>
<button id=b type=submit>Upload & Flash</button>
</form>
<div id=status></div>
<script>
var f=document.getElementById('f'),b=document.getElementById('b'),s=document.getElementById('status');
f.onsubmit=function(e){
  e.preventDefault();
  var fd=new FormData(f);
  b.disabled=true; b.textContent='Uploading...'; s.textContent='Uploading firmware...';
  fetch('/upload',{method:'POST',body:fd}).then(function(r){return r.text()}).then(function(t){
    s.textContent=t; b.textContent='Done';
  }).catch(function(e){
    s.textContent='Error: '+e.message; b.disabled=false; b.textContent='Upload & Flash';
  });
};
</script></body></html>
)rawliteral";
    http.send(200, "text/html", page);
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
      if (Update.end(true)) Update.printError(Serial);
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
