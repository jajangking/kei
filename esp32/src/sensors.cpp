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

bool tryScan(int sda, int scl, const char* label) {
  Wire.begin(sda, scl);
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
  delay(100);

  char line[64];
  snprintf(line, sizeof(line), "[I2C] Trying %s (SDA=%d SCL=%d)", label, sda, scl);
  i2cLog += "\n"; i2cLog += line;
  Serial.println(line);

  byte err, addr;
  int nDevices = 0;
  for (addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    err = Wire.endTransmission();
    if (err == 0) {
      char buf[48];
      snprintf(buf, sizeof(buf), "[I2C] Found 0x%02X", addr);
      i2cLog += "\n"; i2cLog += buf;
      Serial.println(buf);
      if (addr == 0x29) { i2cLog += " (VL53L0X)"; Serial.print(" (VL53L0X)"); }
      else if (addr == 0x30) { i2cLog += " (VL53L0X alt)"; Serial.print(" (VL53L0X alt)"); }
      Serial.println();
      nDevices++;
    }
  }
  if (nDevices == 0) {
    i2cLog += "\n  -> no devices";
    Serial.println("  -> no devices");
  } else {
    char buf[32];
    snprintf(buf, sizeof(buf), "  -> %d device(s)", nDevices);
    i2cLog += "\n"; i2cLog += buf;
    Serial.println(buf);
  }
  return nDevices > 0;
}

bool initVL53L0X() {
  i2cLog = "[SENSOR] init...";

  // Try different I2C pin pairs
  bool found = tryScan(SENSOR_SDA, SENSOR_SCL, "default");
  if (!found) found = tryScan(ALT_SDA, ALT_SCL, "alt1");
  if (!found) found = tryScan(18, 19, "alt2");

  if (!found) {
    i2cLog += "\n[SENSOR] No I2C devices found on any pin pair";
    sensorReady = false;
    return false;
  }

  // Re-init Wire on default pins and try VL53L0X
  Wire.begin(SENSOR_SDA, SENSOR_SCL);
  pinMode(SENSOR_SDA, INPUT_PULLUP);
  pinMode(SENSOR_SCL, INPUT_PULLUP);
  sensor.setTimeout(200);

  // Try default address 0x29, then 0x30
  if (sensor.init()) {
    i2cLog += "\n[SENSOR] VL53L0X OK at 0x29";
  } else {
    Wire.beginTransmission(0x30);
    if (Wire.endTransmission() == 0) {
      sensor.setAddress(0x30);
      if (sensor.init()) {
        i2cLog += "\n[SENSOR] VL53L0X OK at 0x30";
      } else {
        i2cLog += "\n[SENSOR] Found at 0x30 but init failed";
        sensorReady = false;
        return false;
      }
    } else {
      i2cLog += "\n[SENSOR] I2C device found but not VL53L0X (not 0x29 or 0x30)";
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
  return i2cLog;
}
