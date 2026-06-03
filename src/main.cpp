#include <WiFi.h>
#include <WebSocketsServer.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>

// =======================
// ARDUINOJSON COMPATIBILITY (v6 & v7)
// =======================
#define JSON_DOC(x) JsonDocument

// =======================
// PINS
// =======================
#define LED_PIN 2

// =======================
// WIFI
// =======================
String wifiSsid = "STARLINK";
String wifiPass = "12345678910";
#define WIFI_TIMEOUT 15000

bool wifiConnecting = false;
unsigned long wifiConnectStart = 0;
unsigned long lastWifiAttempt = 0;

// =======================
// SERVER
// =======================
WebSocketsServer webSocket(81);
WebServer httpServer(80);

// =======================
// MOTOR PINS
// =======================
#define PWMA 25
#define AIN1 26
#define AIN2 27

#define PWMB 13
#define BIN1 14
#define BIN2 33

#define STBY 32
#define BUZZER 4

// =======================
// PWM (ESP32 Core 3.x API)
// =======================
#define CH_LEFT 0
#define CH_RIGHT 1

// =======================
// TELEMETRY
// =======================
#define TELEMETRY_INTERVAL 1000

// =======================
// STATE
// =======================
unsigned long startTime = 0;
unsigned long lastTelemetry = 0;
unsigned long lastCommandTime = 0;
unsigned long lastLedToggle = 0;
unsigned long lastMqttAttempt = 0;

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

int leftTrim = 0;
int rightTrim = 0;

bool initialized = false;

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

String deviceName = "";
bool deviceNameConfigured = false;

// =======================
// DECLARATION
// =======================
void handleMessage(String msg);
void stopMotors();
void writeMotorA(int speed);
void writeMotorB(int speed);
void rampMotors();
void sendTelemetry();
String buildTelemetryJson();
void updateLED();
void updateBuzzer();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void connectWiFi();
void handleWiFi();
void connectMQTT();
void mqttPublishTelemetry();
void handleRoot();
void handleConfig();
void saveRuntimeConfig();
void loadRuntimeConfig();
void savePowerSaveConfig();
void loadPowerSaveConfig();
void saveSpeedLimitConfig();
void loadSpeedLimitConfig();
void saveWiFiConfig(String ssid, String pass);
void loadWiFiConfig();
void saveMqttConfig(String broker, int port, String user, String pass, String prefix, bool enabled);
void loadMqttConfig();
void saveDeviceNameConfig(String name);
void loadDeviceNameConfig();
void applyPowerSave();
void applyPowerSaveSafe();
void sendConfigToClient(uint8_t clientNum);

// =======================
// SAVE CONFIG
// =======================
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
  prefs.begin("runtime", true);
  maxSpeed = prefs.getInt("maxSpeed", 255);
  rampRate = prefs.getInt("rampRate", 8);
  motorTimeout = prefs.getInt("motorTimeout", 5000);
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
  prefs.begin("pwr", true);
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
  prefs.begin("sl", true);
  speedLimitEnabled = prefs.getBool("enabled", false);
  speedLimit = prefs.getInt("limit", 150);
  prefs.end();
}

void loadWiFiConfig() {
  Preferences prefs;
  prefs.begin("wifi", true);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  prefs.end();

  if (ssid.length() > 0) {
    wifiSsid = ssid;  
    wifiPass = pass;
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
}

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

void saveMqttConfig(
  String broker,
  int port,
  String user,
  String pass,
  String prefix,
  bool enabled
) {
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
}

// =======================
// POWER SAVE
// =======================
void applyPowerSave() {
  if (powerSave) {
    WiFi.setSleep(WIFI_PS_MIN_MODEM);  
    setCpuFrequencyMhz(80);
  } else {
    WiFi.setSleep(WIFI_PS_NONE);  
    setCpuFrequencyMhz(240);
  }
}

void applyPowerSaveSafe() {
  savePowerSaveConfig();
  ESP.restart();
}

// =======================
// DEVICE NAME
// =======================
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
  prefs.begin("dname", true);
  String name = prefs.getString("name", "");
  prefs.end();

  if (name.length() > 0) {
    deviceName = name;
    deviceNameConfigured = true;
  }
}

