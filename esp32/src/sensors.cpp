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

static int i2cFailCount = 0;

// Rate-limiter
#define VL_READ_INTERVAL 200
#define VL_FAIL_BACKOFF  1000
static unsigned long lastVLRead = 0;
static int vlFailCount = 0;

static void I2C_ClearBus() {
  // Toggle SCL 9x to release stuck SDA (ref: pololu/vl53l0x-arduino#50)
  pinMode(SENSOR_SCL, OUTPUT);
  pinMode(SENSOR_SDA, INPUT_PULLUP);
  for (int i = 0; i < 9; i++) {
    digitalWrite(SENSOR_SCL, LOW);
    delayMicroseconds(10);
    digitalWrite(SENSOR_SCL, HIGH);
    delayMicroseconds(10);
  }
  // Send STOP condition
  pinMode(SENSOR_SDA, OUTPUT);
  digitalWrite(SENSOR_SDA, LOW);
  delayMicroseconds(10);
  digitalWrite(SENSOR_SCL, HIGH);
  delayMicroseconds(10);
  digitalWrite(SENSOR_SDA, HIGH);
  delayMicroseconds(10);
  // Restore to INPUT (Wire.begin() will reconfigure)
  pinMode(SENSOR_SDA, INPUT);
  pinMode(SENSOR_SCL, INPUT);
}

static void servoDetachForI2C();
static void servoAttachAfterI2C();

static void resetI2C() {
  servoDetachForI2C();

  Wire.end();
  delay(20);
  I2C_ClearBus();
  Wire.begin(SENSOR_SDA, SENSOR_SCL);
  Wire.setClock(100000);
  Wire.setTimeout(50);
  i2cFailCount = 0;
  vlFailCount = 0;
  delay(50);
  initVL53L0X();
  delay(20);
  initMPU6050();

  servoAttachAfterI2C();
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
  vlReady = false;

  pinMode(VL_XSHUT_PIN, OUTPUT);

  for (int attempt = 0; attempt < 3; attempt++) {
    // Hard reset sensor via XSHUT
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

    if (lox.begin()) {
      Wire.setClock(100000);
      diagLog += " — OK";
      vlReady = true;
      return true;
    }
    diagLog += " — begin() gagal";
  }

  diagLog += "\n[VL53L0X] semua attempt gagal — skip";
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
  if (m.RangeStatus != 0 || m.RangeMilliMeter > 4000) {
    if (++vlFailCount >= 10) { resetI2C(); return -1; }
    return -1;
  }
  vlFailCount = 0;
  i2cFailCount = 0;
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

static bool readMPURaw(byte reg, byte* buf, int len) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom(MPU_ADDR, len);
  int n = Wire.available();
  for (int i = 0; i < len && i < n; i++) buf[i] = Wire.read();
  return n == len;
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
  for (int attempt = 0; attempt < 3; attempt++) {
    Wire.beginTransmission(MPU_ADDR);
    if (Wire.endTransmission() == 0) {
      writeMPU(MPU_PWR1, 0);
      delay(100);

      calInProgress = true;
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
  return false;
}

bool isMPUReady() { return mpuReady; }

void readMPU6050() {
  if (!mpuReady) return;
  unsigned long now = millis();
  int minInterval = calInProgress ? 5 : 30; // kalibrasi lebih cepet
  if (now - lastMPU < minInterval) return;
  if (now - lastMPU > 500) lastMPU = now - 10; // clamp dt kalo lama

  byte buf[14] = {0};
  if (!readMPURaw(MPU_ACCEL, buf, 14)) {
    if (++i2cFailCount >= 20) { resetI2C(); }
    return;
  }
  i2cFailCount = 0;

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
// Servo — LEDC channel 8 (low-speed, grup beda dari motor)
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
