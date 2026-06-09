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

// Continuous sweep — always updating sectors while driving
#define SWEEP_MS    150
static const int sweepPath[] = {90, 60, 30, 60, 90, 120, 150, 120};
#define SWEEP_LEN (sizeof(sweepPath)/sizeof(sweepPath[0]))
static int sweepIdx = 0;
static unsigned long lastSweep = 0;

static String behavior = "stop";
static String phase = "idle";
static unsigned long phaseStart = 0;
static bool turnRight = true;
static int stuckCount = 0;
static bool safetyOverride = false;

// Sector distances: 0=left(180°), 1=front(90°), 2=right(0°)
static int sectorDist[3] = {-1, -1, -1};

static void doSweep(unsigned long now) {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  int a = sweepPath[sweepIdx];
  sweepIdx = (sweepIdx + 1) % SWEEP_LEN;
  setServoAngle(a);
  int d = readDistance();
  if (a <= 30)       sectorDist[2] = d; // right
  else if (a >= 150) sectorDist[0] = d; // left
  else               sectorDist[1] = d; // front
}

static void pickTurn() {
  int le = sectorDist[0], ri = sectorDist[2];
  if (le > 0 && ri > 0)          turnRight = (ri >= le);
  else if (le > 0)               turnRight = false;
  else if (ri > 0)               turnRight = true;
  // else keep current (alternating default)
  Serial.printf("[AUTO] pickTurn L=%d R=%d -> %s\n", le, ri, turnRight?"R":"L");
}

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
int getSector(int idx) { if (idx < 0 || idx > 2) return -1; return sectorDist[idx]; }

void tickAutonomy(int *outLeft, int *outRight) {
  *outLeft = 0;
  *outRight = 0;
  safetyOverride = false;

  if (behavior == "stop") return;

  int frontDist = sectorDist[1];
  bool blocked = (frontDist > 0 && frontDist < getSafetyThreshold());
  unsigned long now = millis();

  if (behavior == "explore") {
    if (phase == "idle") {
      phase = "fwd";
      phaseStart = now;
      sectorDist[1] = readDistance();
      *outLeft = EXPLORE_SPEED;
      *outRight = EXPLORE_SPEED;
      return;
    }

    if (phase == "fwd") {
      doSweep(now);
      if (blocked) {
        stuckCount++;
        Serial.printf("[AUTO] blocked %d front=%d\n", stuckCount, frontDist);
        pickTurn();
        phase = "rev";
        phaseStart = now;
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
        setServoAngle(90); // center servo during turn
      }
      *outLeft = REV_SPEED;
      *outRight = REV_SPEED;
      return;
    }

    if (phase == "turn") {
      sectorDist[1] = readDistance();
      if (!blocked) {
        phase = "fwd";
        *outLeft = EXPLORE_SPEED;
        *outRight = EXPLORE_SPEED;
        return;
      }
      if (now - phaseStart > 5000) {
        turnRight = !turnRight;
        phaseStart = now;
      }
      if (turnRight) { *outLeft = TURN_SPEED; *outRight = -TURN_SPEED; }
      else           { *outLeft = -TURN_SPEED; *outRight = TURN_SPEED; }
      return;
    }
  }
}
