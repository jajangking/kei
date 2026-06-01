#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>

// =======================
// WIFI
// =======================

String wifiSsid = "STARLINK";
String wifiPass = "12345678910";

#define WIFI_TIMEOUT 15000

// =======================
// WEBSOCKET
// =======================

WebSocketsServer webSocket(81);

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
// =======================
// CONFIG
// =======================

int maxSpeed = 255;
int rampRate = 8;
int motorTimeout = 5000;
bool powerSave = false;
bool speedLimitEnabled = false;
int speedLimit = 150;

// =======================
// MQTT
// =======================

WiFiClientSecure mqttWifiClient;
PubSubClient mqttClient(mqttWifiClient);

String mqttBroker = "";
int mqttPort = 8883;
String mqttUser = "";
String mqttPass = "";
String mqttTopicPrefix = "kei/robot";
bool mqttEnabled = false;
unsigned long lastMqttAttempt = 0;
unsigned long lastMqttTelemetry = 0;
String deviceName = "";

void mqttCallback(char* topic, byte* payload, unsigned int length);

#define LED_PIN 2
#define TELEMETRY_INTERVAL 1000

// =======================
// POWER SAVE
// =======================

void savePowerSaveConfig() {
  Preferences prefs;
  prefs.begin("pwr", false);
  prefs.putBool("save", powerSave);
  prefs.end();
  Serial.print("PowerSave saved: ");
  Serial.println(powerSave);
}

void loadPowerSaveConfig() {
  Preferences prefs;
  prefs.begin("pwr", true);
  powerSave = prefs.getBool("save", false);
  prefs.end();
  Serial.print("PowerSave loaded: ");
  Serial.println(powerSave);
}

// =======================
// SPEED LIMIT
// =======================

void saveSpeedLimitConfig() {
  Preferences prefs;
  prefs.begin("sl", false);
  prefs.putBool("enabled", speedLimitEnabled);
  prefs.putInt("limit", speedLimit);
  prefs.end();
}

void loadSpeedLimitConfig() {
  Preferences prefs;
  prefs.begin("sl", true);
  speedLimitEnabled = prefs.getBool("enabled", false);
  speedLimit = prefs.getInt("limit", 150);
  prefs.end();
}

void applyPowerSave() {

if (powerSave) {

    WiFi.setSleep(WIFI_PS_NONE);

    setCpuFrequencyMhz(80);

    Serial.println("Power Save ON");

} else {

    WiFi.setSleep(WIFI_PS_NONE);

    setCpuFrequencyMhz(240);

    Serial.println("Power Save OFF");
}
}