// =======================
// MQTT TOPIC
// =======================
String getDeviceId() {
  if (deviceNameConfigured && deviceName.length() > 0)
    return deviceName;

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  return mac;
}

String getCmdTopic() {
  return mqttTopicPrefix + "/" + getDeviceId() + "/cmd";
}

String getTeleTopic() {
  return mqttTopicPrefix + "/" + getDeviceId() + "/telemetry";
}

// =======================
// WIFI
// =======================
void connectWiFi() {
  loadWiFiConfig();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);

  WiFi.begin(
    wifiSsid.c_str(),
    wifiPass.c_str()
  );

  wifiConnecting = true;
  wifiConnectStart = millis();
}

void handleWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnecting = false;
    initialized = true;
    return;
  }

  if (initialized) {
    wifiConnecting = true;
    return;
  }

  initialized = true;

  // FIRST BOOT INIT
    pinMode(AIN1, OUTPUT);
    pinMode(AIN2, OUTPUT);
    pinMode(BIN1, OUTPUT);
    pinMode(BIN2, OUTPUT);
    pinMode(STBY, OUTPUT);
    pinMode(BUZZER, OUTPUT);

    digitalWrite(STBY, HIGH);

    digitalWrite(BUZZER, HIGH);
    delay(100);
    digitalWrite(BUZZER, LOW);

    ledcSetup(CH_LEFT, 1000, 8);
    ledcAttachPin(PWMA, CH_LEFT);
    ledcSetup(CH_RIGHT, 1000, 8);
    ledcAttachPin(PWMB, CH_RIGHT);

    stopMotors();

    loadRuntimeConfig();
    loadPowerSaveConfig();
    loadSpeedLimitConfig();
    loadDeviceNameConfig();
    loadMqttConfig();

    applyPowerSave();

    connectWiFi();

    MDNS.begin("kei");

    webSocket.begin();
    webSocket.enableHeartbeat(15000, 5000, 3);

    webSocket.onEvent(
      [](uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
        switch(type) {  
          case WStype_CONNECTED:  
            wsConnected = true;  
            emergencyStop = false;  
            sendConfigToClient(num);  
            break;  

          case WStype_DISCONNECTED:  
            wsConnected = false;  
            stopMotors();  
            break;  

          case WStype_TEXT:  
            handleMessage(String((char*)payload));  
            break;  

          default:  
            break;  
        }  
      }
    );

    // HTTP
    httpServer.on("/", handleRoot);

    httpServer.on("/config", []() {
      handleConfig();
    });

    httpServer.on("/cmd", []() {
      if (httpServer.hasArg("plain")) {  
        handleMessage(httpServer.arg("plain"));  
        httpServer.send(200, "text/plain", "ok");  
      } else {  
        httpServer.send(400, "text/plain", "no body");  
      }  
    });

    httpServer.begin();

    // OTA
    ArduinoOTA.onStart([]() {
      stopMotors();
    });

    ArduinoOTA.begin();
}

// =======================
// LOOP
// =======================
void loop() {
  ArduinoOTA.handle();
  httpServer.handleClient();
  webSocket.loop();
  handleWiFi();

  // MQTT
  if (mqttEnabled) {
    if (  
      !mqttClient.connected() &&  
      millis() - lastMqttAttempt > 5000  
    ) {  
      lastMqttAttempt = millis();  
      connectMQTT();  
    }  
    mqttClient.loop();
  }

  updateLED();
  updateBuzzer();

  // WIFI LOST
  if (WiFi.status() != WL_CONNECTED) {
    stopMotors();  
    return;
  }

  // TIMEOUT
  if (
    !emergencyStop &&
    lastCommandTime > 0 &&
    millis() - lastCommandTime > motorTimeout
  ) {
    targetLeftSpeed = 0;  
    targetRightSpeed = 0;
  }

  // RAMP
  if (!emergencyStop) {
    rampMotors();
  }

  // TELEMETRY
  if (
    millis() - lastTelemetry > TELEMETRY_INTERVAL
  ) {
    lastTelemetry = millis();  
    sendTelemetry();
  }
}

