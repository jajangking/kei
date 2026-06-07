#include "sensors.h"
#include <Wire.h>
#include <VL53L0X.h>

static VL53L0X sensor;
static bool sensorReady = false;
static unsigned long lastRead = 0;
static int lastDistance = -1;

bool initVL53L0X() {
  Wire.begin(SENSOR_SDA, SENSOR_SCL);

  sensor.setTimeout(200);

  if (!sensor.init()) {
    Serial.println("[SENSOR] VL53L0X init failed");
    sensorReady = false;
    return false;
  }

  sensor.setMeasurementTimingBudget(33000);
  sensor.startContinuous(50);

  sensorReady = true;
  Serial.println("[SENSOR] VL53L0X ready");
  return true;
}

int readDistance() {
  if (!sensorReady) return -1;

  unsigned long now = millis();
  if (now - lastRead < 50) return lastDistance;

  lastRead = now;
  uint16_t mm = sensor.readRangeContinuousMillimeters();

  if (sensor.timeoutOccurred()) {
    lastDistance = -1;
    return -1;
  }

  if (mm > 2000) {
    lastDistance = -1;
    return -1;
  }

  lastDistance = (int)mm;
  return lastDistance;
}
