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
#include "led.h"

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
// Buzzer + Melody
// ============================================================
struct Note { uint16_t freq; uint16_t dur; };

#define MELODY_NONE     0
#define MELODY_STARTUP  1
#define MELODY_BIRTHDAY 2
#define MELODY_CUSTOM   3
#define MELODY_KLAKSON  4
#define MELODY_MAX_NOTES 60

static int melodyActive = MELODY_NONE;
static int melodyIdx = 0;
static unsigned long melodyTick = 0;
static Note customMelody[MELODY_MAX_NOTES];
static int customMelodyLen = 0;

static const Note melStartup[] = {
  {523, 80}, {659, 80}, {784, 120}, {0, 1}
};
static const Note melBirthday[] = {
  {262, 200}, {262, 200}, {294, 400}, {262, 400}, {349, 400}, {330, 800},
  {262, 200}, {262, 200}, {294, 400}, {262, 400}, {392, 400}, {349, 800},
  {262, 200}, {262, 200}, {523, 400}, {440, 400}, {349, 400}, {330, 400}, {294, 800},
  {494, 200}, {494, 200}, {440, 400}, {349, 400}, {392, 400}, {349, 800},
  {0, 1}
};

static const Note melKlakson[] = {
  {880, 100}, {440, 100}, {880, 100}, {440, 100}, {880, 100}, {440, 100}, {880, 100}, {440, 100},
  {880, 200}, {440, 150}, {880, 400}, {0, 1}
};

static int buzzerVol = 128;

static void buzzerOn() { ledcWrite(PWM_BUZZ, buzzerVol); }
static void buzzerOff() { ledcWrite(PWM_BUZZ, 0); }

static void buzzerFreq(int freq) {
  if (freq > 0) { ledcWriteTone(PWM_BUZZ, freq); ledcWrite(PWM_BUZZ, buzzerVol); }
  else buzzerOff();
}

static void playMelody(int id) {
  melodyActive = id;
  melodyIdx = 0;
  melodyTick = millis();
  // play first note immediately
  const Note* mel = nullptr;
  int len = 0;
  if (id == MELODY_STARTUP) { mel = melStartup; len = sizeof(melStartup)/sizeof(Note); }
  else if (id == MELODY_BIRTHDAY) { mel = melBirthday; len = sizeof(melBirthday)/sizeof(Note); }
  else if (id == MELODY_KLAKSON) { mel = melKlakson; len = sizeof(melKlakson)/sizeof(Note); }
  else if (id == MELODY_CUSTOM) { mel = customMelody; len = customMelodyLen; }
  if (mel && len > 0) buzzerFreq(mel[0].freq);
}

static void updateMelody() {
  if (melodyActive == MELODY_NONE) return;
  unsigned long now = millis();
  const Note* mel = nullptr;
  int len = 0;
  if (melodyActive == MELODY_STARTUP) { mel = melStartup; len = sizeof(melStartup)/sizeof(Note); }
  else if (melodyActive == MELODY_BIRTHDAY) { mel = melBirthday; len = sizeof(melBirthday)/sizeof(Note); }
  else if (melodyActive == MELODY_KLAKSON) { mel = melKlakson; len = sizeof(melKlakson)/sizeof(Note); }
  else if (melodyActive == MELODY_CUSTOM) { mel = customMelody; len = customMelodyLen; }
  if (!mel || len == 0) { melodyActive = MELODY_NONE; return; }
  if (melodyIdx >= len - 1) { buzzerOff(); melodyActive = MELODY_NONE; return; }
  if (now - melodyTick >= mel[melodyIdx].dur) {
    melodyIdx++;
    melodyTick = now;
    if (melodyIdx < len) buzzerFreq(mel[melodyIdx].freq);
  }
}