// =======================
// HANDLE MESSAGE
// =======================
void handleMessage(String msg) {
  JSON_DOC(512) doc;

  DeserializationError error = deserializeJson(doc, msg);
  if (error) {
    Serial.println("JSON parse error: " + String(error.c_str()));
    return;
  }

  // EMERGENCY
  if (doc["emergency"].is<bool>()) {
    emergencyStop = doc["emergency"].as<bool>();  
    if (emergencyStop) {  
      stopMotors();  
    }  
    return;
  }

  // PING
  if (doc["ping"] == true) {
    JSON_DOC(64) pong;  
    pong["pong"] = true;  
    String reply;  
    serializeJson(pong, reply);  
    webSocket.broadcastTXT(reply);  
    return;
  }

  // MOTOR TRIM
  if (doc["leftTrim"].is<int>()) {
    leftTrim = constrain(doc["leftTrim"].as<int>(), -100, 100);
  }

  if (doc["rightTrim"].is<int>()) {
    rightTrim = constrain(doc["rightTrim"].as<int>(), -100, 100);
  }

  // CONFIG
  bool configChanged = false;

  if (doc["maxSpeed"].is<int>()) {
    maxSpeed = constrain(  
      doc["maxSpeed"].as<int>(),  
      0,  
      255  
    );  
    configChanged = true;
  }

  if (doc["rampRate"].is<int>()) {
    rampRate = constrain(  
      doc["rampRate"].as<int>(),  
      1,  
      50  
    );  
    configChanged = true;
  }

  if (doc["motorTimeout"].is<int>()) {
    motorTimeout = max(  
      doc["motorTimeout"].as<int>(),  
      0  
    );  
    configChanged = true;
  }

  if (doc["powerSave"].is<bool>()) {
    powerSave = doc["powerSave"].as<bool>();  
    configChanged = true;  
    applyPowerSaveSafe();
  }

  if (doc["speedLimitEnabled"].is<bool>()) {
    speedLimitEnabled = doc["speedLimitEnabled"].as<bool>();  
    configChanged = true;
  }

  if (doc["speedLimit"].is<int>()) {
    speedLimit = constrain(  
      doc["speedLimit"].as<int>(),  
      0,  
      255  
    );  
    configChanged = true;
  }

  if (configChanged) {
    saveRuntimeConfig();  
    saveSpeedLimitConfig();  

    JSON_DOC(256) conf;  
    conf["config"] = true;  
    conf["maxSpeed"] = maxSpeed;  
    conf["rampRate"] = rampRate;  
    conf["motorTimeout"] = motorTimeout;  
    conf["powerSave"] = powerSave;  
    conf["speedLimitEnabled"] = speedLimitEnabled;  
    conf["speedLimit"] = speedLimit;  
    conf["leftTrim"] = leftTrim;  
    conf["rightTrim"] = rightTrim;  

    String reply;  
    serializeJson(conf, reply);  
    webSocket.broadcastTXT(reply);
  }

  // MQTT CONFIG
  if (doc["mqttBroker"].is<String>()) {
    int port = doc["mqttPort"].as<int>() | 8883;
    saveMqttConfig(  
      doc["mqttBroker"].as<String>(),  
      port,  
      doc["mqttUser"].as<String>(),  
      doc["mqttPass"].as<String>(),  
      doc["mqttPrefix"].as<String>(),  
      doc["mqttEnabled"].as<bool>()  
    );  

    mqttClient.disconnect();  
    connectMQTT();  

    JSON_DOC(128) ack;  
    ack["mqttConfig"] = true;  

    String reply;  
    serializeJson(ack, reply);  
    webSocket.broadcastTXT(reply);  
    return;
  }

  // MQTT DISABLE
  if (
    doc["mqttDisable"].is<bool>() &&
    doc["mqttDisable"]
  ) {
    saveMqttConfig(  
      "",  
      8883,  
      "",  
      "",  
      "kei/robot",  
      false  
    );  

    mqttEnabled = false;  
    mqttClient.disconnect();  

    JSON_DOC(64) ack;  
    ack["mqttConfig"] = false;  

    String reply;  
    serializeJson(ack, reply);  
    webSocket.broadcastTXT(reply);  
    return;
  }

  // WIFI CONFIG
  if (
    doc["ssid"].is<String>() &&
    doc["password"].is<String>()
  ) {
    saveWiFiConfig(  
      doc["ssid"].as<String>(),  
      doc["password"].as<String>()  
    );  

    JSON_DOC(128) ack;  
    ack["wifiConfig"] = true;  
    ack["ssid"] = doc["ssid"];  

    String reply;  
    serializeJson(ack, reply);  
    webSocket.broadcastTXT(reply);  

    delay(100);
    ESP.restart();
    return;
  }

  // DEVICE NAME
  if (doc["deviceName"].is<String>()) {
    saveDeviceNameConfig(doc["deviceName"].as<String>());

    JSON_DOC(64) ack;
    ack["deviceName"] = deviceName;
    String reply;
    serializeJson(ack, reply);
    webSocket.broadcastTXT(reply);
    return;
  }

  // REBOOT
  if (doc["reboot"] == true) {
    JSON_DOC(64) ack;
    ack["reboot"] = true;
    String reply;
    serializeJson(ack, reply);
    webSocket.broadcastTXT(reply);
    delay(100);
    ESP.restart();
    return;
  }

  // FACTORY RESET
  if (doc["factoryReset"] == true) {
    JSON_DOC(64) ack;
    ack["factoryReset"] = true;
    String reply;
    serializeJson(ack, reply);
    webSocket.broadcastTXT(reply);

    Preferences prefs;
    prefs.begin("runtime", false);
    prefs.clear();
    prefs.end();
    prefs.begin("pwr", false);
    prefs.clear();
    prefs.end();
    prefs.begin("sl", false);
    prefs.clear();
    prefs.end();
    prefs.begin("dname", false);
    prefs.clear();
    prefs.end();
    prefs.begin("mqtt", false);
    prefs.clear();
    prefs.end();
    prefs.begin("wifi", false);
    prefs.clear();
    prefs.end();

    delay(100);
    ESP.restart();
    return;
  }

  // MOTOR
  if (
    doc["leftMotor"].is<int>() ||
    doc["rightMotor"].is<int>()
  ) {
    if (emergencyStop)  
      return;  

    int cap = speedLimitEnabled  
      ? speedLimit  
      : maxSpeed;  

    int leftVal = (doc["leftMotor"] | 0) + leftTrim;
    targetLeftSpeed = constrain(leftVal, -cap, cap);

    int rightVal = (doc["rightMotor"] | 0) + rightTrim;
    targetRightSpeed = constrain(rightVal, -cap, cap); 

    lastCommandTime = millis();
  }
}

