#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include <Update.h>
#include <Wire.h>
#include "sensors.h"
#include "autonomy.h"

#define JSON_DOC(x) JsonDocument

#define FW_VERSION "1.0.0-http - " __DATE__ " " __TIME__

#define LED_PIN 2

String wifiSsid = "STARLINK";
String wifiPass = "12345678910";

bool wifiConnecting = false;
unsigned long wifiConnectStart = 0;
unsigned long lastWifiAttempt = 0;

WebServer httpServer(80);

#define PWMA 25
#define AIN1 26
#define AIN2 27
#define PWMB 13
#define BIN1 14
#define BIN2 33
#define STBY 32
#define BUZZER 4
#define CH_LEFT 0
#define CH_RIGHT 1
#define CH_BUZZER 2

#define TELEMETRY_INTERVAL 1000
static String cachedIP = "";
static int cachedRssi = 0;

unsigned long startTime = 0;
unsigned long lastTelemetry = 0;
unsigned long lastCommandTime = 0;
unsigned long lastLedToggle = 0;

int targetLeftSpeed = 0;
int targetRightSpeed = 0;
int currentLeftSpeed = 0;
int currentRightSpeed = 0;

bool ledState = false;
bool emergencyStop = false;
bool safetyActive = false;

int maxSpeed = 255;
int rampRate = 255;
int motorTimeout = 300;
bool powerSave = false;
bool speedLimitEnabled = false;
int speedLimit = 100;
int leftTrim = 0;
int rightTrim = 0;
bool initialized = false;
String deviceName = "";
bool deviceNameConfigured = false;
bool otaError = false;

