#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

#define SENSOR_SDA 21
#define SENSOR_SCL 22

// VL53L0X
bool initVL53L0X();
int readDistance();
int readDistanceRaw();
bool isSensorReady();
String getSensorDiagnostic();
void setSafetyThreshold(int mm);
int getSafetyThreshold();
void retrySensor();

// MPU6050
bool initMPU6050();
bool isMPUReady();
void readMPU6050();
float getRoll();
float getPitch();
float getYaw();
float getGyroZ();
void resetYaw();

// Servo
#define SERVO_PIN 5
void setServoAngle(int deg); // 0-180

// Autonomy
void initAutonomy();
void tickAutonomy();
void setBehavior(const String &name); // explore, stop, etc.
String getBehavior();

#endif