// =======================
// RAMP
// =======================
void rampMotors() {
  if (currentLeftSpeed != targetLeftSpeed) {
    int step =  
      (targetLeftSpeed > currentLeftSpeed)  
      ? rampRate  
      : -rampRate;  

    currentLeftSpeed += step;  

    if (  
      abs(currentLeftSpeed - targetLeftSpeed)  
      < rampRate  
    ) {  
      currentLeftSpeed = targetLeftSpeed;  
    }  

    currentLeftSpeed = constrain(  
      currentLeftSpeed,  
      -255,  
      255  
    );  

    writeMotorA(currentLeftSpeed);
  }

  if (currentRightSpeed != targetRightSpeed) {
    int step =  
      (targetRightSpeed > currentRightSpeed)  
      ? rampRate  
      : -rampRate;  

    currentRightSpeed += step;  

    if (  
      abs(currentRightSpeed - targetRightSpeed)  
      < rampRate  
    ) {  
      currentRightSpeed = targetRightSpeed;  
    }  

    currentRightSpeed = constrain(  
      currentRightSpeed,  
      -255,  
      255  
    );  

    writeMotorB(currentRightSpeed);
  }
}

// =======================
// MOTOR A
// =======================
void writeMotorA(int speed) {
  speed = constrain(speed, -255, 255);
  
  // Deadzone untuk mengatasi gesekan statis motor
  if (speed > 0 && speed < 130) speed = 130;
  else if (speed < 0 && speed > -130) speed = -130;

  if (speed > 0) {
    digitalWrite(AIN1, HIGH);  
    digitalWrite(AIN2, LOW);  
    ledcWrite(PWMA, speed);
  } else if (speed < 0) {
    digitalWrite(AIN1, LOW);  
    digitalWrite(AIN2, HIGH);  
    ledcWrite(PWMA, -speed);
  } else {
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
  
  // Deadzone untuk mengatasi gesekan statis motor
  if (speed > 0 && speed < 130) speed = 130;
  else if (speed < 0 && speed > -130) speed = -130;

  if (speed > 0) {
    digitalWrite(BIN1, HIGH);  
    digitalWrite(BIN2, LOW);  
    ledcWrite(PWMB, speed);    // FIXED: Menggunakan PIN, bukan channel
  } else if (speed < 0) {
    digitalWrite(BIN1, LOW);  
    digitalWrite(BIN2, HIGH);  
    ledcWrite(PWMB, -speed);   // FIXED: Menggunakan PIN, bukan channel
  } else {
    digitalWrite(BIN1, LOW);  
    digitalWrite(BIN2, LOW);  
    ledcWrite(PWMB, 0);        // FIXED: Menggunakan PIN, bukan channel
  }
}

// =======================
// STOP
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
// LED
// =======================
void updateBuzzer() {
  static unsigned long lastToggle = 0;
  static bool state = false;

  bool mundur = currentLeftSpeed < -30 && currentRightSpeed < -30;

  if (!mundur) {
    if (state) {
      digitalWrite(BUZZER, LOW);
      state = false;
    }
    return;
  }

  unsigned long now = millis();
  unsigned long interval = state ? 100 : 400;

  if (now - lastToggle >= interval) {
    lastToggle = now;
    state = !state;
    digitalWrite(BUZZER, state ? HIGH : LOW);
  }
}

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
// TELEMETRY
// =======================
String buildTelemetryJson() {
  JSON_DOC(512) doc;

  String mode = emergencyStop
    ? "emergency"
    : "manual";

  int avgSpeed = (
    abs(currentLeftSpeed) +
    abs(currentRightSpeed)
  ) / 2;

  doc["rssi"] = WiFi.RSSI();
  doc["heap"] = ESP.getFreeHeap();
  doc["uptime"] = (millis() - startTime) / 1000;
  doc["speed"] = avgSpeed;
  doc["mode"] = mode;
  doc["left"] = currentLeftSpeed;
  doc["right"] = currentRightSpeed;
  doc["leftTrim"] = leftTrim;
  doc["rightTrim"] = rightTrim;
  doc["powerSave"] = powerSave;
  doc["emergency"] = emergencyStop;
  doc["rampRate"] = rampRate;
  doc["speedLimitEnabled"] = speedLimitEnabled;
  doc["speedLimit"] = speedLimit;
  doc["maxSpeed"] = maxSpeed;
  doc["motorTimeout"] = motorTimeout;
  doc["ip"] = WiFi.localIP().toString();
  doc["ssid"] = wifiSsid;
  doc["mqtt"] = mqttEnabled && mqttClient.connected();
  doc["deviceName"] = deviceName;

  String json;
  serializeJson(doc, json);

  return json;
}

void sendTelemetry() {
  String json = buildTelemetryJson();
  webSocket.broadcastTXT(json);
  mqttPublishTelemetry();
}

// =======================
// PUSH CONFIG TO CLIENT
// =======================
void sendConfigToClient(uint8_t clientNum) {
  JSON_DOC(512) doc;
  doc["config"] = true;
  doc["maxSpeed"] = maxSpeed;
  doc["rampRate"] = rampRate;
  doc["motorTimeout"] = motorTimeout;
  doc["powerSave"] = powerSave;
  doc["speedLimitEnabled"] = speedLimitEnabled;
  doc["speedLimit"] = speedLimit;
  doc["leftTrim"] = leftTrim;
  doc["rightTrim"] = rightTrim;
  doc["ssid"] = wifiSsid;
  doc["mqttBroker"] = mqttBroker;
  doc["mqttPort"] = mqttPort;
  doc["mqttUser"] = mqttUser;
  doc["mqttPass"] = mqttPass;
  doc["mqttPrefix"] = mqttTopicPrefix;
  doc["mqttEnabled"] = mqttEnabled;
  doc["deviceName"] = deviceName;
  doc["emergency"] = emergencyStop;
  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(clientNum, json);
}

// =======================
// MQTT CALLBACK
// =======================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  handleMessage(msg);
}