void handleMessage(String msg);
void stopMotors();
void writeMotorA(int speed);
void writeMotorB(int speed);
void rampMotors();
String buildTelemetryJson();
void updateLED();
void connectWiFi();
void handleWiFi();
void handleRoot();
const char PAGE_INDEX[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width,initial-scale=1,user-scalable=no'>
<title>Kei Robot</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a1a;color:#eee;padding:6px;height:100dvh;overflow:hidden;display:flex;flex-direction:column;gap:4px;user-select:none;-webkit-user-select:none}
h1{font-size:14px;color:#e94560;text-align:center;flex-shrink:0;padding:2px 0;letter-spacing:1px}
.sb{font-size:10px;color:#555;text-align:center;flex-shrink:0;padding:1px 0}
.sb span{color:#e94560}
.row{display:flex;gap:5px;flex:1;min-height:0}
.jw{flex:1;background:#11112a;border-radius:10px;display:flex;align-items:center;justify-content:center;touch-action:none;min-height:140px}
.jb{width:130px;height:130px;border-radius:50%;background:#1a1a3e;position:relative;box-shadow:inset 0 0 20px rgba(0,0,0,.5)}
.jn{width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#e94560,#b02040);position:absolute;top:42px;left:42px;box-shadow:0 0 15px rgba(233,69,96,.25);pointer-events:none;transition:none}
.tl{width:120px;flex-shrink:0;background:#11112a;border-radius:10px;padding:8px;font-size:10px;display:flex;flex-direction:column;gap:2px;overflow-y:auto}
.tl .l{color:#555;display:inline-block;width:32px}.tl .v{color:#ddd}
.btn{display:block;padding:8px 4px;border:none;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;text-align:center;transition:opacity .1s;flex:1;line-height:1.2}
.btn:active{opacity:.5}
.br{background:#b0302a;color:#fff}.bg{background:#27ae60;color:#fff}.bb{background:#2980b9;color:#fff}
.bo{background:#a04020;color:#fff}.bk{background:#2c3e50;color:#ccc}.bp{background:#6a1b9a;color:#fff}.bw{background:#b8860b;color:#fff}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px}
.lk{text-align:center;font-size:9px;flex-shrink:0;padding:2px 0}
.lk a{color:#444;text-decoration:none;margin:0 5px}
.lk a:hover{color:#e94560}
.hide{display:none!important}
</style>
</head>
<body>

<h1>⚡ KEI ROBOT</h1>
<div class=sb id=sb>IP: <span id=ip>...</span> · RSSI: <span id=rssi>...</span> dBm · <span id=ver>...</span></div>

<div class=row>
  <div class=jw id=jw>
    <div class=jb id=jb>
      <div class=jn id=jn></div>
    </div>
  </div>
  <div class=tl id=tl>
    <div><span class=l>Mode</span><span class=v id=mode>...</span></div>
    <div><span class=l>Speed</span><span class=v id=speed>0</span></div>
    <div><span class=l>Jarak</span><span class=v id=dist>---</span></div>
    <div><span class=l>Yaw</span><span class=v id=yaw>0.0</span></div>
    <div><span class=l>Servo</span><span class=v id=servo>90</span></div>
    <div><span class=l>RSSI</span><span class=v id=rssi2>--</span></div>
  </div>
</div>

<div class=g2 id=emergencyRow>
  <button class='btn bg hide' id=btnRelease>RELEASE</button>
  <button class='btn br' id=btnEmergency>EMERGENCY STOP</button>
</div>

<div class=g2>
  <button class='btn bb' id=btnExplore>🤖 Explore</button>
  <button class='btn bk' id=btnManual>⏹ Manual</button>
</div>

<div class=g3>
  <button class='btn bo' id=btnFwd>▲</button>
  <button class='btn bo' id=btnLeft>◀</button>
  <button class='btn bo' id=btnRight>▶</button>
</div>

<div class=g3>
  <button class='btn bo' id=btnRev>▼</button>
  <button class='btn bk' id=btnServoL>◄</button>
  <button class='btn bk' id=btnServoR>►</button>
</div>

<div class=g3>
  <button class='btn bk' id=btnStop>■ STOP</button>
  <button class='btn bp' id=btnCenter>● 90</button>
  <button class='btn bw' id=btnYawReset>⟳ Yaw</button>
</div>

<div class=lk>
  <a href=/config>⚙ Config</a>
  <a href=/update>⬆ OTA</a>
</div>

<script>
(function(){
var $=function(id){return document.getElementById(id)};
var BASE_R=65,NUB_R=23,MAX_R=BASE_R-NUB_R-2;
var jb=$('jb'),jn=$('jn');
var dragging=false,joyL=0,joyR=0,lastL=0,lastR=0,thr=0;
var lastEmerg=false;

function pos(e){
  var r=jb.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  var t=e.touches?e.touches[0]:e;
  return {dx:t.clientX-cx,dy:t.clientY-cy};
}
function nub(dx,dy){
  var d=Math.sqrt(dx*dx+dy*dy);
  if(d>MAX_R){dx=dx/d*MAX_R;dy=dy/d*MAX_R;}
  jn.style.left=(BASE_R-NUB_R+dx)+'px';
  jn.style.top=(BASE_R-NUB_R+dy)+'px';
  var ny=-dy/MAX_R,nx=dx/MAX_R;
  joyL=Math.round(Math.max(-255,Math.min(255,(ny-nx)*255)));
  joyR=Math.round(Math.max(-255,Math.min(255,(ny+nx)*255)));
}
function send(){
  if(joyL===lastL&&joyR===lastR)return;
  lastL=joyL;lastR=joyR;
  var x=new XMLHttpRequest();
  x.open('POST','/cmd',true);
  x.setRequestHeader('Content-Type','application/json');
  x.send(JSON.stringify({leftMotor:joyL,rightMotor:joyR}));
}
function cmd(o){
  var x=new XMLHttpRequest();
  x.open('POST','/cmd',true);
  x.setRequestHeader('Content-Type','application/json');
  x.send(JSON.stringify(o));
}

jb.addEventListener('touchstart',function(e){e.preventDefault();dragging=true;var p=pos(e);nub(p.dx,p.dy);send();},{passive:false});
document.addEventListener('touchmove',function(e){if(!dragging)return;var n=Date.now();if(n-thr<40)return;thr=n;e.preventDefault();var p=pos(e);nub(p.dx,p.dy);send();},{passive:false});
document.addEventListener('touchend',function(){if(!dragging)return;dragging=false;jn.style.left=(BASE_R-NUB_R)+'px';jn.style.top=(BASE_R-NUB_R)+'px';joyL=0;joyR=0;send();});
document.addEventListener('touchcancel',function(){if(!dragging)return;dragging=false;jn.style.left=(BASE_R-NUB_R)+'px';jn.style.top=(BASE_R-NUB_R)+'px';joyL=0;joyR=0;send();});
jb.addEventListener('mousedown',function(e){dragging=true;var p=pos(e);nub(p.dx,p.dy);send();});
document.addEventListener('mousemove',function(e){if(!dragging)return;var n=Date.now();if(n-thr<40)return;thr=n;var p=pos(e);nub(p.dx,p.dy);send();});
document.addEventListener('mouseup',function(){if(!dragging)return;dragging=false;jn.style.left=(BASE_R-NUB_R)+'px';jn.style.top=(BASE_R-NUB_R)+'px';joyL=0;joyR=0;send();});

// Buttons
['btnFwd','btnRev','btnLeft','btnRight'].forEach(function(id){
  var el=$(id);
  var m={btnFwd:[200,200],btnRev:[-200,-200],btnLeft:[-150,150],btnRight:[150,-150]}[id];
  el.addEventListener('touchstart',function(e){e.preventDefault();cmd({leftMotor:m[0],rightMotor:m[1]});});
  el.addEventListener('touchend',function(e){e.preventDefault();cmd({leftMotor:0,rightMotor:0});});
  el.addEventListener('mousedown',function(){cmd({leftMotor:m[0],rightMotor:m[1]});});
  el.addEventListener('mouseup',function(){cmd({leftMotor:0,rightMotor:0});});
  el.addEventListener('mouseleave',function(){cmd({leftMotor:0,rightMotor:0});});
});
$('btnStop').addEventListener('click',function(){cmd({leftMotor:0,rightMotor:0});});
$('btnExplore').addEventListener('click',function(){cmd({behavior:'explore'});});
$('btnManual').addEventListener('click',function(){cmd({behavior:'stop'});});
$('btnEmergency').addEventListener('click',function(){cmd({emergency:true});});
$('btnRelease').addEventListener('click',function(){cmd({emergency:false});});
$('btnCenter').addEventListener('click',function(){cmd({servo:90});});
$('btnServoL').addEventListener('click',function(){cmd({servo:0});});
$('btnServoR').addEventListener('click',function(){cmd({servo:180});});
$('btnYawReset').addEventListener('click',function(){cmd({headingReset:true});});

// Telemetry poll
function poll(){
  fetch('/telemetry').then(function(r){return r.json()}).then(function(d){
    $('ip').textContent=d.ip;$('rssi').textContent=d.rssi;$('ver').textContent=d.fw;
    $('mode').textContent=d.mode+(d.behavior!='stop'?' ('+d.behavior+')':'');
    $('speed').textContent=d.speed;$('dist').textContent=d.distance+' mm';
    $('yaw').textContent=d.yaw.toFixed(1)+'\u00b0';
    $('servo').textContent=d.servo+'/';$('rssi2').textContent=d.rssi+' dBm';
    // Emergency toggle
    if(d.emergency!==lastEmerg){
      lastEmerg=d.emergency;
      if(d.emergency){$('btnEmergency').classList.add('hide');$('btnRelease').classList.remove('hide');}
      else{$('btnEmergency').classList.remove('hide');$('btnRelease').classList.add('hide');}
    }
  }).catch(function(){});
}
setInterval(poll,1000);poll();
})();
</script>
</body>
</html>
)rawliteral";
void handleConfig();
void saveRuntimeConfig();
void loadRuntimeConfig();
void savePowerSaveConfig();
void loadPowerSaveConfig();
void saveSpeedLimitConfig();
void loadSpeedLimitConfig();
void saveWiFiConfig(String ssid, String pass);
void loadWiFiConfig();
void saveDeviceNameConfig(String name);
void loadDeviceNameConfig();
void applyPowerSave();
void applyPowerSaveSafe();
void playStartupMelody();

void saveRuntimeConfig() {
  Preferences prefs;
  prefs.begin("runtime", false);
  prefs.putInt("maxSpeed", maxSpeed);
  prefs.putInt("rampRate", rampRate);
  prefs.putInt("motorTimeout", motorTimeout);
  prefs.putInt("leftTrim", leftTrim);
  prefs.putInt("rightTrim", rightTrim);
  prefs.end();
}

void loadRuntimeConfig() {
  Preferences prefs;
  prefs.begin("runtime", false);
  maxSpeed = prefs.getInt("maxSpeed", 255);
  rampRate = prefs.getInt("rampRate", 255);
  motorTimeout = prefs.getInt("motorTimeout", 300);
  leftTrim = prefs.getInt("leftTrim", 0);
  rightTrim = prefs.getInt("rightTrim", 0);
  prefs.end();
}

void savePowerSaveConfig() {
  Preferences prefs;
  prefs.begin("pwr", false);
  prefs.putBool("save", powerSave);
  prefs.end();
}

void loadPowerSaveConfig() {
  Preferences prefs;
  prefs.begin("pwr", false);
  powerSave = prefs.getBool("save", false);
  prefs.end();
}

void saveSpeedLimitConfig() {
  Preferences prefs;
  prefs.begin("sl", false);
  prefs.putBool("enabled", speedLimitEnabled);
  prefs.putInt("limit", speedLimit);
  prefs.end();
}

void loadSpeedLimitConfig() {
  Preferences prefs;
  prefs.begin("sl", false);
  speedLimitEnabled = prefs.getBool("enabled", false);
  speedLimit = prefs.getInt("limit", 150);
  prefs.end();
}

void loadWiFiConfig() {
  Preferences prefs;
  prefs.begin("wifi", false);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  prefs.end();
  if (ssid.length() > 0) { wifiSsid = ssid; wifiPass = pass; }
}

void saveWiFiConfig(String ssid, String pass) {
  Preferences prefs;
  prefs.begin("wifi", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  wifiSsid = ssid; wifiPass = pass;
}

void saveDeviceNameConfig(String name) {
  Preferences prefs;
  prefs.begin("dname", false);
  prefs.putString("name", name);
  prefs.end();
  deviceName = name;
  deviceNameConfigured = name.length() > 0;
}

void loadDeviceNameConfig() {
  Preferences prefs;
  prefs.begin("dname", false);
  String name = prefs.getString("name", "");
  prefs.end();
  if (name.length() > 0) { deviceName = name; deviceNameConfigured = true; }
}

void applyPowerSave() {
  if (powerSave) { WiFi.setSleep(WIFI_PS_MIN_MODEM); setCpuFrequencyMhz(80); }
  else { WiFi.setSleep(WIFI_PS_NONE); setCpuFrequencyMhz(240); }
}

void applyPowerSaveSafe() { savePowerSaveConfig(); ESP.restart(); }

void connectWiFi() {
  loadWiFiConfig();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  wifiConnecting = true;
  wifiConnectStart = millis();
}

void handleWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiConnecting) {
      wifiConnecting = false;
      cachedIP = WiFi.localIP().toString();
      cachedRssi = WiFi.RSSI();
      Serial.println("WiFi connected: " + cachedIP + " (" + String(cachedRssi) + " dBm)");
    }
    initialized = true;
    return;
  }
  if (initialized) {
    wifiConnecting = true;
    if (millis() - lastWifiAttempt > 10000) {
      lastWifiAttempt = millis();
      WiFi.disconnect();
      WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    }
    return;
  }

  initialized = true;
  pinMode(AIN1, OUTPUT); pinMode(AIN2, OUTPUT);
  pinMode(BIN1, OUTPUT); pinMode(BIN2, OUTPUT);
  digitalWrite(AIN1, LOW); digitalWrite(AIN2, LOW);
  digitalWrite(BIN1, LOW); digitalWrite(BIN2, LOW);
  pinMode(STBY, OUTPUT); digitalWrite(STBY, LOW);
  delay(500);
  digitalWrite(STBY, HIGH);
  ledcSetup(CH_LEFT, 1000, 8); ledcAttachPin(PWMA, CH_LEFT);
  ledcSetup(CH_RIGHT, 1000, 8); ledcAttachPin(PWMB, CH_RIGHT);
  stopMotors();
  loadRuntimeConfig(); loadPowerSaveConfig(); loadSpeedLimitConfig(); loadDeviceNameConfig();
  applyPowerSave();
  connectWiFi();
  MDNS.begin("kei");

  httpServer.on("/", handleRoot);
  httpServer.on("/config", handleConfig);
  httpServer.on("/version", []() {
    httpServer.send(200, "application/json", "{\"fw\":\"" + String(FW_VERSION) + "\"}");
  });

  httpServer.on("/ping", []() {
    String j = "{\"pong\":true,\"ip\":\"" + cachedIP + "\",\"rssi\":" + String(cachedRssi) + ",\"fw\":\"" + String(FW_VERSION) + "\"}";
    httpServer.send(200, "application/json", j);
  });

  httpServer.on("/telemetry", []() {
    httpServer.send(200, "application/json", buildTelemetryJson());
  });

  httpServer.on("/cmd", []() {
    if (httpServer.hasArg("plain")) {
      handleMessage(httpServer.arg("plain"));
      httpServer.send(200, "text/plain", "ok");
    } else {
      httpServer.send(400, "text/plain", "no body");
    }
  });

  httpServer.on("/update", []() {
    String html = F(
      "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>Kei OTA Update</title>"
      "<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#1a1a2e;color:#fff;padding:16px}"
      "h1{font-size:20px;text-align:center;color:#e94560;margin-bottom:16px}"
      ".sec{background:#16213e;border-radius:10px;padding:16px}"
      "label{display:block;font-size:14px;margin-bottom:8px}"
      "input[type=file]{width:100%;padding:10px;background:#0f3460;border:1px solid #1a3a6a;border-radius:6px;color:#fff}"
      ".btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;margin-top:12px}"
      ".btn-primary{background:#e94560;color:#fff}"
      ".status{margin-top:12px;padding:10px;border-radius:6px;display:none;text-align:center}"
      ".nav{margin-top:12px;text-align:center;font-size:12px}"
      ".nav a{color:#e94560;text-decoration:none}"
      "</style></head><body>"
      "<h1>Firmware Update</h1>"
      "<div class=sec>"
      "<label>Pilih file .bin firmware</label>"
      "<form id=form method=POST action=/upload enctype=multipart/form-data>"
      "<input type=file name=firmware accept='.bin' required>"
      "<button class='btn btn-primary' type=submit>Upload</button>"
      "</form>"
      "<div id=status class=status></div>"
      "</div>"
      "<div class=nav><a href='https://github.com/jajangking/kei/releases/latest' target=_blank>Download firmware dari GitHub</a></div>"
      "<script>document.getElementById('form').onsubmit=function(e){"
      "e.preventDefault();var f=new FormData(this);var s=document.getElementById('status');"
      "s.style.display='block';s.style.background='#0f3460';s.textContent='Uploading...';"
      "var x=new XMLHttpRequest();x.upload.onprogress=function(e){if(e.lengthComputable){"
      "s.textContent=Math.round(e.loaded/e.total*100)+'% uploaded';}};"
      "x.onload=function(){s.textContent=x.responseText;s.style.background=x.status==200?'#00a86b':'#e94560';};"
      "x.onerror=function(){s.textContent='Upload failed';s.style.background='#e94560';};"
      "x.open('POST','/upload');x.send(f);};</script>"
      "</body></html>"
    );
    httpServer.send(200, "text/html", html);
  });

  httpServer.on("/upload", HTTP_POST, []() {
    httpServer.send(200, "text/plain", "Firmware updated! Rebooting...");
    delay(1000);
    ESP.restart();
  }, []() {
    HTTPUpload& upload = httpServer.upload();
    if (upload.status == UPLOAD_FILE_START) {
      otaError = false; stopMotors();
      if (!Update.begin(UPDATE_SIZE_UNKNOWN)) { Update.printError(Serial); otaError = true; }
    } else if (upload.status == UPLOAD_FILE_WRITE) {
      if (otaError) return;
      if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) { Update.printError(Serial); otaError = true; }
    } else if (upload.status == UPLOAD_FILE_END) {
      if (otaError) { Update.end(false); Serial.println("OTA FAILED"); return; }
      if (Update.end(true)) { Serial.printf("OTA success: %u bytes\n", upload.totalSize); }
      else { Update.printError(Serial); }
    }
  });

  httpServer.begin();
  ArduinoOTA.onStart([]() { stopMotors(); });
  ArduinoOTA.begin();
  Serial.println("ESP32 ready — HTTP-only");
}

void loop() {
  ArduinoOTA.handle();
  httpServer.handleClient();
  handleWiFi();

  if (WiFi.status() != WL_CONNECTED) { stopMotors(); return; }

  if (!emergencyStop && lastCommandTime > 0 && millis() - lastCommandTime > motorTimeout) {
    targetLeftSpeed = 0; targetRightSpeed = 0;
  }

  if (!emergencyStop) {
    int autoL = 0, autoR = 0;
    tickAutonomy(&autoL, &autoR);
    if (getBehavior() != "stop") { targetLeftSpeed = autoL; targetRightSpeed = autoR; }
  }

  int obstacleDist = readDistance();
  safetyActive = (!emergencyStop && obstacleDist > 0 && obstacleDist < getSafetyThreshold());
  readMPU6050();

  if (!emergencyStop) rampMotors();

  if (safetyActive) { ledcWrite(CH_LEFT, 0); ledcWrite(CH_RIGHT, 0); currentLeftSpeed = 0; currentRightSpeed = 0; }

  if (millis() - lastTelemetry > TELEMETRY_INTERVAL) {
    lastTelemetry = millis();
    cachedRssi = WiFi.RSSI();
  }

  updateLED();
}

void handleMessage(String msg) {
  JSON_DOC(512) doc;
  DeserializationError error = deserializeJson(doc, msg);
  if (error) { Serial.println("JSON parse error: " + String(error.c_str())); return; }

  if (doc["emergency"].is<bool>()) {
    emergencyStop = doc["emergency"].as<bool>();
    if (emergencyStop) {
      stopMotors();
      if (getBehavior() != "stop") setBehavior("stop");
    } else {
      stopMotors();
      lastCommandTime = millis();
    }
    return;
  }

  if (doc["leftTrim"].is<int>()) leftTrim = constrain(doc["leftTrim"].as<int>(), -100, 100);
  if (doc["rightTrim"].is<int>()) rightTrim = constrain(doc["rightTrim"].as<int>(), -100, 100);

  if (doc["safeDist"].is<int>()) { setSafetyThreshold(constrain(doc["safeDist"].as<int>(), 30, 2000)); return; }

  bool configChanged = false;
  if (doc["maxSpeed"].is<int>()) { maxSpeed = constrain(doc["maxSpeed"].as<int>(), 0, 255); configChanged = true; }
  if (doc["rampRate"].is<int>()) { rampRate = constrain(doc["rampRate"].as<int>(), 1, 50); configChanged = true; }
  if (doc["motorTimeout"].is<int>()) { motorTimeout = max(doc["motorTimeout"].as<int>(), 0); configChanged = true; }
  if (doc["powerSave"].is<bool>()) { powerSave = doc["powerSave"].as<bool>(); configChanged = true; applyPowerSaveSafe(); }
  if (doc["speedLimitEnabled"].is<bool>()) { speedLimitEnabled = doc["speedLimitEnabled"].as<bool>(); configChanged = true; }
  if (doc["speedLimit"].is<int>()) { speedLimit = constrain(doc["speedLimit"].as<int>(), 0, 255); configChanged = true; }
  if (configChanged) { saveRuntimeConfig(); saveSpeedLimitConfig(); }

  if (doc["ssid"].is<String>() && doc["password"].is<String>()) {
    saveWiFiConfig(doc["ssid"].as<String>(), doc["password"].as<String>());
    delay(100); ESP.restart(); return;
  }

  if (doc["behavior"].is<String>()) {
    String b = doc["behavior"].as<String>();
    if (b == "explore" || b == "stop") setBehavior(b);
    return;
  }

  if (doc["headingReset"] == true) { resetYaw(); return; }
  if (doc["servo"].is<int>()) { setServoAngle(constrain(doc["servo"].as<int>(), 0, 180)); return; }

  if (doc["deviceName"].is<String>()) { saveDeviceNameConfig(doc["deviceName"].as<String>()); return; }
  if (doc["reboot"] == true) { delay(100); ESP.restart(); return; }

  if (doc["factoryReset"] == true) {
    Preferences prefs;
    prefs.begin("runtime", false); prefs.clear(); prefs.end();
    prefs.begin("pwr", false); prefs.clear(); prefs.end();
    prefs.begin("sl", false); prefs.clear(); prefs.end();
    prefs.begin("dname", false); prefs.clear(); prefs.end();
    prefs.begin("wifi", false); prefs.clear(); prefs.end();
    delay(100); ESP.restart(); return;
  }

  if (doc["leftMotor"].is<int>() || doc["rightMotor"].is<int>()) {
    if (emergencyStop) return;
    if (getBehavior() != "stop") setBehavior("stop");
    int cap = speedLimitEnabled ? speedLimit : maxSpeed;
    int leftVal = (doc["leftMotor"] | 0) + leftTrim;
    targetLeftSpeed = constrain(leftVal, -cap, cap);
    int rightVal = (doc["rightMotor"] | 0) + rightTrim;
    targetRightSpeed = constrain(rightVal, -cap, cap);
    lastCommandTime = millis();
  }
}

void rampMotors() {
  if (rampRate >= 255) {
    if (currentLeftSpeed != targetLeftSpeed || currentRightSpeed != targetRightSpeed) {
      currentLeftSpeed = targetLeftSpeed; currentRightSpeed = targetRightSpeed;
      writeMotorA(currentLeftSpeed); writeMotorB(currentRightSpeed);
    }
    return;
  }
  auto step = [](int &cur, int tgt, int rate) {
    if (cur == tgt) return;
    int s = (tgt > cur) ? rate : -rate; cur += s;
    if (abs(cur - tgt) < rate) cur = tgt;
    cur = constrain(cur, -255, 255);
  };
  if (currentLeftSpeed != targetLeftSpeed) { step(currentLeftSpeed, targetLeftSpeed, rampRate); writeMotorA(currentLeftSpeed); }
  if (currentRightSpeed != targetRightSpeed) { step(currentRightSpeed, targetRightSpeed, rampRate); writeMotorB(currentRightSpeed); }
}

#define MIN_PWM 30

void writeMotorA(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    if (speed < MIN_PWM) { digitalWrite(AIN1, LOW); digitalWrite(AIN2, LOW); ledcWrite(CH_LEFT, 0); return; }
    digitalWrite(AIN1, HIGH); digitalWrite(AIN2, LOW); ledcWrite(CH_LEFT, speed);
  } else if (speed < 0) {
    if (-speed < MIN_PWM) { digitalWrite(AIN1, LOW); digitalWrite(AIN2, LOW); ledcWrite(CH_LEFT, 0); return; }
    digitalWrite(AIN1, LOW); digitalWrite(AIN2, HIGH); ledcWrite(CH_LEFT, -speed);
  } else { digitalWrite(AIN1, LOW); digitalWrite(AIN2, LOW); ledcWrite(CH_LEFT, 0); }
}

void writeMotorB(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    if (speed < MIN_PWM) { digitalWrite(BIN1, LOW); digitalWrite(BIN2, LOW); ledcWrite(CH_RIGHT, 0); return; }
    digitalWrite(BIN1, HIGH); digitalWrite(BIN2, LOW); ledcWrite(CH_RIGHT, speed);
  } else if (speed < 0) {
    if (-speed < MIN_PWM) { digitalWrite(BIN1, LOW); digitalWrite(BIN2, LOW); ledcWrite(CH_RIGHT, 0); return; }
    digitalWrite(BIN1, LOW); digitalWrite(BIN2, HIGH); ledcWrite(CH_RIGHT, -speed);
  } else { digitalWrite(BIN1, LOW); digitalWrite(BIN2, LOW); ledcWrite(CH_RIGHT, 0); }
}

void stopMotors() {
  targetLeftSpeed = 0; targetRightSpeed = 0;
  currentLeftSpeed = 0; currentRightSpeed = 0;
  writeMotorA(0); writeMotorB(0);
}

void updateLED() {
  unsigned long now = millis();
  if (emergencyStop) {
    if (now - lastLedToggle > 100) { lastLedToggle = now; ledState = !ledState; digitalWrite(LED_PIN, ledState); }
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastLedToggle > 200) { lastLedToggle = now; ledState = !ledState; digitalWrite(LED_PIN, ledState); }
    return;
  }
  digitalWrite(LED_PIN, HIGH);
}

String buildTelemetryJson() {
  String mode = emergencyStop ? "emergency" : (getBehavior() != "stop" ? "auto" : "manual");
  int avgSpeed = (abs(currentLeftSpeed) + abs(currentRightSpeed)) / 2;
  String j; j.reserve(512);
  j = "{\"mode\":\"" + mode + "\"";
  j += ",\"speed\":" + String(avgSpeed);
  j += ",\"left\":" + String(currentLeftSpeed);
  j += ",\"right\":" + String(currentRightSpeed);
  j += ",\"leftTrim\":" + String(leftTrim);
  j += ",\"rightTrim\":" + String(rightTrim);
  j += ",\"powerSave\":" + String(powerSave ? "true" : "false");
  j += ",\"emergency\":" + String(emergencyStop ? "true" : "false");
  j += ",\"rampRate\":" + String(rampRate);
  j += ",\"speedLimitEnabled\":" + String(speedLimitEnabled ? "true" : "false");
  j += ",\"speedLimit\":" + String(speedLimit);
  j += ",\"maxSpeed\":" + String(maxSpeed);
  j += ",\"motorTimeout\":" + String(motorTimeout);
  j += ",\"ip\":\"" + cachedIP + "\"";
  j += ",\"ssid\":\"" + wifiSsid + "\"";
  j += ",\"deviceName\":\"" + deviceName + "\"";
  j += ",\"fw\":\"" + String(FW_VERSION) + "\"";
  j += ",\"distance\":" + String(readDistance());
  j += ",\"sensor_ok\":" + String(isSensorReady() ? "true" : "false");
  j += ",\"safeDist\":" + String(getSafetyThreshold());
  j += ",\"mpu_ok\":" + String(isMPUReady() ? "true" : "false");
  j += ",\"roll\":" + String(round(getRoll() * 10) / 10);
  j += ",\"pitch\":" + String(round(getPitch() * 10) / 10);
  j += ",\"yaw\":" + String(round(getYaw() * 10) / 10);
  j += ",\"gyroZ\":" + String(round(getGyroZ() * 10) / 10);
  j += ",\"servo\":" + String(getServoAngle());
  j += ",\"behavior\":\"" + getBehavior() + "\"";
  j += ",\"rssi\":" + String(cachedRssi);
  j += ",\"heap\":" + String(ESP.getFreeHeap());
  j += ",\"uptime\":" + String((millis() - startTime) / 1000);
  j += "}";
  return j;
}

void handleRoot() {
  httpServer.send(200, "text/html", PAGE_INDEX);
}

void handleConfig() {
  String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Kei Config</title>"
    "<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#1a1a2e;color:#fff;padding:16px}"
    "h1{font-size:20px;text-align:center;color:#e94560;margin-bottom:16px}"
    ".sec{background:#16213e;border-radius:10px;padding:12px;margin-bottom:12px}"
    ".sec h2{font-size:14px;color:#e94560;margin-bottom:10px}"
    "label{display:block;font-size:12px;color:#aaa;margin:8px 0 3px}"
    "input{width:100%;padding:10px;background:#0f3460;border:1px solid #1a3a6a;border-radius:6px;color:#fff;font-size:14px}"
    ".btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;margin-top:8px}"
    ".btn-primary{background:#e94560;color:#fff}"
    ".btn-danger{background:#ff6b6b;color:#fff}"
    ".chk{display:flex;align-items:center;gap:8px;margin:8px 0}.chk input{width:auto}"
    "</style></head><body>"
    "<h1>Config</h1>"
    "<div class=sec>"
    "<h2>WiFi</h2>"
    "<label>SSID</label><input id=ssid>"
    "<label>Password</label><input id=pass type=password>"
    "<button class='btn btn-primary' onclick=\"var s=document.getElementById('ssid').value;var p=document.getElementById('pass').value;fetch('/cmd',{method:'POST',body:JSON.stringify({ssid:s,password:p})})\">Simpan & Reboot</button>"
    "</div>"
    "<div class=sec>"
    "<h2>Motor</h2>"
    "<label>Max Speed (0-255)</label><input id=maxSpeed type=number min=0 max=255>"
    "<label>Motor Timeout (ms)</label><input id=motorTimeout type=number min=0>"
    "<label>Left Trim</label><input id=leftTrim type=number min=-100 max=100>"
    "<label>Right Trim</label><input id=rightTrim type=number min=-100 max=100>"
    "<label class=chk><input id=speedLimitEnabled type=checkbox> Speed Limit</label>"
    "<label>Speed Limit (0-255)</label><input id=speedLimit type=number min=0 max=255>"
    "<button class='btn btn-primary' onclick=\"var d={};d.maxSpeed=document.getElementById('maxSpeed').value;d.motorTimeout=document.getElementById('motorTimeout').value;d.leftTrim=document.getElementById('leftTrim').value;d.rightTrim=document.getElementById('rightTrim').value;d.speedLimitEnabled=document.getElementById('speedLimitEnabled').checked;d.speedLimit=document.getElementById('speedLimit').value;fetch('/cmd',{method:'POST',body:JSON.stringify(d)})\">Simpan</button>"
    "</div>"
    "<div class=sec>"
    "<h2>Factory Reset</h2>"
    "<button class='btn btn-danger' onclick=\"fetch('/cmd',{method:'POST',body:JSON.stringify({factoryReset:true})})\">Hapus Semua & Reboot</button>"
    "</div>"
    "<script>fetch('/telemetry').then(r=>r.json()).then(function(d){"
    "document.getElementById('ssid').value=d.ssid;"
    "document.getElementById('maxSpeed').value=d.maxSpeed;"
    "document.getElementById('motorTimeout').value=d.motorTimeout;"
    "document.getElementById('leftTrim').value=d.leftTrim;"
    "document.getElementById('rightTrim').value=d.rightTrim;"
    "document.getElementById('speedLimitEnabled').checked=d.speedLimitEnabled;"
    "document.getElementById('speedLimit').value=d.speedLimit;"
    "})</script></body></html>";
  httpServer.send(200, "text/html", html);
}

void playStartupMelody() {
  ledcSetup(CH_BUZZER, 1047, 8); ledcWrite(CH_BUZZER, 128);
  delay(50);
  ledcWrite(CH_BUZZER, 0);
}

void setup() {
  Serial.begin(115200);
  startTime = millis();
  delay(100);
  pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW);
  ledcSetup(CH_BUZZER, 1000, 8); ledcAttachPin(BUZZER, CH_BUZZER); ledcWrite(CH_BUZZER, 0);
  playStartupMelody();
  Wire.begin(SENSOR_SDA, SENSOR_SCL); Wire.setClock(400000); Wire.setTimeout(50);
  initVL53L0X(); initMPU6050(); initAutonomy();
}