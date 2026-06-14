#include "sensors.h"
#include <Wire.h>
#include <Adafruit_VL53L0X.h>
#include <vl53l0x_api.h>

// ============================================================
// MPU — pin I2C untuk Wire0 (bareng servo, terpisah dari VL)
// ============================================================
#define MPU_SDA 21
#define MPU_SCL 22

// ============================================================
// VL53L0X — Wire1 (bus I2C dedicated)
// ============================================================
static Adafruit_VL53L0X lox;
static bool vlReady = false;
static int lastGoodDist = -1;
static int lastGoodRaw = -1;
static String diagLog = "";

static bool sensorDead = false;
static int vlFailCount = 0;

#define VL_READ_INTERVAL 200
#define VL_FAIL_BACKOFF  1000
static unsigned long lastVLRead = 0;

static void I2C_ClearBus(int sda, int scl) {
  pinMode(scl, OUTPUT);
  pinMode(sda, INPUT_PULLUP);
  for (int i = 0; i < 9; i++) {
    digitalWrite(scl, LOW);
    delayMicroseconds(10);
    digitalWrite(scl, HIGH);
    delayMicroseconds(10);
  }
  pinMode(sda, OUTPUT);
  digitalWrite(sda, LOW);
  delayMicroseconds(10);
  digitalWrite(scl, HIGH);
  delayMicroseconds(10);
  digitalWrite(sda, HIGH);
  delayMicroseconds(10);
  pinMode(sda, INPUT);
  pinMode(scl, INPUT);
}

// ============================================================
// Wire0 — MPU6050 + servo noise isolation
// ============================================================
static void servoDetachForI2C();
static void servoAttachAfterI2C();

static void resetWire0() {
  servoDetachForI2C();

  Wire.end();
  delay(20);
  I2C_ClearBus(MPU_SDA, MPU_SCL);
  Wire.begin(MPU_SDA, MPU_SCL);
  Wire.setClock(100000);
  Wire.setTimeout(10);
  delay(50);
  initMPU6050();

  servoAttachAfterI2C();
}

// ============================================================
// Wire1 — VL53L0X
// ============================================================
static void resetWire1() {
  Wire1.end();
  delay(20);
  I2C_ClearBus(VL_SDA, VL_SCL);
  Wire1.begin(VL_SDA, VL_SCL);
  Wire1.setClock(100000);
  Wire1.setTimeout(10);
  vlFailCount = 0;
  delay(50);
  initVL53L0X();
}

static bool probeAddress(byte addr) {
  for (int r = 0; r < 3; r++) {
    Wire1.beginTransmission(addr);
    if (Wire1.endTransmission() == 0) return true;
    delay(50);
  }
  return false;
}

bool initVL53L0X() {
  if (sensorDead) return false;
  diagLog = "[VL53L0X] init...";
  vlReady = false;

  pinMode(VL_XSHUT_PIN, OUTPUT);

  // Inisialisasi Wire1 (bus dedicated VL)
  Wire1.begin(VL_SDA, VL_SCL);
  Wire1.setClock(100000);
  Wire1.setTimeout(10);

  delay(50);

  for (int attempt = 0; attempt < 3; attempt++) {
    digitalWrite(VL_XSHUT_PIN, LOW);
    delay(5);
    digitalWrite(VL_XSHUT_PIN, HIGH);
    delay(50);

    byte addrs[] = {0x29, 0x30};
    byte foundAddr = 0;
    for (int i = 0; i < 2; i++) {
      if (probeAddress(addrs[i])) { foundAddr = addrs[i]; break; }
    }

    if (foundAddr == 0) {
      diagLog += "\n[VL53L0X] attempt " + String(attempt + 1) + " — not found";
      continue;
    }
    diagLog += "\n[VL53L0X] attempt " + String(attempt + 1) + " — found at 0x" + String(foundAddr, HEX);

    if (lox.begin(foundAddr, false, &Wire1)) {
      Wire1.setClock(100000);

      // Long-range mode: timing budget 200ms + relaksasi limit
      uint32_t budget = 0;
      if (VL53L0X_GetMeasurementTimingBudgetMicroSeconds(&lox.vl53l0x, &budget) == VL53L0X_ERROR_NONE) {
        budget = 200000; // 200ms
        VL53L0X_SetMeasurementTimingBudgetMicroSeconds(&lox.vl53l0x, budget);
        VL53L0X_SetLimitCheckEnable(&lox.vl53l0x, VL53L0X_CHECKENABLE_SIGMA_FINAL_RANGE, 0);
        diagLog += " budget=" + String(budget / 1000) + "ms";
      }

      diagLog += " — OK";
      vlReady = true;
      return true;
    }
    diagLog += " — begin() gagal";
  }

  diagLog += "\n[VL53L0X] semua attempt gagal — skip";
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
  // Accept status 0 (good), 1 (sigma fail), 2 (signal fail) — still valid distance
  // Reject 3 (too close), 4 (too far), 5 (hw fail), 6 (no wrap), 7 (wrapped)
  if (m.RangeStatus > 2 || m.RangeMilliMeter > 4000) {
    if (++vlFailCount >= 10) { resetWire1(); return -1; }
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
  lastGoodDist = r;
  return lastGoodDist;
}

bool isSensorReady() { return vlReady; }
String getSensorDiagnostic() { return diagLog; }
void retrySensor() {
  sensorDead = false;
  vlReady = false;
  vlFailCount = 0;
  pinMode(VL_XSHUT_PIN, OUTPUT);
  digitalWrite(VL_XSHUT_PIN, LOW);
  delay(10);
  digitalWrite(VL_XSHUT_PIN, HIGH);
  delay(50);
  initVL53L0X();
}

// ============================================================
// MPU6050 — Wire0 (SDA=21, SCL=22)
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
static int i2cFailCount = 0;
#define CAL_SAMPLES 100

static void writeMPU(byte reg, byte val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}

static bool readMPURaw(byte reg, byte* buf, int len) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom(MPU_ADDR, len);
  int n = Wire.available();
  for (int i = 0; i < len && i < n; i++) buf[i] = Wire.read();
  return n == len;
}

