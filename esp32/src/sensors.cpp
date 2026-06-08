#include "sensors.h"
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

static Adafruit_VL53L0X lox;
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

  // Sama persis kayak test sketch user — biarkan lox.begin() handle Wire
  if (lox.begin()) {
    Wire.setClock(100000);
    i2cLog += "\n[SENSOR] VL53L0X OK";
    sensorReady = true;
    initAttempted = true;
    return true;
  }

  i2cLog += "\n[SENSOR] init gagal";
  initAttempted = true;
  sensorReady = false;
  return false;
}

int readDistanceRaw() {
  if (!sensorReady) return -1;
  VL53L0X_RangingMeasurementData_t measure;
  lox.rangingTest(&measure, false);
  if (measure.RangeStatus == 4) return -1;
  lastRaw = (int)measure.RangeMilliMeter;
  return lastRaw;
}

int readDistance() {
  if (!sensorReady) return -1;
  int raw = readDistanceRaw();
  if (raw < 0) { lastDistance = -1; return -1; }
  if (lastDistance < 0) lastDistance = raw;
  else lastDistance = (lastDistance * 2 + raw) / 3;
  return lastDistance;
}

bool isSensorReady() { return sensorReady; }
String getSensorDiagnostic() { return i2cLog; }
void setSafetyThreshold(int mm) { safetyThreshold = mm; }
int getSafetyThreshold() { return safetyThreshold; }

void retrySensor() {
  if (sensorReady) return;
  unsigned long now = millis();
  if (!initAttempted || now - lastRetry < SENSOR_RETRY_MS) return;
  lastRetry = now;
  Serial.println("[SENSOR] Auto-retry init...");
  sensorReady = false;
  if (initVL53L0X()) Serial.println("[SENSOR] Auto-retry SUCCESS!");
  else Serial.println("[SENSOR] Auto-retry failed");
}
