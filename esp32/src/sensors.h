#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

#define SENSOR_SDA 21
#define SENSOR_SCL 22

bool initVL53L0X();
int readDistance();
bool isSensorReady();
String getSensorDiagnostic();

#endif