enum CalState { CAL_IDLE, CAL_BUSY, CAL_DONE };
static CalState calState = CAL_IDLE;
static int calSampleCount = 0;
static float calSum = 0;

bool initMPU6050() {
  for (int attempt = 0; attempt < 3; attempt++) {
    Wire.beginTransmission(MPU_ADDR);
    if (Wire.endTransmission() == 0) {
      writeMPU(MPU_PWR1, 0);
      delay(100);

      calState = CAL_BUSY;
      calSampleCount = 0;
      calSum = 0;
      gzOffset = 0;

      mpuReady = true;
      lastMPU = millis();
      Serial.println("[MPU] OK (cal background)");
      return true;
    }
    Serial.printf("[MPU] attempt %d — not found\n", attempt + 1);
    delay(50);
  }

  Serial.println("[MPU] not found after 3 attempts");
  mpuReady = false;
  calState = CAL_IDLE;
  return false;
}

bool isMPUReady() { return mpuReady; }

void readMPU6050() {
  if (!mpuReady) return;
  unsigned long now = millis();
  int minInterval = (calState == CAL_BUSY) ? 5 : 30;
  if (now - lastMPU < minInterval) return;
  if (now - lastMPU > 500) lastMPU = now - 10;

  byte buf[14] = {0};
  if (!readMPURaw(MPU_ACCEL, buf, 14)) {
    if (++i2cFailCount >= 20) { resetWire0(); }
    return;
  }
  i2cFailCount = 0;

  ax = (buf[0] << 8) | buf[1];
  ay = (buf[2] << 8) | buf[3];
  az = (buf[4] << 8) | buf[5];
  gx = (buf[8] << 8) | buf[9];
  gy = (buf[10] << 8) | buf[11];
  gz = (buf[12] << 8) | buf[13];

  if (calState == CAL_BUSY) {
    calSum += gz / 131.0;
    calSampleCount++;
    if (calSampleCount >= CAL_SAMPLES) {
      gzOffset = calSum / CAL_SAMPLES;
      calState = CAL_DONE;
      Serial.printf("[MPU] gyroZ offset: %.2f\n", gzOffset);
    }
    lastMPU = now;
    return;
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
  const char* calLabel = (calState == CAL_IDLE) ? "idle" : (calState == CAL_BUSY) ? "busy" : "done";
  s += " cal=" + String(calLabel);
  if (calState == CAL_BUSY) s += " " + String(calSampleCount) + "/" + String(CAL_SAMPLES);
  s += " offsetZ=" + String(gzOffset, 2);
  s += " ax=" + String(ax) + " ay=" + String(ay) + " az=" + String(az);
  s += " gx=" + String(gx) + " gy=" + String(gy) + " gz=" + String(gz);
  return s;
}

String scanI2C() {
  String s; s.reserve(256);
  s = "[I2C] scan Wire0...\n";
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
  s += "\n[I2C] " + String(n) + " device(s) on Wire0";

  s += "\n[I2C] scan Wire1...\n";
  n = 0;
  for (addr = 1; addr < 127; addr++) {
    Wire1.beginTransmission(addr);
    err = Wire1.endTransmission();
    if (err == 0) {
      s += " 0x" + String(addr, HEX);
      n++;
    }
  }
  if (n == 0) s += " none found";
  s += "\n[I2C] " + String(n) + " device(s) on Wire1";
  return s;
}

// ============================================================
// Servo — LEDC channel 8
// ============================================================
#define SERVO_CH 8
#define SERVO_FREQ 50
#define SERVO_RES 12

static int servoAngle = 90;
static bool servoAttached = false;

void initServo() {
  ledcSetup(SERVO_CH, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_PIN, SERVO_CH);
  servoAttached = true;
  uint32_t duty = map(90, 0, 180, 205, 410);
  ledcWrite(SERVO_CH, duty);
  servoAngle = 90;
}

static void servoDetachForI2C() {
  if (servoAttached) {
    ledcDetachPin(SERVO_PIN);
    servoAttached = false;
  }
}

static void servoAttachAfterI2C() {
  if (!servoAttached) {
    ledcAttachPin(SERVO_PIN, SERVO_CH);
    uint32_t duty = map(servoAngle, 0, 180, 205, 410);
    ledcWrite(SERVO_CH, duty);
    servoAttached = true;
  }
}

void setServoAngle(int deg) {
  deg = constrain(deg, 0, 180);
  servoAngle = deg;
  uint32_t duty = map(deg, 0, 180, 205, 410);
  ledcWrite(SERVO_CH, duty);
}

int getServoAngle() { return servoAngle; }
