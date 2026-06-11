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

static bool sensorDead = false; // skip all I2C kalo mati

// Rate-limiter
#define VL_READ_INTERVAL 200
#define VL_FAIL_BACKOFF  1000
#define VL_RESET_THRESHOLD 10
static unsigned long lastVLRead = 0;
static int vlFailCount = 0;

static void resetI2C() {
  Wire.end();
  delay(10);
  Wire.begin(SENSOR_SDA, SENSOR_SCL);
  Wire.setClock(400000);
  Wire.setTimeout(50);
}

static bool probeAddress(byte addr) {
  for (int r = 0; r < 3; r++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) return true;
    delay(50);
  }
  return false;
}

bool initVL53L0X() {
  diagLog = "[VL53L0X] init...";

  // XSHUT pin — pull HIGH to enable sensor
  pinMode(VL_XSHUT_PIN, OUTPUT);
  digitalWrite(VL_XSHUT_PIN, HIGH);
  delay(10);

  // Try address 0x29 (default), then 0x30 (alternative)
  byte addrs[] = {0x29, 0x30};
  byte foundAddr = 0;
  for (int i = 0; i < 2; i++) {
    if (probeAddress(addrs[i])) { foundAddr = addrs[i]; break; }
  }

  if (foundAddr == 0) {
    diagLog += "\n[VL53L0X] not found on I2C (tried 0x29, 0x30) — skip";
    sensorDead = true;
    return false;
  }
  diagLog += "\n[VL53L0X] found at 0x" + String(foundAddr, HEX);

  if (lox.begin()) {
    Wire.setClock(400000);
    diagLog += " — OK";
    vlReady = true;
    return true;
  }
  diagLog += "\n[VL53L0X] begin() gagal — skip forever";
  sensorDead = true;
  return false;
}

int readDistanceRaw() {
  if (!vlReady) return -1;

  unsigned long now = millis();
  int interval = (vlFailCount >= 3) ? VL_FAIL_BACKOFF : VL_READ_INTERVAL;
  if (now - lastVLRead < interval) return lastGoodRaw;
  lastVLRead = now;

  if (vlFailCount >= VL_RESET_THRESHOLD) {
    resetI2C();
    initVL53L0X();
    vlFailCount = 0;
    return -1;
  }

  VL53L0X_RangingMeasurementData_t m;
  lox.rangingTest(&m, false);
  if (m.RangeStatus != 0 || m.RangeMilliMeter > 4000) {
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
void retrySensor() {
  sensorDead = false;
  vlReady = false;
  vlFailCount = 0;
  // Pulse XSHUT LOW→HIGH to hard-reset the sensor
  digitalWrite(VL_XSHUT_PIN, LOW);
  delay(10);
  digitalWrite(VL_XSHUT_PIN, HIGH);
  delay(50);
  initVL53L0X();
}

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
#define CAL_SAMPLES 100

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

static bool calInProgress = false;
static int calSampleCount = 0;
static float calSum = 0;

bool initMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() != 0) {
    Serial.println("[MPU] not found");
    mpuReady = false;
    return false;
  }

  writeMPU(MPU_PWR1, 0);
  delay(100);

  // gyro kalibrasi background — first 200 readMPU6050() calls akan samples
  calInProgress = true;
  calSampleCount = 0;
  calSum = 0;
  gzOffset = 0;

  mpuReady = true;
  lastMPU = millis();
  Serial.println("[MPU] OK (cal background)");
  return true;
}

bool isMPUReady() { return mpuReady; }

void readMPU6050() {
  if (!mpuReady) return;
  unsigned long now = millis();
  int minInterval = calInProgress ? 5 : 30; // kalibrasi lebih cepet
  if (now - lastMPU < minInterval) return;
  if (now - lastMPU > 500) lastMPU = now - 10; // clamp dt kalo lama

  byte buf[14];
  readMPURaw(MPU_ACCEL, buf, 14);

  ax = (buf[0] << 8) | buf[1];
  ay = (buf[2] << 8) | buf[3];
  az = (buf[4] << 8) | buf[5];
  gx = (buf[8] << 8) | buf[9];
  gy = (buf[10] << 8) | buf[11];
  gz = (buf[12] << 8) | buf[13];

  // Gyro kalibrasi background
  if (calInProgress) {
    calSum += gz / 131.0;
    calSampleCount++;
    if (calSampleCount >= CAL_SAMPLES) {
      gzOffset = calSum / CAL_SAMPLES;
      calInProgress = false;
      Serial.printf("[MPU] gyroZ offset: %.2f\n", gzOffset);
    }
    lastMPU = now;
    return; // skip roll/pitch/yaw selama kalibrasi
  }

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

String getMPUDiagnostic() {
  String s; s.reserve(256);
  s = "[MPU] ready=" + String(mpuReady ? "true" : "false");
  s += " cal=" + String(calInProgress ? "busy" : "done");
  if (calInProgress) s += " " + String(calSampleCount) + "/" + String(CAL_SAMPLES);
  s += " offsetZ=" + String(gzOffset, 2);
  s += " ax=" + String(ax) + " ay=" + String(ay) + " az=" + String(az);
  s += " gx=" + String(gx) + " gy=" + String(gy) + " gz=" + String(gz);
  return s;
}

String scanI2C() {
  String s; s.reserve(256);
  s = "[I2C] scan...\n";
  byte err, addr;
  int n = 0;
  for (addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    err = Wire.endTransmission();
    if (err == 0) {
      s += " 0x" + String(addr, HEX);
      n++;
    }
  }
  if (n == 0) s += " none found";
  s += "\n[I2C] " + String(n) + " device(s)";
  return s;
}

// ============================================================
// Servo
// ============================================================
#define SERVO_CH 3
#define SERVO_FREQ 50
#define SERVO_RES 12

static int servoAngle = 90;
static int servoAngleTarget = 90;
static unsigned long lastServoStep = 0;

void initServo() {
  ledcSetup(SERVO_CH, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_PIN, SERVO_CH);
  servoAngle = 90;
  servoAngleTarget = 90;
  uint32_t duty = map(90, 0, 180, 205, 410);
  ledcWrite(SERVO_CH, duty);
}

void setServoAngle(int deg) {
  servoAngleTarget = constrain(deg, 0, 180);
}

void updateServo() {
  if (servoAngle == servoAngleTarget) return;
  unsigned long now = millis();
  if (now - lastServoStep < 15) return;
  lastServoStep = now;
  servoAngle += (servoAngleTarget > servoAngle) ? 1 : -1;
  uint32_t duty = map(servoAngle, 0, 180, 205, 410);
  ledcWrite(SERVO_CH, duty);
}

int getServoAngle() { return servoAngle; }
