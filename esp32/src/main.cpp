#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <ArduinoJson.h>
#include "pins.h"
#include "config.h"
#include "motor.h"
#include "wifi.h"
#include "server.h"
#include "sensors.h"

void handleMessage(const String &msg);

// ============================================================
// State
// ============================================================
unsigned long startTime = 0;
unsigned long lastTelemetry = 0;
unsigned long lastCommandTime = 0;
unsigned long lastLedToggle = 0;
unsigned long lastMqttAttempt = 0;

bool emergencyStop = false;
bool otaError = false;

// ============================================================
// MQTT
// ============================================================
static WiFiClient mqttPlain;
static WiFiClientSecure mqttSecure;
static PubSubClient mqttClient(mqttSecure);

static String mqttTeleTopic() { return mqttCfg.prefix + "/" + getDeviceId() + "/telemetry"; }
static String mqttCmdTopic() { return mqttCfg.prefix + "/" + getDeviceId() + "/cmd"; }

static void mqttCallback(char *topic, byte *payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  handleMessage(msg);
}

static void connectMQTT() {
  if (!mqttCfg.enabled || mqttCfg.broker.length() == 0) return;
  if (mqttCfg.tls) {
    mqttClient.setClient(mqttSecure);
    mqttSecure.setInsecure();
    mqttSecure.setHandshakeTimeout(1000);
    mqttSecure.setTimeout(1000);
  } else {
    mqttClient.setClient(mqttPlain);
    mqttPlain.setTimeout(2000);
  }
  mqttClient.setServer(mqttCfg.broker.c_str(), mqttCfg.port);
  mqttClient.setCallback(mqttCallback);
  String cid = "kei-" + getDeviceId();
  bool ok;
  if (mqttCfg.user.length() > 0)
    ok = mqttClient.connect(cid.c_str(), mqttCfg.user.c_str(), mqttCfg.pass.c_str());
  else
    ok = mqttClient.connect(cid.c_str());
  if (ok) {
    mqttClient.subscribe(mqttCmdTopic().c_str());
    mqttClient.subscribe((mqttCfg.prefix + "/broadcast/cmd").c_str());
    wsLog("MQTT connected: " + mqttCfg.broker);
  } else {
    wsLog("MQTT failed: state=" + String(mqttClient.state()));
  }
}

// ============================================================
// LED
// ============================================================
static void updateLED() {
  unsigned long now = millis();
  if (emergencyStop) {
    if (now - lastLedToggle > 100) { lastLedToggle = now; digitalWrite(PIN_LED, !digitalRead(PIN_LED)); }
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastLedToggle > 200) { lastLedToggle = now; digitalWrite(PIN_LED, !digitalRead(PIN_LED)); }
    return;
  }
  digitalWrite(PIN_LED, HIGH);
}

// ============================================================
// Buzzer
// ============================================================
static void buzzerOn() { ledcWrite(PWM_BUZZ, 128); }
static void buzzerOff() { ledcWrite(PWM_BUZZ, 0); }

static void updateBuzzer() {
  static unsigned long last = 0;
  static bool state = false;
  unsigned long now = millis();

  // Proximity warning — priority: beep cepat kalo jarak <= 5cm
  int d = readDistance();
  if (d > 0 && d <= 50) {
    unsigned long interval = state ? 60 : 200;
    if (now - last >= interval) {
      last = now; state = !state;
      if (state) buzzerOn(); else buzzerOff();
    }
    return;
  }

  bool mundur = currentLeft < -30 && currentRight < -30;
  if (!mundur) {
    if (state) { buzzerOff(); state = false; last = 0; }
    return;
  }
  if (last == 0) last = now;
  unsigned long interval = state ? 100 : 400;
  if (now - last >= interval) {
    last = now; state = !state;
    if (state) buzzerOn(); else buzzerOff();
  }
}

static void playStartupMelody() {
  ledcWrite(PWM_BUZZ, 128);
  delay(50);
  ledcWrite(PWM_BUZZ, 0);
}

