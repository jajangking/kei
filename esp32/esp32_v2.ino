#include <WiFi.h>
#include <WebSocketsServer.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>

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
#define BIN2 12

#define STBY 33

// =======================
// PWM
// =======================

#define CH_LEFT 0
#define CH_RIGHT 1

// =======================
// LED
// =======================

#define LED_PIN 2

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
void mqttCallback(char* topic, byte* payload, unsigned int length);
void connectWiFi();
void handleWiFi();
void connectMQTT();
void mqttPublishTelemetry();

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
// MQTT TOPIC
// =======================

String getDeviceId() {

  if (deviceName.length() > 0)
    return deviceName;

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

    return;
  }

  if (
    wifiConnecting &&
    millis() - wifiConnectStart > WIFI_TIMEOUT
  ) {

    WiFi.disconnect();

    wifiConnecting = false;
  }

  if (
    !wifiConnecting &&
    millis() - lastWifiAttempt > 5000
  ) {

    lastWifiAttempt = millis();

    connectWiFi();
  }
}

// =======================
// MQTT
// =======================

void connectMQTT() {

  if (!mqttEnabled)
    return;

  if (mqttBroker.length() == 0)
    return;

  if (mqttClient.connected())
    return;

  mqttWifiClient.setInsecure();

  mqttClient.setServer(
    mqttBroker.c_str(),
    mqttPort
  );

  mqttClient.setCallback(mqttCallback);

  mqttClient.setBufferSize(512);

  String clientId = "kei-" + getDeviceId();

  bool ok;

  if (mqttUser.length() > 0) {

    ok = mqttClient.connect(
      clientId.c_str(),
      mqttUser.c_str(),
      mqttPass.c_str()
    );

  } else {

    ok = mqttClient.connect(clientId.c_str());
  }

  if (ok) {

    mqttClient.subscribe(getCmdTopic().c_str());
  }
}

void mqttCallback(
  char* topic,
  byte* payload,
  unsigned int length
) {

  String msg = "";

  for (unsigned int i = 0; i < length; i++) {

    msg += (char)payload[i];
  }

  handleMessage(msg);
}

void mqttPublishTelemetry() {

  if (!mqttEnabled)
    return;

  if (!mqttClient.connected())
    return;

  mqttClient.publish(
    getTeleTopic().c_str(),
    buildTelemetryJson().c_str(),
    true
  );
}

// =======================
// HTTP
// =======================

void handleRoot() {

  StaticJsonDocument<256> doc;

  doc["name"] = "Kei Robot";
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["uptime"] = (millis() - startTime) / 1000;

  String body;

  serializeJson(doc, body);

  httpServer.sendHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  httpServer.send(
    200,
    "application/json",
    body
  );
}

void handleConfig() {

  StaticJsonDocument<512> doc;

  doc["maxSpeed"] = maxSpeed;
  doc["rampRate"] = rampRate;
  doc["motorTimeout"] = motorTimeout;
  doc["powerSave"] = powerSave;
  doc["speedLimitEnabled"] = speedLimitEnabled;
  doc["speedLimit"] = speedLimit;
  doc["leftTrim"] = leftTrim;
  doc["rightTrim"] = rightTrim;
  doc["mqttEnabled"] = mqttEnabled;
  doc["mqttBroker"] = mqttBroker;
  doc["ssid"] = wifiSsid;

  String json;

  serializeJson(doc, json);

  httpServer.send(
    200,
    "application/json",
    json
  );
}

// =======================
// SETUP
// =======================

