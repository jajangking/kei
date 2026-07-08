#include "server.h"
#include "pins.h"
#include "wifi.h"
#include "config.h"
#include "page_index.h"
#include <WiFi.h>
#include <ArduinoJson.h>

WebServer http(80);
WebSocketsServer ws(81);

void wsBroadcast(String msg) { ws.broadcastTXT(msg); }
void wsSend(uint8_t client, String msg) { ws.sendTXT(client, msg); }

void wsLog(String msg) {
  ws.broadcastTXT("{\"type\":\"log\",\"msg\":\"" + msg + "\"}");
  Serial.println(msg);
}

// ─── Captive portal HTML ──────────────────────────────────────
static String portalHTML() {
  String apIP = wifiState == WIFI_AP ? cachedAPIP : cachedIP;
  String html = R"rawliteral(
<!DOCTYPE html><html><head>
<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>KEI Setup</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e4e4e7;font-family:monospace;display:flex;justify-content:center;padding:2rem 1rem;min-height:100vh}
.card{max-width:480px;width:100%}
h1{color:#f59e0b;font-size:1.5rem;margin-bottom:.25rem}
.sub{color:#71717a;font-size:.75rem;margin-bottom:1.5rem}
.section{background:#18181b;border:1px solid #27272a;border-radius:12px;padding:1rem;margin-bottom:1rem}
.section h2{color:#a1a1aa;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem}
select,input[type=password],input[type=text]{width:100%;background:#09090b;border:1px solid #27272a;border-radius:8px;padding:.6rem .75rem;color:#e4e4e7;font:inherit;font-size:.8rem;outline:none;margin-bottom:.5rem}
select:focus,input:focus{border-color:#f59e0b}
button{width:100%;background:#f59e0b;color:#09090b;border:none;border-radius:8px;padding:.7rem;font:inherit;font-weight:bold;font-size:.85rem;cursor:pointer;transition:opacity .15s}
button:active{opacity:.7}button:disabled{opacity:.4;cursor:default}
.net-list{max-height:200px;overflow-y:auto;margin-bottom:.5rem}
.net-item{padding:.4rem .5rem;border-radius:6px;cursor:pointer;font-size:.75rem;display:flex;justify-content:space-between;transition:background .15s}
.net-item:hover,.net-item.selected{background:#27272a}
.net-item .name{color:#e4e4e7}
.net-item .rssi{color:#71717a}
.lock{color:#f59e0b;margin-left:.3rem}
#status{text-align:center;font-size:.75rem;color:#71717a;margin-top:.75rem}
.spinner{display:inline-block;width:12px;height:12px;border:2px solid #71717a;border-top-color:#f59e0b;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:.4rem}
@keyframes spin{to{transform:rotate(360deg)}}
.info{font-size:.7rem;color:#52525b;margin-top:.4rem;text-align:center}
</style></head><body>
<div class=card>
<h1>⚡ KEI Setup</h1>
<p class=sub>IP: )rawliteral" + apIP + R"rawliteral( &middot; MAC: )rawliteral" + WiFi.macAddress() + R"rawliteral(</p>
<div class=section>
<h2>WiFi Network</h2>
<select id=net-list size=5 class=net-list><option value>Scanning...</option></select>
<button onclick=scan() disabled id=scan-btn>⟳ Scan</button>
</div>
<div class=section>
<h2>Connect</h2>
<input type=text id=ssid placeholder="SSID" readonly onclick="pickNet()">
<input type=password id=pass placeholder="Password" onkeydown="if(event.key=='Enter')connect()">
<button onclick=connect() id=conn-btn>Connect</button>
<div id=status></div>
</div>
<p class=info>Setelah connect, ESP akan restart. Cari IP baru via <strong>kei.local</strong> di browser.</p>
</div>
<script>
function $(id){return document.getElementById(id)}
function scan(){
  var s=$('net-list'),b=$('scan-btn'); s.innerHTML='<option>Scanning...</option>'; b.disabled=true;
  fetch('/api/wifi/scan').then(function(r){return r.json()}).then(function(nets){
    s.innerHTML='';
    if(!nets.length){s.innerHTML='<option value>No networks found</option>';return}
    nets.forEach(function(n){
      var o=document.createElement('option');
      o.value=n.ssid; o.textContent=n.ssid+' '+(n.rssi>-50?'▂▄▆█':n.rssi>-70?'▂▄▆':n.rssi>-85?'▂▄':'▂');
      if(n.encryption!=0)o.textContent+=' 🔒';
      s.appendChild(o);
    });
  }).catch(function(){s.innerHTML='<option value>Scan failed</option>'});
  b.disabled=false;
}
function pickNet(){var s=$('net-list');if(s.value)$('ssid').value=s.value;$('pass').focus()}
function connect(){
  var ssid=$('ssid').value.trim(),pass=$('pass').value.trim();
  if(!ssid){$('status').textContent='Isi SSID dulu';return}
  $('conn-btn').disabled=true;$('status').innerHTML='<span class=spinner></span>Connecting...';
  fetch('/api/wifi/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ssid:ssid,password:pass})})
  .then(function(r){return r.text()}).then(function(t){$('status').textContent=t})
  .catch(function(e){$('status').textContent='Error: '+e.message;$('conn-btn').disabled=false});
}
scan();
</script></body></html>)rawliteral";
  return html;
}

// ─── WiFi scan JSON ───────────────────────────────────────────
static String wifiScanJSON() {
  int n = WiFi.scanComplete();
  String j = "[";
  bool first = true;
  for (int i = 0; i < n; i++) {
    if (!first) j += ",";
    first = false;
    j += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i));
    j += ",\"encryption\":" + String(WiFi.encryptionType(i));
    j += ",\"channel\":" + String(WiFi.channel(i)) + "}";
  }
  j += "]";
  WiFi.scanDelete();
  return j;
}

// ─── Default routes ───────────────────────────────────────────
static void handleRoot() {
  if (wifiState == WIFI_AP) {
    http.send(200, "text/html", portalHTML());
  } else {
    http.send(200, "text/html", PAGE_INDEX);
  }
}
static void handlePortal() { http.send(200, "text/html", portalHTML()); }

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
  http.on("/portal", handlePortal);

  // WiFi captive portal / management
  http.on("/api/wifi/scan", []() {
    WiFi.scanNetworks(true);
    unsigned long t = millis();
    while (WiFi.scanComplete() < 0 && millis() - t < 10000) delay(10);
    http.send(200, "application/json", wifiScanJSON());
  });

  http.on("/api/wifi/configure", HTTP_POST, []() {
    if (!http.hasArg("plain")) { http.send(400, "text/plain", "no body"); return; }
    String body = http.arg("plain");
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, body);
    if (err) { http.send(400, "text/plain", "bad json"); return; }
    String ssid = doc["ssid"] | "";
    String pass = doc["password"] | "";
    if (ssid.length() == 0) { http.send(400, "text/plain", "ssid required"); return; }
    saveWifi(ssid, pass);
    http.send(200, "text/plain", "Credentials saved, rebooting...");
    delay(200);
    ESP.restart();
  });

  http.on("/api/wifi/status", []() {
    String mode = wifiState == WIFI_AP ? "ap" : (wifiState == WIFI_CONNECTED ? "sta" : "connecting");
    String j = "{\"mode\":\"" + mode + "\",\"ip\":\"" + cachedIP + "\",\"rssi\":" + String(cachedRssi);
    j += ",\"ssid\":\"" + (wifiState == WIFI_CONNECTED ? wifiCfg.ssid : "") + "\",\"mac\":\"" + WiFi.macAddress() + "\"}";
    http.send(200, "application/json", j);
  });

  // Captive portal: catch-all untuk redirect ke portal
  http.onNotFound([]() {
    if (wifiState == WIFI_AP) {
      http.send(200, "text/html", portalHTML());
    } else {
      http.send(404, "text/plain", "not found");
    }
  });

  http.on("/version", []() {
    http.send(200, "application/json", "{\"fw\":\"" + String(FW_VERSION) + "\"}");
  });

  http.on("/cmd", []() {
    extern String getSensorDiagnostic();
    extern String getMPUDiagnostic();
    extern String scanI2C();
    extern bool isSensorReady();
    extern bool isMPUReady();
    String j = "{\"vl\":" + String(isSensorReady() ? "true" : "false");
    j += ",\"mpu\":" + String(isMPUReady() ? "true" : "false");
    j += ",\"vl_diag\":\"" + getSensorDiagnostic() + "\"";
    j += ",\"mpu_diag\":\"" + getMPUDiagnostic() + "\"";
    j += ",\"i2c_scan\":\"" + scanI2C() + "\"}";
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

  http.on("/diag", []() {
    extern String getSensorDiagnostic();
    extern String getMPUDiagnostic();
    extern String scanI2C();
    extern bool isSensorReady();
    extern bool isMPUReady();
    String s = getSensorDiagnostic();
    String m = getMPUDiagnostic();
    String i2c = scanI2C();
    String body = R"rawliteral(
<!DOCTYPE html><html><head>
<meta charset=utf-8><meta http-equiv=refresh content=3>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Diagnostic</title>
<style>
body{background:#111;color:#eee;font-family:monospace;padding:1rem;font-size:14px}
h2{color:#f59e0b}
pre{background:#1a1a1a;padding:1rem;border-radius:6px;border:1px solid #333;overflow:auto}
.ok{color:#22c55e}.fail{color:#ef4444}
</style></head><body>
<h2>🔍 Sensor Diagnostic</h2>
<p>VL53L0X: )rawliteral" + String(isSensorReady() ? "<span class=ok>OK</span>" : "<span class=fail>FAIL</span>") + R"rawliteral(
 &nbsp; MPU6050: )rawliteral" + String(isMPUReady() ? "<span class=ok>OK</span>" : "<span class=fail>FAIL</span>") + R"rawliteral(</p>
<pre>)rawliteral" + s + "\n\n" + m + "\n\n" + i2c + R"rawliteral(</pre>
<p><small>Auto-refresh setiap 3 detik</small></p>
</body></html>
)rawliteral";
    http.send(200, "text/html", body);
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