// ============================================================
// Telemetry
// ============================================================
String buildTelemetryJson() {
  String mode = emergencyStop ? "emergency" : "manual";
  int avgSpeed = (abs(currentLeft) + abs(currentRight)) / 2;
  String j; j.reserve(512);
  j = "{\"mode\":\"" + mode + "\"";
  j += ",\"speed\":" + String(avgSpeed);
  j += ",\"left\":" + String(currentLeft);
  j += ",\"right\":" + String(currentRight);
  j += ",\"emergency\":" + String(emergencyStop ? "true" : "false");
  j += ",\"ip\":\"" + cachedIP + "\"";
  j += ",\"fw\":\"" + String(FW_VERSION) + "\"";
  j += ",\"distance\":" + String(readDistance());

  j += ",\"mpu_ok\":" + String(isMPUReady() ? "true" : "false");
  j += ",\"roll\":" + String(round(getRoll() * 10) / 10);
  j += ",\"pitch\":" + String(round(getPitch() * 10) / 10);
  j += ",\"yaw\":" + String(round(getYaw() * 10) / 10);
  j += ",\"gyroZ\":" + String(round(getGyroZ() * 10) / 10);
  j += ",\"servo\":" + String(getServoAngle());
  j += ",\"rssi\":" + String(cachedRssi);
  j += ",\"heap\":" + String(ESP.getFreeHeap());
  j += ",\"uptime\":" + String((millis() - startTime) / 1000);
  j += ",\"ssid\":\"" + wifiCfg.ssid + "\"";
  j += ",\"mqtt\":" + String((mqttCfg.enabled && mqttClient.connected()) ? "true" : "false");
  j += "}";
  return j;
}

static void sendTelemetry() {
  cachedRssi = WiFi.RSSI();
  String json = buildTelemetryJson();
  wsBroadcast(json);
  if (mqttCfg.enabled && mqttClient.connected())
    mqttClient.publish(mqttTeleTopic().c_str(), json.c_str());
}

