#include <WiFi.h>
#include <WebSocketsServer.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>

// =======================
// WIFI
// =======================

String wifiSsid = "STARLINK";
String wifiPass = "12345678910";

#define WIFI_TIMEOUT 15000
#define WIFI_MAX_POWER WIFI_POWER_19_5dBm

// =======================
// WEBSOCKET
// =======================

WebSocketsServer webSocket(81);

WebServer httpServer(80);

// =======================
// TB6612FNG PINS
// =======================

// LEFT MOTOR
#define PWMA 25
#define AIN1 26
#define AIN2 27

// RIGHT MOTOR
#define PWMB 13
#define BIN1 14
#define BIN2 12

// STBY
#define STBY 33

// =======================
// CONFIG
// =======================

int maxSpeed = 255;
int rampRate = 8;
int motorTimeout = 5000;
bool powerSave = false;

// =======================
// STATE
// =======================

unsigned long startTime = 0;
unsigned long lastTelemetry = 0;
unsigned long lastCommandTime = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastLedToggle = 0;

int targetLeftSpeed = 0;
int targetRightSpeed = 0;

int currentLeftSpeed = 0;
int currentRightSpeed = 0;

bool ledState = false;
bool emergencyStop = false;
bool wsConnected = false;

#define LED_PIN 2
#define TELEMETRY_INTERVAL 1000

// =======================
// POWER SAVE
// =======================

void applyPowerSave() {

if (powerSave) {

    WiFi.setSleep(true);

    setCpuFrequencyMhz(80);

    Serial.println("Power Save ON");

} else {

    WiFi.setSleep(false);

    setCpuFrequencyMhz(240);

    Serial.println("Power Save OFF");
}
}

// =======================
// WIFI CREDENTIALS
// =======================

void loadWiFiConfig() {

Preferences prefs;

prefs.begin("wifi", true);

String savedSsid = prefs.getString("ssid", "");

String savedPass = prefs.getString("pass", "");

prefs.end();

if (savedSsid.length() > 0) {

    wifiSsid = savedSsid;

    wifiPass = savedPass;

    Serial.print("WiFi Config Loaded: ");

    Serial.println(wifiSsid);
}
}

void saveWiFiConfig(String ssid, String pass) {

Preferences prefs;

prefs.begin("wifi", false);

prefs.putString("ssid", ssid);

prefs.putString("pass", pass);

prefs.end();

wifiSsid = ssid;

wifiPass = pass;

Serial.println("WiFi Config Saved");
}

// =======================
// WIFI CONNECT
// =======================

void connectWiFi() {

Serial.println();
Serial.println("Connecting WiFi...");

loadWiFiConfig();

WiFi.mode(WIFI_STA);

WiFi.setAutoReconnect(true);

WiFi.setTxPower(WIFI_MAX_POWER);

WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());

unsigned long startAttempt = millis();

while (WiFi.status() != WL_CONNECTED &&
       millis() - startAttempt < WIFI_TIMEOUT) {

    digitalWrite(LED_PIN, !digitalRead(LED_PIN));

    delay(300);

    Serial.print(".");
}

digitalWrite(LED_PIN, LOW);

if (WiFi.status() == WL_CONNECTED) {

    Serial.println();
    Serial.println("WiFi Connected");

    Serial.print("IP: ");
    Serial.println(WiFi.localIP());

    if (MDNS.begin("kei")) {

        Serial.println("mDNS: kei.local");
    }

} else {

    Serial.println();
    Serial.println("WiFi FAILED");
}
}

// =======================
// HTTP HANDLERS
// =======================

void handleRoot() {

JsonDocument res;

res["name"] = "Kei Robot";
res["ip"] = WiFi.localIP().toString();
res["rssi"] = WiFi.RSSI();
res["uptime"] = (millis() - startTime) / 1000;

String body;

serializeJson(res, body);

httpServer.sendHeader("Access-Control-Allow-Origin", "*");

httpServer.send(200, "application/json", body);
}

// =======================
// SETUP
// =======================

void setup() {

Serial.begin(115200);

startTime = millis();

pinMode(LED_PIN, OUTPUT);

digitalWrite(LED_PIN, LOW);

// MOTOR PINS

pinMode(AIN1, OUTPUT);
pinMode(AIN2, OUTPUT);

pinMode(BIN1, OUTPUT);
pinMode(BIN2, OUTPUT);

pinMode(STBY, OUTPUT);

digitalWrite(STBY, HIGH);

// PWM (ESP32 CORE 3.x)

ledcAttach(PWMA, 1000, 8);
ledcAttach(PWMB, 1000, 8);

stopMotors();

// WIFI

connectWiFi();

// WEBSOCKET

webSocket.begin();

webSocket.onEvent(webSocketEvent);

Serial.println("WebSocket Started");

// HTTP

httpServer.on("/", handleRoot);

httpServer.begin();

Serial.println("HTTP Started");

// OTA

ArduinoOTA.onStart([]() { stopMotors(); Serial.println("OTA Start"); });

ArduinoOTA.onEnd([]() { Serial.println("OTA End"); });

ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
  Serial.printf("OTA Progress: %u%%\r", (progress / (total / 100)));
});

