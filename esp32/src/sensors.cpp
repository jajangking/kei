#include "sensors.h"
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

static Adafruit_VL53L0X lox = Adafruit_VL53L0X();
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
  delay(100);

  if (lox.begin()) {
    i2cLog += "\n[SENSOR] VL53L0X OK via Adafruit";
    sensorReady = true;
    initAttempted = true;
    return true;
  }

  // Scan I2C untuk debug
  i2cLog += "\n[I2C] Scanning...";
  for (byte a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      char buf[32];
      snprintf(buf, sizeof(buf), "\n[I2C] Found 0x%02X", a);
      i2cLog += buf;
    }
  }
  i2cLog += "\n[SENSOR] Adafruit init gagal";
  initAttempted = true;
  sensorReady = false;
  return false;
}

int readDistanceRaw() {
  if (!sensorReady) return -1;
  VL53L0X_RangingMeasurementData_t measure;
  lox.rangingTest(&measure, false);
  if (measure.RangeStatus == 4) return -1; // out of range
  lastRaw = (int)measure.RangeMilliMeter;
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
