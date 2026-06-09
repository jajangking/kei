#include "sensors.h"
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

// ============================================================
// VL53L0X
// ============================================================
static Adafruit_VL53L0X lox;
static bool vlReady = false;
static int lastGoodDist = -1;
static int lastGoodRaw = -1;
static String diagLog = "";
static int safetyThresh = 200;
static bool sensorDead = false; // skip all I2C kalo mati

// Rate-limiter
#define VL_READ_INTERVAL 100
#define VL_FAIL_BACKOFF  1000
static unsigned long lastVLRead = 0;
static int vlFailCount = 0;

bool initVL53L0X() {
  diagLog = "[VL53L0X] init...";
  Wire.setTimeout(50); // timeout cepet biar gak nge-block
  if (lox.begin()) {
    Wire.setClock(100000);
    diagLog += "\n[VL53L0X] OK";
    vlReady = true;
    return true;
  }
  diagLog += "\n[VL53L0X] gagal — skip forever";
  sensorDead = true;
  return false;
}

int readDistanceRaw() {
  if (!vlReady) return -1;

  unsigned long now = millis();
  int interval = (vlFailCount >= 3) ? VL_FAIL_BACKOFF : VL_READ_INTERVAL;
  if (now - lastVLRead < interval) return lastGoodRaw;
  lastVLRead = now;

  VL53L0X_RangingMeasurementData_t m;
  lox.rangingTest(&m, false);
  if (m.RangeStatus == 4) {
    vlFailCount++;
    return -1;
  }
  vlFailCount = 0;
  lastGoodRaw = (int)m.RangeMilliMeter;
  return lastGoodRaw;
}

int readDistance() {
  if (!vlReady) return -1;
  int r = readDistanceRaw();
  if (r < 0) { lastGoodDist = -1; return -1; }
  if (lastGoodDist < 0) lastGoodDist = r;
  else lastGoodDist = (lastGoodDist * 2 + r) / 3;
  return lastGoodDist;
}

bool isSensorReady() { return vlReady; }
String getSensorDiagnostic() { return diagLog; }
void setSafetyThreshold(int mm) { safetyThresh = mm; }
int getSafetyThreshold() { return safetyThresh; }

void retrySensor() {} // no-op: once dead, stay dead sampai restart

// ============================================================
// MPU6050
// ============================================================
#define MPU_ADDR 0x68
#define MPU_PWR1 0x6B
#define MPU_ACCEL 0x3B
#define MPU_GYRO 0x43

static bool mpuReady = false;
static int16_t ax, ay, az, gx, gy, gz;
static float roll = 0, pitch = 0, yaw = 0;
static float gyroZ = 0;
static unsigned long lastMPU = 0;
static float gzOffset = 0;
#define CAL_SAMPLES 200

static void writeMPU(byte reg, byte val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}

static void readMPURaw(byte reg, byte* buf, int len) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, len);
  int n = Wire.available();
  for (int i = 0; i < len && i < n; i++) buf[i] = Wire.read();
  // kalo I2C error, biarin buf berisi 0 (default-nya 0 via zero-initialized caller)
}

static int16_t read16(byte reg) {
  byte buf[2];
  readMPURaw(reg, buf, 2);
  return (buf[0] << 8) | buf[1];
}

bool initMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() != 0) {
    Serial.println("[MPU] not found");
    mpuReady = false;
    return false;
  }

  writeMPU(MPU_PWR1, 0);
  delay(100);

  Serial.println("[MPU] calibrate gyro Z...");
  float sum = 0;
  for (int i = 0; i < CAL_SAMPLES; i++) {
    sum += read16(MPU_GYRO + 2) / 131.0;
    delay(5);
  }
  gzOffset = sum / CAL_SAMPLES;
  Serial.printf("[MPU] gyroZ offset: %.2f\n", gzOffset);

  mpuReady = true;
  lastMPU = millis();
  Serial.println("[MPU] OK");
  return true;
}

bool isMPUReady() { return mpuReady; }

void readMPU6050() {
  if (!mpuReady) return;
  unsigned long now = millis();
  if (now - lastMPU < 10) return; // rate limit 10ms biar gak tabrakan I2C
  if (now - lastMPU > 500) lastMPU = now - 10; // clamp dt kalo lama

  byte buf[14];
  readMPURaw(MPU_ACCEL, buf, 14);

  ax = (buf[0] << 8) | buf[1];
  ay = (buf[2] << 8) | buf[3];
  az = (buf[4] << 8) | buf[5];
  gx = (buf[8] << 8) | buf[9];
  gy = (buf[10] << 8) | buf[11];
  gz = (buf[12] << 8) | buf[13];

  float accX = ax / 16384.0;
  float accY = ay / 16384.0;
  float accZ = az / 16384.0;

  roll  = atan2(accY, accZ) * 180 / PI;
  pitch = atan2(-accX, sqrt(accY * accY + accZ * accZ)) * 180 / PI;

  float dt = (now - lastMPU) / 1000.0;
  if (dt < 0.001) dt = 0.001;
  lastMPU = now;

  gyroZ = gz / 131.0 - gzOffset;
  yaw += gyroZ * dt;
}

float getRoll() { return roll; }
float getPitch() { return pitch; }
float getYaw() { return yaw; }
float getGyroZ() { return gyroZ; }
void resetYaw() { yaw = 0; }
