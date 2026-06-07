#include "sensors.h"
#include <Wire.h>
#include <VL53L0X.h>

static VL53L0X sensor;
static bool sensorReady = false;
static unsigned long lastRead = 0;
static int lastDistance = -1;
static String i2cLog = "";

void scanI2C() {
  i2cLog = "[I2C] Scanning...";
  Serial.println("[I2C] Scanning...");
  byte err, addr;
  int nDevices = 0;
  for (addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    err = Wire.endTransmission();
    if (err == 0) {
      char buf[64];
      snprintf(buf, sizeof(buf), "[I2C] Found 0x%02X", addr);
      i2cLog += "\n";
      i2cLog += buf;
      Serial.println(buf);
      if (addr == 0x29) { i2cLog += " (VL53L0X default)"; Serial.print(" (VL53L0X default)"); }
      else if (addr == 0x30) { i2cLog += " (VL53L0X alt)"; Serial.print(" (VL53L0X alt)"); }
      else if (addr == 0x68) { i2cLog += " (MPU6050)"; Serial.print(" (MPU6050)"); }
      Serial.println();
      nDevices++;
    }
  }
  if (nDevices == 0) { i2cLog += "\n[I2C] No devices found"; Serial.println("[I2C] No devices found"); }
  else { char buf[32]; snprintf(buf, sizeof(buf), "\n[I2C] %d device(s)", nDevices); i2cLog += buf; Serial.printf("[I2C] %d device(s) found\n", nDevices); }
}

bool initVL53L0X() {
  Wire.begin(SENSOR_SDA, SENSOR_SCL);
  scanI2C();

  sensor.setTimeout(200);

  // Try default address 0x29
  if (sensor.init()) {
    Serial.println("[SENSOR] VL53L0X found at 0x29");
  } else {
    // Probe alternative address 0x30
    Wire.beginTransmission(0x30);
    if (Wire.endTransmission() == 0) {
      sensor.setAddress(0x30);
      if (sensor.init()) {
        Serial.println("[SENSOR] VL53L0X found at 0x30");
      } else {
        Serial.println("[SENSOR] VL53L0X at 0x30 but init failed");
        sensorReady = false;
        return false;
      }
    } else {
      Serial.println("[SENSOR] VL53L0X not found at 0x29 or 0x30");
      Serial.println("[SENSOR] Check wiring: SDA=GPIO21, SCL=GPIO22, VIN=3.3V, GND=GND");
      Serial.println("[SENSOR] Also check XSHUT pin — must be pulled HIGH (3.3V)");
      sensorReady = false;
      return false;
    }
  }

  sensor.setMeasurementTimingBudget(33000);
  sensor.startContinuous(50);

  sensorReady = true;
  Serial.println("[SENSOR] VL53L0X ready — continuous mode 50ms");
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

bool isSensorReady() {
  return sensorReady;
}

String getSensorDiagnostic() {
  String s = i2cLog;
  s += "\n[SENSOR] status: ";
  s += sensorReady ? "OK" : "FAIL";
  if (!sensorReady) {
    s += "\n[SENSOR] Check:";
    s += "\n  - XSHUT pin -> 3.3V (HIGH)";
    s += "\n  - SDA -> GPIO21";
    s += "\n  - SCL -> GPIO22";
    s += "\n  - VIN -> 3.3V";
    s += "\n  - GND -> GND";
    s += "\n  - Pull-up 4.7k on SDA/SCL?";
  }
  return s;
}
