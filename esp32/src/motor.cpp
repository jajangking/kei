#include "motor.h"
#include "pins.h"

int targetLeft = 0;
int targetRight = 0;
int currentLeft = 0;
int currentRight = 0;

static void writeA(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    digitalWrite(PIN_AIN1, HIGH); digitalWrite(PIN_AIN2, LOW); ledcWrite(PWM_MOT_A, speed);
  } else if (speed < 0) {
    digitalWrite(PIN_AIN1, LOW); digitalWrite(PIN_AIN2, HIGH); ledcWrite(PWM_MOT_A, -speed);
  } else {
    digitalWrite(PIN_AIN1, LOW); digitalWrite(PIN_AIN2, LOW); ledcWrite(PWM_MOT_A, 0);
  }
}

static void writeB(int speed) {
  speed = constrain(speed, -255, 255);
  if (speed > 0) {
    digitalWrite(PIN_BIN1, HIGH); digitalWrite(PIN_BIN2, LOW); ledcWrite(PWM_MOT_B, speed);
  } else if (speed < 0) {
    digitalWrite(PIN_BIN1, LOW); digitalWrite(PIN_BIN2, HIGH); ledcWrite(PWM_MOT_B, -speed);
  } else {
    digitalWrite(PIN_BIN1, LOW); digitalWrite(PIN_BIN2, LOW); ledcWrite(PWM_MOT_B, 0);
  }
}

void initMotors() {
  pinMode(PIN_AIN1, OUTPUT); pinMode(PIN_AIN2, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT); pinMode(PIN_BIN2, OUTPUT);
  digitalWrite(PIN_AIN1, LOW); digitalWrite(PIN_AIN2, LOW);
  digitalWrite(PIN_BIN1, LOW); digitalWrite(PIN_BIN2, LOW);
  pinMode(PIN_STBY, OUTPUT); digitalWrite(PIN_STBY, LOW);
  delay(500);
  digitalWrite(PIN_STBY, HIGH);
  ledcSetup(PWM_MOT_A, PWM_FREQ_MOTOR, PWM_RES); ledcAttachPin(PIN_PWMA, PWM_MOT_A);
  ledcSetup(PWM_MOT_B, PWM_FREQ_MOTOR, PWM_RES); ledcAttachPin(PIN_PWMB, PWM_MOT_B);
  stopMotors();
}

void setMotor(int left, int right) {
  targetLeft = left;
  targetRight = right;
}

void rampMotors() {
  if (currentLeft == targetLeft && currentRight == targetRight) return;
  extern int rampRate;
  if (rampRate >= 255) {
    currentLeft = targetLeft; currentRight = targetRight;
    writeA(currentLeft); writeB(currentRight);
    return;
  }
  auto step = [](int &cur, int tgt, int rate) {
    if (cur == tgt) return;
    cur += (tgt > cur) ? rate : -rate;
    if (abs(cur - tgt) < rate) cur = tgt;
    cur = constrain(cur, -255, 255);
  };
  if (currentLeft != targetLeft) { step(currentLeft, targetLeft, rampRate); writeA(currentLeft); }
  if (currentRight != targetRight) { step(currentRight, targetRight, rampRate); writeB(currentRight); }
}

void stopMotors() {
  targetLeft = 0; targetRight = 0;
  currentLeft = 0; currentRight = 0;
  writeA(0); writeB(0);
}
