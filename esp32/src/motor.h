#ifndef MOTOR_H
#define MOTOR_H

#include <Arduino.h>

extern int targetLeft;
extern int targetRight;
extern int currentLeft;
extern int currentRight;

void initMotors();
void setMotor(int left, int right);
void rampMotors();
void stopMotors();

#endif