void applyPowerSaveSafe() {
  savePowerSaveConfig();
  ESP.restart();
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
// MQTT CONFIG
// =======================

void loadMqttConfig() {
  Preferences prefs;
  prefs.begin("mqtt", true);
  mqttBroker = prefs.getString("broker", "");
  mqttPort = prefs.getInt("port", 8883);
  mqttUser = prefs.getString("user", "");
  mqttPass = prefs.getString("pass", "");
  mqttTopicPrefix = prefs.getString("prefix", "kei/robot");
  mqttEnabled = prefs.getBool("enabled", false);
  prefs.end();
}

void saveMqttConfig(String broker, int port, String user, String pass, String prefix, bool enabled) {
  Preferences prefs;
  prefs.begin("mqtt", false);
  prefs.putString("broker", broker);
  prefs.putInt("port", port);
  prefs.putString("user", user);
  prefs.putString("pass", pass);
  prefs.putString("prefix", prefix);
  prefs.putBool("enabled", enabled);
  prefs.end();
  mqttBroker = broker;
  mqttPort = port;
  mqttUser = user;
  mqttPass = pass;
  mqttTopicPrefix = prefix;
  mqttEnabled = enabled;
  Serial.println("MQTT Config Saved");
}

String getDeviceId() {
  if (deviceName.length() > 0) return deviceName;
  deviceName = WiFi.macAddress();
  deviceName.replace(":", "");
  return deviceName;
}

String getCmdTopic() {
  return mqttTopicPrefix + "/" + getDeviceId() + "/cmd";
}

String getTeleTopic() {
  return mqttTopicPrefix + "/" + getDeviceId() + "/telemetry";
}

// =======================
// MQTT CONNECT
// =======================

void connectMQTT() {
  if (!mqttEnabled || mqttBroker.length() == 0) return;
  if (mqttClient.connected()) return;

  mqttPort = 8883; // ESP selalu pake TLS/TCP, bukan WSS
  mqttWifiClient.setInsecure();
  mqttClient.setServer(mqttBroker.c_str(), mqttPort);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);

  String clientId = "kei-" + getDeviceId();
  Serial.print("MQTT connecting to ");
  Serial.print(mqttBroker);
  Serial.print(":");
  Serial.println(mqttPort);

  boolean ok;
  if (mqttUser.length() > 0) {
    ok = mqttClient.connect(clientId.c_str(), mqttUser.c_str(), mqttPass.c_str());
  } else {
    ok = mqttClient.connect(clientId.c_str());
  }

  if (ok) {
    Serial.println("MQTT connected");
    String cmdTopic = getCmdTopic();
    mqttClient.subscribe(cmdTopic.c_str());
    Serial.print("MQTT subscribed: ");
    Serial.println(cmdTopic);
  } else {
    Serial.print("MQTT failed: ");
    Serial.println(mqttClient.state());
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.print("MQTT msg [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(msg);
  handleMessage(msg);
}

void mqttPublishTelemetry() {
  if (!mqttEnabled || !mqttClient.connected()) return;
  String json = buildTelemetryJson();
  String topic = getTeleTopic();
  mqttClient.publish(topic.c_str(), json.c_str(), true);
}

// =======================
// WIFI CONNECT
// =======================

void connectWiFi() {

Serial.println();
Serial.println("Connecting WiFi...");

loadWiFiConfig();

WiFi.mode(WIFI_STA);

WiFi.setSleep(WIFI_PS_NONE);

WiFi.setAutoReconnect(true);

WiFi.setTxPower(WIFI_POWER_19_5dBm);

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

// POWERSAVE

loadPowerSaveConfig();

// SPEED LIMIT

loadSpeedLimitConfig();

// MQTT

loadMqttConfig();

// WEBSOCKET

webSocket.begin();

webSocket.enableHeartbeat(3000, 3000, 3);

webSocket.onEvent(webSocketEvent);

Serial.println("WebSocket Started");

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

webSocket.loop();

// MQTT
if (mqttEnabled) {
  if (!mqttClient.connected() && millis() - lastMqttAttempt > 5000) {
    lastMqttAttempt = millis();
    connectMQTT();
  }
  if (mqttClient.connected()) {
    mqttClient.loop();
  }
}

updateLED();

// =======================
// WIFI RECONNECT
// =======================

if (WiFi.status() != WL_CONNECTED) {

    unsigned long retryDelay = 2000;
    if (lastCommandTime > 0) retryDelay = 5000;

    if (millis() - lastWifiAttempt > retryDelay) {

        lastWifiAttempt = millis();

        Serial.println("Reconnecting WiFi...");

        WiFi.reconnect();
    }

    if (millis() - lastCommandTime > 1000) stopMotors();

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

    applyPowerSaveSafe();

    configChanged = true;
}

if (doc["speedLimitEnabled"].is<bool>()) {

    speedLimitEnabled = doc["speedLimitEnabled"];

    configChanged = true;
}

if (doc["speedLimit"].is<int>()) {

    speedLimit = constrain(doc["speedLimit"], 0, 255);

    configChanged = true;
}

if (configChanged) {

    JsonDocument conf;

    conf["config"] = true;
    conf["maxSpeed"] = maxSpeed;
    conf["rampRate"] = rampRate;
    conf["motorTimeout"] = motorTimeout;
    conf["powerSave"] = powerSave;
    conf["speedLimitEnabled"] = speedLimitEnabled;
    conf["speedLimit"] = speedLimit;

    String reply;

    serializeJson(conf, reply);

    webSocket.broadcastTXT(reply);

    return;
}

// =======================
// MQTT CONFIG
// =======================

if (doc["mqttBroker"].is<String>()) {
    String broker = doc["mqttBroker"];
    int port = 8883; // ESP selalu pakai TLS/TCP (MQTTS), bukan WSS
    String user = doc["mqttUser"] | "";
    String pass = doc["mqttPass"] | "";
    String prefix = doc["mqttPrefix"] | "kei/robot";
    bool enabled = doc["mqttEnabled"] | true;

    saveMqttConfig(broker, port, user, pass, prefix, enabled);
    if (enabled) {
      lastMqttAttempt = 0;
      mqttClient.disconnect();
      connectMQTT();
    }

    JsonDocument ack;
    ack["mqttConfig"] = true;
    ack["mqttBroker"] = broker;
    ack["mqttPort"] = port;
    ack["mqttEnabled"] = enabled;
    String reply;
    serializeJson(ack, reply);
    webSocket.broadcastTXT(reply);
    return;
}

if (doc["mqttDisable"].is<bool>() && doc["mqttDisable"]) {
    saveMqttConfig("", 8883, "", "", "kei/robot", false);
    mqttClient.disconnect();
    mqttEnabled = false;
    JsonDocument ack;
    ack["mqttConfig"] = false;
    String reply;
    serializeJson(ack, reply);
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

    int cap = speedLimitEnabled ? speedLimit : maxSpeed;

    targetLeftSpeed =
        constrain(leftMotor, -cap, cap);

    targetRightSpeed =
        constrain(rightMotor, -cap, cap);

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

String buildTelemetryJson() {
  String mode = emergencyStop ? "emergency" : "manual";
  int avgSpeed = (abs(currentLeftSpeed) + abs(currentRightSpeed)) / 2;
  JsonDocument doc;
  doc["rssi"] = WiFi.RSSI();
  doc["heap"] = ESP.getFreeHeap();
  doc["uptime"] = (millis() - startTime) / 1000;
  doc["speed"] = avgSpeed;
  doc["mode"] = mode;
  doc["left"] = currentLeftSpeed;
  doc["right"] = currentRightSpeed;
  doc["powerSave"] = powerSave;
  doc["emergency"] = emergencyStop;
  doc["rampRate"] = rampRate;
  doc["speedLimitEnabled"] = speedLimitEnabled;
  doc["speedLimit"] = speedLimit;
  doc["ip"] = WiFi.localIP().toString();
  doc["ssid"] = wifiSsid;
  doc["mqtt"] = mqttEnabled && mqttClient.connected();
  String json;
  serializeJson(doc, json);
  return json;
}

void sendTelemetry() {
  String json = buildTelemetryJson();
  webSocket.broadcastTXT(json);
  mqttPublishTelemetry();
}
