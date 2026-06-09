#ifndef AUTONOMY_H
#define AUTONOMY_H

#include <Arduino.h>

#define SERVO_PIN 5

void initAutonomy();
void tickAutonomy(int *outLeft, int *outRight);
void setBehavior(const String &name);
String getBehavior();
bool getSafetyOverride();

// Servo
void setServoAngle(int deg);
int getServoAngle();

// Sector data
int getSector(int index); // 0=left(180°), 1=front(90°), 2=right(0°)

#endif
