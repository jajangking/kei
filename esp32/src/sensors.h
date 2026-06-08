#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

#define SENSOR_SDA 21
#define SENSOR_SCL 22

#define ALT_SDA 16
#define ALT_SCL 17

bool initVL53L0X();
int readDistance();
int readDistanceRaw();
bool isSensorReady();
String getSensorDiagnostic();
void setSafetyThreshold(int mm); // default 200
int getSafetyThreshold();

#endif