// =======================
// MQTT CONNECT
// =======================
void connectMQTT() {
  if (!mqttEnabled || mqttBroker.length() == 0) return;

  mqttClient.setServer(mqttBroker.c_str(), mqttPort);
  mqttClient.setCallback(mqttCallback);
  mqttWifiClient.setInsecure();

  String clientId = "kei-" + getDeviceId();

  if (mqttUser.length() > 0) {
    mqttClient.connect(clientId.c_str(), mqttUser.c_str(), mqttPass.c_str());
  } else {
    mqttClient.connect(clientId.c_str());
  }

  if (mqttClient.connected()) {
    mqttClient.subscribe(getCmdTopic().c_str());
  }
}

// =======================
// MQTT PUBLISH TELEMETRY
// =======================
void mqttPublishTelemetry() {
  if (!mqttEnabled || !mqttClient.connected()) return;

  String json = buildTelemetryJson();
  mqttClient.publish(getTeleTopic().c_str(), json.c_str());
}

// =======================
// HTTP HANDLERS
// =======================
void handleRoot() {
  String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1,user-scalable=no'><title>Kei Robot</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#1a1a2e;color:#fff;text-align:center;padding:10px;overflow:hidden;height:100dvh;display:flex;flex-direction:column}h1{font-size:20px;padding:8px 0;color:#e94560}#tele{flex:1;overflow-y:auto;background:#16213e;border-radius:10px;padding:10px;margin:8px 0;font-size:13px;text-align:left;display:grid;grid-template-columns:1fr 1fr;gap:4px}#tele div{padding:4px 8px;background:#0f3460;border-radius:5px}.val{color:#e94560;font-weight:bold}#ctrl{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:8px 0}.dpad-btn{background:#16213e;border:2px solid #0f3460;border-radius:10px;padding:18px 0;font-size:24px;color:#fff;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none}.dpad-btn:active{background:#e94560}#stop{font-size:14px}#emergency{background:#e94560;border:none;border-radius:10px;padding:14px;color:#fff;font-size:16px;font-weight:bold;cursor:pointer;touch-action:manipulation;margin:4px 0}.emergency-on{background:#ff6b6b !important;animation:pulse .5s infinite}pulse{0%{opacity:1}50%{opacity:.6}}#speed-row{display:flex;align-items:center;gap:10px;margin:6px 0}input[type=range]{flex:1;height:6px;-webkit-appearance:none;appearance:none;background:#0f3460;border-radius:3px}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;border-radius:50%;background:#e94560;cursor:pointer}.nav-links{margin-top:4px;font-size:12px}.nav-links a{color:#e94560;text-decoration:none;margin:0 8px}</style></head><body><h1>Kei Robot</h1><div id='tele'></div><div id='speed-row'><span>Speed</span><input type='range' id='speedSlider' min='0' max='255' value='200'><span id='speedVal'>200</span></div><div id='ctrl'><div></div><button class='dpad-btn' data-l='0' data-r='1'>▲</button><div></div><button class='dpad-btn' data-l='-1' data-r='0'>◀</button><button class='dpad-btn' id='stop' data-l='0' data-r='0'>⏹</button><button class='dpad-btn' data-l='1' data-r='0'>▶</button><div></div><button class='dpad-btn' data-l='0' data-r='-1'>▼</button><div></div></div><button id='emergency'>EMERGENCY STOP</button><div class='nav-links'><a href='/'>Control</a><a href='/config'>Config</a></div><script>var ws, tel=document.getElementById('tele'), spd=document.getElementById('speedSlider'), spdVal=document.getElementById('speedVal'), emgBtn=document.getElementById('emergency'), connected=false;function connect(){ws=new WebSocket((location.protocol=='https:'?'wss:':'ws:')+'//'+location.host+'/ws/');ws.onopen=function(){connected=true;sendCmd({ping:true})};ws.onclose=function(){connected=false;setTimeout(connect,1000)};ws.onmessage=function(e){try{var d=JSON.parse(e.data);if(d.pong)return;if(d.config)return updateConfig(d);tel.innerHTML='';for(var k in d){if(k=='left'||k=='right')continue;tel.innerHTML+='<div>'+k+': <span class=val>'+d[k]+'</span></div>'}}catch(e){}}}function sendCmd(o){if(ws&&ws.readyState==1)ws.send(JSON.stringify(o))}function updateConfig(d){document.querySelectorAll('[data-cfg]').forEach(function(el){var v=d[el.dataset.cfg];if(v!==undefined)el.value=v})}spd.addEventListener('input',function(){spdVal.textContent=this.value});document.querySelectorAll('.dpad-btn').forEach(function(btn){var isStop=btn.id=='stop';function move(e){e.preventDefault();if(isStop)sendCmd({leftMotor:0,rightMotor:0});else{var s=parseInt(spd.value),l=parseInt(btn.dataset.l)*s,r=parseInt(btn.dataset.r)*s;sendCmd({leftMotor:l,rightMotor:r})}}btn.addEventListener('touchstart',move,{passive:false});btn.addEventListener('mousedown',move);btn.addEventListener('touchend',function(e){e.preventDefault();sendCmd({leftMotor:0,rightMotor:0})},{passive:false});btn.addEventListener('mouseup',function(){sendCmd({leftMotor:0,rightMotor:0})})});emgBtn.addEventListener('click',function(){sendCmd({emergency:!connected});connected=!connected;this.textContent=connected?'EMERGENCY ON':'EMERGENCY STOP';this.classList.toggle('emergency-on',connected)});connect()</script></body></html>";
  httpServer.send(200, "text/html", html);
}