void setup() {

  Serial.begin(115200);

  startTime = millis();

  // WATCHDOG

  esp_task_wdt_config_t wdt_config = {
    .timeout_ms = 10000,
    .trigger_panic = true
  };
  esp_task_wdt_init(&wdt_config);

  esp_task_wdt_add(NULL);

  // LED

  pinMode(LED_PIN, OUTPUT);

  digitalWrite(LED_PIN, LOW);

  // MOTOR

  pinMode(AIN1, OUTPUT);
  pinMode(AIN2, OUTPUT);

  pinMode(BIN1, OUTPUT);
  pinMode(BIN2, OUTPUT);

  pinMode(STBY, OUTPUT);

  digitalWrite(STBY, HIGH);

  // PWM

  ledcAttachChannel(
    PWMA,
    1000,
    8,
    CH_LEFT
  );

  ledcAttachChannel(
    PWMB,
    1000,
    8,
    CH_RIGHT
  );

  stopMotors();

  // LOAD CONFIG

  loadRuntimeConfig();
  loadPowerSaveConfig();
  loadSpeedLimitConfig();
  loadMqttConfig();

  applyPowerSave();

  // WIFI

  connectWiFi();

  // MDNS

  MDNS.begin("kei");

  // WEBSOCKET

  webSocket.begin();

  webSocket.enableHeartbeat(
    3000,
    3000,
    3
  );

  webSocket.onEvent(
    [](uint8_t num,
       WStype_t type,
       uint8_t * payload,
       size_t length) {

      switch(type) {

        case WStype_CONNECTED:

          wsConnected = true;

          break;

        case WStype_DISCONNECTED:

          wsConnected = false;

          stopMotors();

          break;

        case WStype_TEXT:

          handleMessage(
            String((char*)payload)
          );

          break;

        default:
          break;
      }
    }
  );

  // HTTP

  httpServer.on("/", handleRoot);

  httpServer.on(
    "/config",
    []() {
      handleConfig();
    }
  );

  httpServer.on(
    "/cmd",
    []() {

      if (httpServer.hasArg("plain")) {

        handleMessage(
          httpServer.arg("plain")
        );

        httpServer.send(
          200,
          "text/plain",
          "ok"
        );

      } else {

        httpServer.send(
          400,
          "text/plain",
          "no body"
        );
      }
    }
  );

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

  esp_task_wdt_reset();

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

  StaticJsonDocument<512> doc;

  if (deserializeJson(doc, msg))
    return;

  // EMERGENCY

  if (doc["emergency"].is<bool>()) {

    emergencyStop = doc["emergency"];

    if (emergencyStop) {

      stopMotors();
    }

    return;
  }

  // PING

  if (doc["ping"] == true) {

    StaticJsonDocument<64> pong;

    pong["pong"] = true;

    String reply;

    serializeJson(pong, reply);

    webSocket.broadcastTXT(reply);

    return;
  }

  // MOTOR TRIM

  if (doc["leftTrim"].is<int>()) {

    leftTrim = constrain(
      doc["leftTrim"],
      -100,
      100
    );
  }

  if (doc["rightTrim"].is<int>()) {

    rightTrim = constrain(
      doc["rightTrim"],
      -100,
      100
    );
  }

  // CONFIG

  bool configChanged = false;

  if (doc["maxSpeed"].is<int>()) {

    maxSpeed = constrain(
      doc["maxSpeed"],
      0,
      255
    );

    configChanged = true;
  }

  if (doc["rampRate"].is<int>()) {

    rampRate = constrain(
      doc["rampRate"],
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

    powerSave = doc["powerSave"];

    configChanged = true;

    applyPowerSaveSafe();
  }

  if (doc["speedLimitEnabled"].is<bool>()) {

    speedLimitEnabled = doc["speedLimitEnabled"];

    configChanged = true;
  }

  if (doc["speedLimit"].is<int>()) {

    speedLimit = constrain(
      doc["speedLimit"],
      0,
      255
    );

    configChanged = true;
  }

  if (configChanged) {

    saveRuntimeConfig();

    saveSpeedLimitConfig();

    StaticJsonDocument<256> conf;

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

    saveMqttConfig(
      doc["mqttBroker"],
      8883,
      doc["mqttUser"] | "",
      doc["mqttPass"] | "",
      doc["mqttPrefix"] | "kei/robot",
      doc["mqttEnabled"] | true
    );

    mqttClient.disconnect();

    connectMQTT();

    StaticJsonDocument<128> ack;

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

    StaticJsonDocument<64> ack;

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
      doc["ssid"],
      doc["password"]
    );

    StaticJsonDocument<128> ack;

    ack["wifiConfig"] = true;
    ack["ssid"] = doc["ssid"];

    String reply;

    serializeJson(ack, reply);

    webSocket.broadcastTXT(reply);

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

    targetLeftSpeed = constrain(
      (doc["leftMotor"] | 0) + leftTrim,
      -cap,
      cap
    );

    targetRightSpeed = constrain(
      (doc["rightMotor"] | 0) + rightTrim,
      -cap,
      cap
    );

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
  if (speed > 0 && speed < 50) speed = 50;
  else if (speed < 0 && speed > -50) speed = -50;

  if (speed > 0) {

    digitalWrite(AIN1, HIGH);
    digitalWrite(AIN2, LOW);

    ledcWrite(CH_LEFT, speed);

  } else if (speed < 0) {

    digitalWrite(AIN1, LOW);
    digitalWrite(AIN2, HIGH);

    ledcWrite(CH_LEFT, -speed);

  } else {

    digitalWrite(AIN1, LOW);
    digitalWrite(AIN2, LOW);

    ledcWrite(CH_LEFT, 0);
  }
}

// =======================
// MOTOR B
// =======================

void writeMotorB(int speed) {

  speed = constrain(speed, -255, 255);
  if (speed > 0 && speed < 50) speed = 50;
  else if (speed < 0 && speed > -50) speed = -50;

  if (speed > 0) {

    digitalWrite(BIN1, HIGH);
    digitalWrite(BIN2, LOW);

    ledcWrite(CH_RIGHT, speed);

  } else if (speed < 0) {

    digitalWrite(BIN1, LOW);
    digitalWrite(BIN2, HIGH);

    ledcWrite(CH_RIGHT, -speed);

  } else {

    digitalWrite(BIN1, LOW);
    digitalWrite(BIN2, LOW);

    ledcWrite(CH_RIGHT, 0);
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

  StaticJsonDocument<512> doc;

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

  String json;

  serializeJson(doc, json);

  return json;
}

void sendTelemetry() {

  String json = buildTelemetryJson();

  webSocket.broadcastTXT(json);

  mqttPublishTelemetry();
}