ArduinoOTA.onError([](ota_error_t error) {
  Serial.printf("OTA Error[%u]: ", error);
  if (error == OTA_AUTH_ERROR) Serial.println("Auth Failed");
  else if (error == OTA_BEGIN_ERROR) Serial.println("Begin Failed");
  else if (error == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
  else if (error == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
  else if (error == OTA_END_ERROR) Serial.println("End Failed");
});

ArduinoOTA.begin();

Serial.println("OTA Ready");

applyPowerSave();
}

// =======================
// LOOP
// =======================

void loop() {

ArduinoOTA.handle();

httpServer.handleClient();

webSocket.loop();

updateLED();

// =======================
// WIFI RECONNECT
// =======================

if (WiFi.status() != WL_CONNECTED) {

    if (millis() - lastWifiAttempt > 2000) {

        lastWifiAttempt = millis();

        Serial.println("Reconnecting WiFi...");

        WiFi.disconnect();

        WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    }

    stopMotors();

    return;
}

// =======================
// MOTOR TIMEOUT
// =======================

if (!emergencyStop &&
    lastCommandTime > 0 &&
    millis() - lastCommandTime > motorTimeout) {

    targetLeftSpeed = 0;
    targetRightSpeed = 0;
}

// =======================
// RAMP
// =======================

if (!emergencyStop) {
    rampMotors();
}

// =======================
// TELEMETRY
// =======================

if (millis() - lastTelemetry > TELEMETRY_INTERVAL) {

    lastTelemetry = millis();

    sendTelemetry();
}
}

// =======================
// LED
// =======================

void updateLED() {

unsigned long now = millis();

if (emergencyStop) {

    if (now - lastLedToggle > 100) {

        lastLedToggle = now;

        ledState = !ledState;

        digitalWrite(LED_PIN, ledState);
    }

    return;
}

if (WiFi.status() != WL_CONNECTED) {

    if (now - lastLedToggle > 200) {

        lastLedToggle = now;

        ledState = !ledState;

        digitalWrite(LED_PIN, ledState);
    }

    return;
}

if (wsConnected) {

    digitalWrite(LED_PIN, HIGH);

} else {

    if (now - lastLedToggle > 1000) {

        lastLedToggle = now;

        ledState = !ledState;

        digitalWrite(LED_PIN, ledState);
    }
}
}

// =======================
// WEBSOCKET EVENT
// =======================

void webSocketEvent(
uint8_t num,
WStype_t type,
uint8_t * payload,
size_t length
) {

switch(type) {

case WStype_CONNECTED:

    wsConnected = true;

    Serial.printf("Client %u Connected\n", num);

    break;

case WStype_DISCONNECTED:

    wsConnected = false;

    Serial.printf("Client %u Disconnected\n", num);

    stopMotors();

    break;

case WStype_TEXT:

    handleMessage(String((char*)payload));

    break;

default:
    break;
}
}

// =======================
// HANDLE JSON
// =======================

void handleMessage(String msg) {

JsonDocument doc;

DeserializationError err = deserializeJson(doc, msg);

if (err) {

    Serial.print("JSON Error: ");

    Serial.println(err.c_str());

    return;
}

Serial.print("Received: ");

serializeJson(doc, Serial);

Serial.println();

// =======================
// EMERGENCY
// =======================

if (doc["emergency"].is<bool>()) {

    emergencyStop = doc["emergency"];

    if (emergencyStop) {

        Serial.println("EMERGENCY STOP");

        stopMotors();
    }

    return;
}

// =======================
// PING
// =======================

if (doc["ping"] == true) {

    JsonDocument pong;

    pong["pong"] = true;

    String reply;

    serializeJson(pong, reply);

    webSocket.broadcastTXT(reply);

    return;
}

// =======================
// CONFIG
// =======================

bool configChanged = false;

if (doc["maxSpeed"].is<int>()) {

    maxSpeed = constrain(doc["maxSpeed"], 0, 255);

    configChanged = true;
}

if (doc["rampRate"].is<int>()) {

    rampRate = constrain(doc["rampRate"], 1, 50);

    configChanged = true;
}

if (doc["motorTimeout"].is<int>()) {

    motorTimeout = max(doc["motorTimeout"].as<int>(), 0);

    configChanged = true;
}

if (doc["powerSave"].is<bool>()) {

    powerSave = doc["powerSave"];

    applyPowerSave();

    configChanged = true;
}

if (configChanged) {

    JsonDocument conf;

    conf["config"] = true;
    conf["maxSpeed"] = maxSpeed;
    conf["rampRate"] = rampRate;
    conf["motorTimeout"] = motorTimeout;
    conf["powerSave"] = powerSave;

    String reply;

    serializeJson(conf, reply);

    webSocket.broadcastTXT(reply);

    return;
}

// =======================
// WIFI CONFIG
// =======================

if (doc["ssid"].is<String>() && doc["password"].is<String>()) {

    String newSsid = doc["ssid"];
    String newPass = doc["password"];

    saveWiFiConfig(newSsid, newPass);

    JsonDocument ack;

    ack["wifiConfig"] = true;
    ack["ssid"] = newSsid;

    String reply;

    serializeJson(ack, reply);

    webSocket.broadcastTXT(reply);

    delay(100);

    ESP.restart();

    return;
}

// =======================
// MOTOR CONTROL
// =======================

if (doc["leftMotor"].is<int>() ||
    doc["rightMotor"].is<int>()) {

    if (emergencyStop) return;

    int leftMotor = doc["leftMotor"] | 0;
    int rightMotor = doc["rightMotor"] | 0;

    targetLeftSpeed =
        constrain(leftMotor, -maxSpeed, maxSpeed);

    targetRightSpeed =
        constrain(rightMotor, -maxSpeed, maxSpeed);

    lastCommandTime = millis();
}
}

// =======================
// RAMP
// =======================

void rampMotors() {

// LEFT

if (currentLeftSpeed != targetLeftSpeed) {

    int step =
        (targetLeftSpeed > currentLeftSpeed)
        ? rampRate
        : -rampRate;

    currentLeftSpeed += step;

    if (abs(currentLeftSpeed - targetLeftSpeed)
        < rampRate) {

        currentLeftSpeed = targetLeftSpeed;
    }

    currentLeftSpeed =
        constrain(currentLeftSpeed, -255, 255);

    writeMotorA(currentLeftSpeed);
}

// RIGHT

if (currentRightSpeed != targetRightSpeed) {

    int step =
        (targetRightSpeed > currentRightSpeed)
        ? rampRate
        : -rampRate;

    currentRightSpeed += step;

    if (abs(currentRightSpeed - targetRightSpeed)
        < rampRate) {

        currentRightSpeed = targetRightSpeed;
    }

    currentRightSpeed =
        constrain(currentRightSpeed, -255, 255);

    writeMotorB(currentRightSpeed);
}
}

// =======================
// MOTOR A
// =======================

void writeMotorA(int speed) {

speed = constrain(speed, -255, 255);

if (speed > 0) {

    digitalWrite(AIN1, HIGH);
    digitalWrite(AIN2, LOW);

    ledcWrite(PWMA, speed);

}
else if (speed < 0) {

    digitalWrite(AIN1, LOW);
    digitalWrite(AIN2, HIGH);

    ledcWrite(PWMA, -speed);

}
else {

    digitalWrite(AIN1, LOW);
    digitalWrite(AIN2, LOW);

    ledcWrite(PWMA, 0);
}
}

// =======================
// MOTOR B
// =======================

void writeMotorB(int speed) {

speed = constrain(speed, -255, 255);

if (speed > 0) {

    digitalWrite(BIN1, HIGH);
    digitalWrite(BIN2, LOW);

    ledcWrite(PWMB, speed);

}
else if (speed < 0) {

    digitalWrite(BIN1, LOW);
    digitalWrite(BIN2, HIGH);

    ledcWrite(PWMB, -speed);

}
else {

    digitalWrite(BIN1, LOW);
    digitalWrite(BIN2, LOW);

    ledcWrite(PWMB, 0);
}
}

// =======================
// STOP MOTORS
// =======================

void stopMotors() {

targetLeftSpeed = 0;
targetRightSpeed = 0;

currentLeftSpeed = 0;
currentRightSpeed = 0;

writeMotorA(0);
writeMotorB(0);
}

// =======================
// TELEMETRY
// =======================

void sendTelemetry() {

String mode = emergencyStop ? "emergency" : "manual";

int avgSpeed = (abs(currentLeftSpeed) + abs(currentRightSpeed)) / 2;

JsonDocument doc;

doc["rssi"] = WiFi.RSSI();

doc["heap"] = ESP.getFreeHeap();

doc["uptime"] =
    (millis() - startTime) / 1000;

doc["speed"] = avgSpeed;

doc["mode"] = mode;

doc["left"] = currentLeftSpeed;

doc["right"] = currentRightSpeed;

doc["powerSave"] = powerSave;

doc["emergency"] = emergencyStop;

doc["ip"] = WiFi.localIP().toString();

doc["ssid"] = wifiSsid;

String json;

serializeJson(doc, json);

webSocket.broadcastTXT(json);
}