void handleConfig() {
  String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Kei Config</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#1a1a2e;color:#fff;padding:16px}h1{font-size:20px;text-align:center;color:#e94560;margin-bottom:16px}.sec{background:#16213e;border-radius:10px;padding:12px;margin-bottom:12px}.sec h2{font-size:14px;color:#e94560;margin-bottom:10px}label{display:block;font-size:12px;color:#aaa;margin:8px 0 3px}input,select{width:100%;padding:10px;background:#0f3460;border:1px solid #1a3a6a;border-radius:6px;color:#fff;font-size:14px}input:focus{outline:none;border-color:#e94560}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;margin-top:8px}.btn-primary{background:#e94560;color:#fff}.btn-danger{background:#ff6b6b;color:#fff}.btn-warn{background:#f0a500;color:#fff}.btn-sm{padding:8px;font-size:12px;margin-top:4px}.chk{display:flex;align-items:center;gap:8px;margin:8px 0}.chk input{width:auto}.nav-links{text-align:center;margin-top:12px;font-size:12px}.nav-links a{color:#e94560;text-decoration:none;margin:0 8px}</style></head><body><h1>Configuration</h1><div class=sec><h2>Motor</h2><div class=row><div><label>Max Speed</label><input type=number id=maxSpeed min=0 max=255 value=255></div><div><label>Ramp Rate</label><input type=number id=rampRate min=1 max=50 value=8></div></div><div class=row><div><label>Motor Timeout (ms)</label><input type=number id=motorTimeout min=0 value=5000></div><div><label>Left Trim</label><input type=number id=leftTrim min=-100 max=100 value=0></div></div><div class=row><div><label>Right Trim</label><input type=number id=rightTrim min=-100 max=100 value=0></div><div></div></div><label class=chk><input type=checkbox id=powerSave>Power Save Mode</label><label class=chk><input type=checkbox id=speedLimitEnabled>Speed Limit</label><div id=speedLimitRow style=display:none><label>Speed Limit Value</label><input type=number id=speedLimit min=0 max=255 value=150></div></div><div class=sec><h2>WiFi</h2><div class=row><div><label>SSID</label><input id=wifiSsid></div><div><label>Password</label><input type=password id=wifiPass></div></div><button class='btn btn-primary btn-sm' onclick='saveWifi()'>Save & Reboot</button></div><div class=sec><h2>MQTT</h2><label class=chk><input type=checkbox id=mqttEnabled>MQTT Enabled</label><div class=row><div><label>Broker</label><input id=mqttBroker placeholder=broker.local></div><div><label>Port</label><input type=number id=mqttPort value=8883></div></div><div class=row><div><label>User</label><input id=mqttUser></div><div><label>Password</label><input type=password id=mqttPass></div></div><label>Topic Prefix</label><input id=mqttPrefix value=kei/robot></div><div class=sec><h2>Device</h2><label>Device Name</label><input id=deviceName placeholder='(auto: MAC address)'><button class='btn btn-primary btn-sm' onclick='saveDevice()'>Save</button></div><div class=sec><button class='btn btn-warn' onclick='factoryReset()'>Factory Reset</button><button class='btn btn-danger' onclick='cmd({reboot:true})'>Reboot</button></div><div class=nav-links><a href='/'>Control</a><a href='/config'>Config</a></div><script>function cmd(o){var ws=new WebSocket((location.protocol=='https:'?'wss:':'ws:')+'//'+location.host+'/ws/');ws.onopen=function(){ws.send(JSON.stringify(o));setTimeout(function(){ws.close()},100)}}function saveWifi(){var s=document.getElementById('wifiSsid').value,p=document.getElementById('wifiPass').value;if(!s)return;cmd({ssid:s,password:p})}function saveDevice(){var n=document.getElementById('deviceName').value;cmd({deviceName:n||'reset'})}function factoryReset(){if(confirm('Factory reset? All data will be lost.'))cmd({factoryReset:true})}document.getElementById('speedLimitEnabled').addEventListener('change',function(){document.getElementById('speedLimitRow').style.display=this.checked?'block':'none'});var ws=new WebSocket((location.protocol=='https:'?'wss:':'ws:')+'//'+location.host+'/ws/');ws.onmessage=function(e){try{var d=JSON.parse(e.data);if(d.config){document.getElementById('maxSpeed').value=d.maxSpeed||255;document.getElementById('rampRate').value=d.rampRate||8;document.getElementById('motorTimeout').value=d.motorTimeout||5000;document.getElementById('leftTrim').value=d.leftTrim||0;document.getElementById('rightTrim').value=d.rightTrim||0;document.getElementById('powerSave').checked=d.powerSave||false;document.getElementById('speedLimitEnabled').checked=d.speedLimitEnabled||false;document.getElementById('speedLimit').value=d.speedLimit||150;document.getElementById('wifiSsid').value=d.ssid||'';document.getElementById('mqttBroker').value=d.mqttBroker||'';document.getElementById('mqttPort').value=d.mqttPort||8883;document.getElementById('mqttUser').value=d.mqttUser||'';document.getElementById('mqttPass').value=d.mqttPass||'';document.getElementById('mqttPrefix').value=d.mqttPrefix||'kei/robot';document.getElementById('mqttEnabled').checked=d.mqttEnabled||false;document.getElementById('deviceName').value=d.deviceName||'';document.getElementById('speedLimitRow').style.display=d.speedLimitEnabled?'block':'none'}}catch(e){}};document.querySelectorAll('.sec input, .sec select').forEach(function(el){el.addEventListener('change',function(){if(el.id=='wifiSsid'||el.id=='wifiPass'||el.id=='deviceName')return;var msg={};if(el.type=='checkbox')msg[el.id]=el.checked;else msg[el.id]=parseInt(el.value)||0;cmd(msg)})})</script></body></html>";
  httpServer.send(200, "text/html", html);
}

// =======================
// SETUP
// =======================
void setup() {
  Serial.begin(115200);
  startTime = millis();

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER, LOW);

  connectWiFi();
}
