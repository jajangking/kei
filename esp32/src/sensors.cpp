#include "sensors.h"
#include <Wire.h>
#include <VL53L0X.h>

static VL53L0X sensor;
static bool sensorReady = false;
static int lastDistance = -1;
static String i2cLog = "";

static int safetyThreshold = 200;
static int lastRaw = -1;

#define SENSOR_RETRY_MS 10000
static unsigned long lastRetry = 0;
static bool initAttempted = false;

bool initVL53L0X() {
  i2cLog = "[SENSOR] init...";

  Wire.begin(SENSOR_SDA, SENSOR_SCL);
  pinMode(SENSOR_SDA, INPUT_PULLUP);
  pinMode(SENSOR_SCL, INPUT_PULLUP);
  Wire.setClock(100000);
  delay(100);

  sensor.setTimeout(500);

  if (sensor.init(false)) {
    Wire.setClock(100000);
    sensor.setMeasurementTimingBudget(50000);
    sensor.startContinuous(50);
    i2cLog += "\n[SENSOR] VL53L0X OK at 0x29";
    sensorReady = true;
    initAttempted = true;
    return true;
  }

  // fallback 2.8V I/O
  if (sensor.init(true)) {
    Wire.setClock(100000);
    sensor.setMeasurementTimingBudget(50000);
    sensor.startContinuous(50);
    i2cLog += "\n[SENSOR] VL53L0X OK at 0x29 (2V8)";
    sensorReady = true;
    initAttempted = true;
    return true;
  }

  // Scan for debug
  i2cLog += "\n[I2C] Scanning...";
  for (byte a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      char buf[48];
      snprintf(buf, sizeof(buf), "\n[I2C] Found 0x%02X", a);
      i2cLog += buf;
    }
  }
  i2cLog += "\n[SENSOR] init gagal";
  initAttempted = true;
  sensorReady = false;
  return false;
}

int readDistanceRaw() {
  if (!sensorReady) return -1;
  uint16_t mm = sensor.readRangeContinuousMillimeters();
  if (sensor.timeoutOccurred() || mm > 2000) return -1;
  lastRaw = (int)mm;
  return lastRaw;
}

int readDistance() {
  if (!sensorReady) return -1;

  int raw = readDistanceRaw();
  if (raw < 0) {
    lastDistance = -1;
    return -1;
  }

  if (lastDistance < 0) lastDistance = raw;
  else lastDistance = (lastDistance * 2 + raw) / 3;

  return lastDistance;
}

bool isSensorReady() {
  return sensorReady;
}

String getSensorDiagnostic() {
  return i2cLog;
}

void setSafetyThreshold(int mm) {
  safetyThreshold = mm;
}

int getSafetyThreshold() {
  return safetyThreshold;
}

void retrySensor() {
  if (sensorReady) return;
  unsigned long now = millis();
  if (!initAttempted || now - lastRetry < SENSOR_RETRY_MS) return;
  lastRetry = now;
  Serial.println("[SENSOR] Auto-retry init...");
  sensorReady = false;
  if (initVL53L0X()) {
    Serial.println("[SENSOR] Auto-retry SUCCESS!");
  } else {
    Serial.println("[SENSOR] Auto-retry failed");
  }
}
