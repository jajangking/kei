#include "autonomy.h"
#include "sensors.h"

// ============================================================
// Servo
// ============================================================
#define SERVO_CH 3
#define SERVO_FREQ 50
#define SERVO_RES 16

static int servoAngle = 90;

void setServoAngle(int deg) {
  deg = constrain(deg, 0, 180);
  // 0°=1ms, 90°=1.5ms, 180°=2ms, period=20ms, duty 0-65535
  uint32_t duty = map(deg, 0, 180, 3277, 6554);
  ledcWrite(SERVO_CH, duty);
  servoAngle = deg;
}

int getServoAngle() { return servoAngle; }

// ============================================================
// Autonomy — ESP32-side explore/avoid state machine
// ============================================================
#define EXPLORE_SPEED  140
#define TURN_SPEED     100
#define REV_SPEED     -80
#define REV_MS         400

static String behavior = "stop";
static String phase = "idle";
static unsigned long phaseStart = 0;
static bool turnRight = true;
static int stuckCount = 0;

static bool safetyOverride = false;

void initAutonomy() {
  ledcSetup(SERVO_CH, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_PIN, SERVO_CH);
  setServoAngle(90);
  behavior = "stop";
  phase = "idle";
  Serial.println("[AUTO] init OK");
}

void setBehavior(const String &b) {
  behavior = b;
  phase = "idle";
  stuckCount = 0;
  safetyOverride = false;
  Serial.printf("[AUTO] behavior=%s\n", b.c_str());
}

String getBehavior() { return behavior; }
bool getSafetyOverride() { return safetyOverride; }

void tickAutonomy(int *outLeft, int *outRight) {
  *outLeft = 0;
  *outRight = 0;
  safetyOverride = false;

  if (behavior == "stop") return;

  int dist = readDistance();
  bool blocked = (dist > 0 && dist < getSafetyThreshold());
  unsigned long now = millis();

  if (behavior == "explore") {
    if (phase == "idle") {
      phase = "fwd";
      phaseStart = now;
      *outLeft = EXPLORE_SPEED;
      *outRight = EXPLORE_SPEED;
      return;
    }

    if (phase == "fwd") {
      if (blocked) {
        stuckCount++;
        phase = "rev";
        phaseStart = now;
        turnRight = (stuckCount % 2 == 0);
        *outLeft = REV_SPEED;
        *outRight = REV_SPEED;
        return;
      }
      *outLeft = EXPLORE_SPEED;
      *outRight = EXPLORE_SPEED;
      return;
    }

    if (phase == "rev") {
      if (now - phaseStart >= REV_MS) {
        phase = "turn";
        phaseStart = now;
      }
      *outLeft = REV_SPEED;
      *outRight = REV_SPEED;
      return;
    }

    if (phase == "turn") {
      if (!blocked) {
        phase = "fwd";
        *outLeft = EXPLORE_SPEED;
        *outRight = EXPLORE_SPEED;
        return;
      }
      // Timeout safety: if turning > 5s, try other direction
      if (now - phaseStart > 5000) {
        turnRight = !turnRight;
        phaseStart = now;
      }
      if (turnRight) {
        *outLeft = TURN_SPEED;
        *outRight = -TURN_SPEED;
      } else {
        *outLeft = -TURN_SPEED;
        *outRight = TURN_SPEED;
      }
      return;
    }
  }
}