// ============================================================
// Message handler
// ============================================================
void handleMessage(const String &msg) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, msg);
  if (err) { Serial.printf("[CMD] parse error: %s\n", err.c_str()); return; }

  // Emergency
  if (doc["emergency"].is<bool>()) {
    emergencyStop = doc["emergency"].as<bool>();
    if (emergencyStop) { stopMotors(); }
    return;
  }

  // Config
  if (doc["maxSpeed"].is<int>()) { runtimeCfg.maxSpeed = constrain(doc["maxSpeed"].as<int>(), 0, 255); saveRuntime(); }
  if (doc["rampRate"].is<int>()) { runtimeCfg.rampRate = constrain(doc["rampRate"].as<int>(), 1, 255); saveRuntime(); }
  if (doc["motorTimeout"].is<int>()) { runtimeCfg.motorTimeout = max(doc["motorTimeout"].as<int>(), 0); saveRuntime(); }
  if (doc["leftTrim"].is<int>()) { runtimeCfg.leftTrim = constrain(doc["leftTrim"].as<int>(), -100, 100); saveRuntime(); }
  if (doc["rightTrim"].is<int>()) { runtimeCfg.rightTrim = constrain(doc["rightTrim"].as<int>(), -100, 100); saveRuntime(); }

  if (doc["powerSave"].is<bool>()) { powerSave = doc["powerSave"].as<bool>(); savePowerSave(); ESP.restart(); }
  if (doc["speedLimitEnabled"].is<bool>()) { speedLimitCfg.enabled = doc["speedLimitEnabled"].as<bool>(); saveSpeedLimit(); }
  if (doc["speedLimit"].is<int>()) { speedLimitCfg.limit = constrain(doc["speedLimit"].as<int>(), 0, 255); saveSpeedLimit(); }

  // WiFi config
  if (doc["ssid"].is<String>() && doc["password"].is<String>()) {
    saveWifi(doc["ssid"].as<String>(), doc["password"].as<String>());
    delay(100); ESP.restart(); return;
  }

  // MQTT config
  if (doc["mqttBroker"].is<String>()) {
    MqttCfg c;
    c.broker = doc["mqttBroker"].as<String>();
    c.port = doc["mqttPort"] | 8883;
    c.user = doc["mqttUser"] | "";
    c.pass = doc["mqttPass"] | "";
    c.prefix = doc["mqttPrefix"] | "kei/robot";
    c.enabled = doc["mqttEnabled"] | false;
    c.tls = doc["mqttTls"] | true;
    saveMqtt(c);
    mqttClient.disconnect(); connectMQTT();
    return;
  }
  if (doc["mqttDisable"] == true) {
    MqttCfg c;
    saveMqtt(c);
    mqttClient.disconnect();
    return;
  }

  if (doc["headingReset"] == true) { resetYaw(); return; }
  if (doc["servo"].is<int>()) { setServoAngle(constrain(doc["servo"].as<int>(), 0, 180)); return; }
  if (doc["deviceName"].is<String>()) { saveDeviceName(doc["deviceName"].as<String>()); return; }
  if (doc["reboot"] == true) { delay(100); ESP.restart(); return; }
  if (doc["retrySensor"] == true) { retrySensor(); return; }

  if (doc["factoryReset"] == true) { factoryReset(); delay(100); ESP.restart(); return; }

  // Motor command
  if (doc["leftMotor"].is<int>() || doc["rightMotor"].is<int>()) {
    if (emergencyStop) return;
    int cap = speedLimitCfg.enabled ? speedLimitCfg.limit : runtimeCfg.maxSpeed;
    int lv = (doc["leftMotor"] | 0) + runtimeCfg.leftTrim;
    int rv = (doc["rightMotor"] | 0) + runtimeCfg.rightTrim;
    setMotor(constrain(lv, -cap, cap), constrain(rv, -cap, cap));
    lastCommandTime = millis();
  }
}

// ============================================================
// Loop
// ============================================================
void loop() {
  handleServer();
  handleWiFi();
  updateLED();
  updateBuzzer();
  if (WiFi.status() != WL_CONNECTED) { stopMotors(); return; }

  // MQTT reconnect
  if (mqttCfg.enabled && !mqttClient.connected() && millis() - lastMqttAttempt > 30000) {
    lastMqttAttempt = millis();
    connectMQTT();
  }
  if (mqttCfg.enabled && mqttClient.connected()) mqttClient.loop();

  // Motor timeout
  if (!emergencyStop && lastCommandTime > 0 && millis() - lastCommandTime > (unsigned long)runtimeCfg.motorTimeout) {
    setMotor(0, 0);
  }

  // Sensors
  int obstacleDist = readDistance();
  readMPU6050();

  // Apply motors
  if (!emergencyStop) rampMotors();

  // Telemetry
  if (millis() - lastTelemetry > 1000) {
    lastTelemetry = millis();
    sendTelemetry();
  }
}

// ============================================================
// Setup
// ============================================================
void setup() {
  Serial.begin(115200);
  startTime = millis();
  delay(100);

  pinMode(PIN_LED, OUTPUT); digitalWrite(PIN_LED, LOW);
  ledcSetup(PWM_BUZZ, 1000, PWM_RES); ledcAttachPin(PIN_BUZZ, PWM_BUZZ); ledcWrite(PWM_BUZZ, 0);
  playStartupMelody();

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000); // 100kHz biar stabil dari noise servo
  Wire.setTimeout(50);

  initMotors();
  initVL53L0X();
  initMPU6050();
  initServo();
  loadAllConfig();

  if (powerSave) {
    WiFi.setSleep(WIFI_PS_MIN_MODEM);
    setCpuFrequencyMhz(80);
  }

  connectWiFi();
  initServer();
  connectMQTT();

  Serial.printf("[BOOT] Kei %s ready\n", FW_VERSION);
}
