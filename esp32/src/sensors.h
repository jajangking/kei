#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

// MPU6050 di Wire0 (pin SDA=21, SCL=22) — didefinisi di pins.h
// VL53L0X di Wire1 (pin terpisah)
#define VL_SDA      16
#define VL_SCL      17
#define VL_XSHUT_PIN 19

// VL53L0X
bool initVL53L0X();
int readDistance();
int readDistanceRaw();
bool isSensorReady();
String getSensorDiagnostic();
void retrySensor();

// MPU6050
bool initMPU6050();
bool isMPUReady();
void readMPU6050();
void retryMPU(); // retry init di background kalo gagal
float getRoll();
float getPitch();
float getYaw();
float getGyroZ();
void resetYaw();
String getMPUDiagnostic();

// I2C scan (Wire0)
String scanI2C();

// Servo
#define SERVO_PIN 18
void initServo();
void setServoAngle(int deg); // 0-180
int getServoAngle();

#endif