static void updateBuzzer() {
  if (melodyActive != MELODY_NONE) { updateMelody(); return; }
  static unsigned long last = 0;
  static bool state = false;
  unsigned long now = millis();

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
  j += ",\"sensor_ok\":" + String(isSensorReady() ? "true" : "false");

  j += ",\"mpu_ok\":" + String(isMPUReady() ? "true" : "false");
  j += ",\"roll\":" + String(round(getRoll() * 10) / 10);
  j += ",\"pitch\":" + String(round(getPitch() * 10) / 10);
  j += ",\"yaw\":" + String(round(getYaw() * 10) / 10);
  j += ",\"gyroZ\":" + String(round(getGyroZ() * 10) / 10);
  j += ",\"accelX\":" + String(getAccelX());
  j += ",\"accelY\":" + String(getAccelY());
  j += ",\"accelZ\":" + String(getAccelZ());
  j += ",\"servo\":" + String(getServoAngle());
  j += ",\"led\":" + String(getLEDs());
  j += ",\"led_mode\":" + String(getLEDMode());
  j += ",\"rssi\":" + String(cachedRssi);
  j += ",\"heap\":" + String(ESP.getFreeHeap());
  j += ",\"uptime\":" + String((millis() - startTime) / 1000);
  j += ",\"ssid\":\"" + wifiCfg.ssid + "\"";
  j += ",\"buzzer_vol\":" + String(buzzerVol);
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
  if (doc["led"].is<JsonArray>()) {
    JsonArray arr = doc["led"].as<JsonArray>();
    int mask = 0;
    size_t n = arr.size();
    if (n > LED_COUNT) n = LED_COUNT;
    for (size_t i = 0; i < n; i++)
      if (arr[i].as<bool>()) mask |= (1 << i);
    setLEDMode(LED_MODE_MANUAL);
    setLEDs(mask);
    return;
  }
  if (doc["led_hazard"].is<bool>()) {
    setLEDMode(doc["led_hazard"].as<bool>() ? LED_MODE_HAZARD : LED_MODE_AUTO);
    return;
  }
  if (doc["led_signal"].is<const char*>()) {
    const char* s = doc["led_signal"].as<const char*>();
    if (strcmp(s, "left") == 0) setLEDMode(LED_MODE_SIGNAL_L);
    else if (strcmp(s, "right") == 0) setLEDMode(LED_MODE_SIGNAL_R);
    else setLEDMode(LED_MODE_AUTO);
    return;
  }
  if (doc["deviceName"].is<String>()) { saveDeviceName(doc["deviceName"].as<String>()); return; }
  if (doc["reboot"] == true) { delay(100); ESP.restart(); return; }
  if (doc["retrySensor"] == true) { retrySensor(); return; }
  if (doc["buzzer"].is<const char*>()) {
    const char* s = doc["buzzer"].as<const char*>();
    if (strcmp(s, "birthday") == 0) playMelody(MELODY_BIRTHDAY);
    else if (strcmp(s, "startup") == 0) playMelody(MELODY_STARTUP);
    else if (strcmp(s, "klakson") == 0) playMelody(MELODY_KLAKSON);
    return;
  }
  if (doc["melody"].is<JsonArray>()) {
    JsonArray arr = doc["melody"].as<JsonArray>();
    customMelodyLen = 0;
    for (size_t i = 0; i < arr.size() && i < MELODY_MAX_NOTES; i++) {
      JsonArray note = arr[i];
      if (note.size() >= 2) {
        customMelody[customMelodyLen].freq = note[0].as<uint16_t>();
        customMelody[customMelodyLen].dur = note[1].as<uint16_t>();
        customMelodyLen++;
      }
    }
    if (customMelodyLen > 0) playMelody(MELODY_CUSTOM);
    return;
  }
  if (doc["buzzer_vol"].is<int>()) {
    buzzerVol = constrain(doc["buzzer_vol"].as<int>(), 0, 255);
    return;
  }

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
  retryMPU();

  // Apply motors
  if (!emergencyStop) rampMotors();

  // Auto-lighting (only in auto mode)
  if (getLEDMode() == LED_MODE_AUTO) {
    int spdFwd = max(currentLeft, currentRight);
    int spdRev = min(currentLeft, currentRight);
    int autoMask = 0;
    if (spdFwd > 30) autoMask |= 0x03;
    if (spdRev < -30) autoMask |= 0x0C;
    setLEDs(autoMask);
  }
  updateLEDs();

  // Telemetry (200ms biar realtime)
  if (millis() - lastTelemetry > 200) {
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
  playMelody(MELODY_STARTUP);

  Wire.begin(PIN_SDA, PIN_SCL);   // Wire0 — MPU6050 doang
  Wire.setClock(100000);
  Wire.setTimeout(10);             // 10ms, gak perlu lama — VL udah di Wire1

  initMotors();
  delay(100); // power rail stabil sebelum sensor init
  initVL53L0X();
  initMPU6050();
  initServo();
  initLEDs();
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
