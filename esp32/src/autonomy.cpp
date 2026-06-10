#include "autonomy.h"
#include "sensors.h"

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
#define TURN_SPEED     100
#define REV_SPEED     -80
#define REV_MS         600
#define MIN_TURN_MS    400
#define SWEEP_MS       200
#define HYSTERESIS     80

static const int sweepPath[] = {90, 60, 30, 60, 90, 120, 150, 120};
#define SWEEP_LEN (sizeof(sweepPath)/sizeof(sweepPath[0]))
static int sweepIdx = 0;
static unsigned long lastSweep = 0;

static String behavior = "stop";
static String phase = "idle";
static unsigned long phaseStart = 0;
static bool turnRight = true;
static int stuckCount = 0;
static bool wasBlocked = false;
static bool safetyOverride = false;
static unsigned long exploreStart = 0;
static unsigned long stuckStart = 0;
static int exploreSpeed = 140;

static int sectorDist[3] = {-1, -1, -1};

static void doSweep(unsigned long now) {
  if (now - lastSweep < SWEEP_MS) return;
  lastSweep = now;
  int a = sweepPath[sweepIdx];
  sweepIdx = (sweepIdx + 1) % SWEEP_LEN;
  setServoAngle(a);
  int d = readDistanceRaw();
  if (a <= 30)       sectorDist[2] = d;
  else if (a >= 150) sectorDist[0] = d;
  else               sectorDist[1] = d;
}

static void pickTurn() {
  int le = sectorDist[0], ri = sectorDist[2];
  if (le > 0 && ri > 0)          turnRight = (ri >= le);
  else if (le > 0)               turnRight = false;
  else if (ri > 0)               turnRight = true;
  Serial.printf("[AUTO] pickTurn L=%d R=%d -> %s\n", le, ri, turnRight?"R":"L");
}

void initAutonomy() {
  ledcSetup(SERVO_CH, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_PIN, SERVO_CH);
  setServoAngle(90);
  behavior = "stop";
  phase = "idle";
  wasBlocked = false;
  Serial.println("[AUTO] init OK");
}

void setBehavior(const String &b) {
  behavior = b;
  phase = "idle";
  stuckCount = 0;
  safetyOverride = false;
  wasBlocked = false;
  exploreStart = millis();
  stuckStart = 0;
  Serial.printf("[AUTO] behavior=%s\n", b.c_str());
}

String getBehavior() { return behavior; }
bool getSafetyOverride() { return safetyOverride; }
int getSector(int idx) { if (idx < 0 || idx > 2) return -1; return sectorDist[idx]; }

static bool isBlockedHysteresis(int dist) {
  if (wasBlocked)
    return (dist > 0 && dist < getSafetyThreshold() + HYSTERESIS);
  return (dist > 0 && dist < getSafetyThreshold());
}

void setExploreSpeed(int speed) { exploreSpeed = constrain(speed, 60, 255); }
int getExploreSpeed() { return exploreSpeed; }

void tickAutonomy(int *outLeft, int *outRight) {
  *outLeft = 0;
  *outRight = 0;
  safetyOverride = false;

  if (behavior == "stop") return;

  int frontDist = sectorDist[1];
  bool blocked = isBlockedHysteresis(frontDist);
  unsigned long now = millis();

  if (blocked != wasBlocked) {
    wasBlocked = blocked;
    if (!blocked) Serial.printf("[AUTO] unblocked front=%d\n", frontDist);
  }

  if (behavior == "explore") {
    if (phase == "idle") {
      phase = "fwd";
      phaseStart = now;
      exploreStart = now;
      stuckStart = 0;
      stuckCount = 0;
      doSweep(now);
      *outLeft = exploreSpeed;
      *outRight = exploreSpeed;
      return;
    }

    if (phase == "fwd") {
      doSweep(now);
      if (blocked) {
        stuckCount++;
        if (stuckStart == 0) stuckStart = now;
        Serial.printf("[AUTO] blocked #%d front=%d\n", stuckCount, frontDist);
        pickTurn();
        phase = "rev";
        phaseStart = now;
        *outLeft = REV_SPEED;
        *outRight = REV_SPEED;
        return;
      }
      *outLeft = exploreSpeed;
      *outRight = exploreSpeed;
      return;
    }

    if (phase == "rev") {
      if (now - phaseStart >= REV_MS) {
        phase = "turn";
        phaseStart = now;
        setServoAngle(90);
      }
      *outLeft = REV_SPEED;
      *outRight = REV_SPEED;
      return;
    }

    if (phase == "turn") {
      doSweep(now);

      // Stuck: stuck > 5s in avoid cycle → wider turn
      bool stuckStall = (stuckStart > 0 && now - stuckStart > 5000);

      if (stuckStall) {
        Serial.println("[AUTO] stuck — spin wider");
        int s = TURN_SPEED + 40;
        if (turnRight) { *outLeft = s; *outRight = -s; }
        else           { *outLeft = -s; *outRight = s; }
        return;
      }

      if (now - phaseStart < MIN_TURN_MS) {
        if (turnRight) { *outLeft = TURN_SPEED; *outRight = -TURN_SPEED; }
        else           { *outLeft = -TURN_SPEED; *outRight = TURN_SPEED; }
        return;
      }

      if (!blocked) {
        phase = "fwd";
        stuckStart = 0;
        *outLeft = exploreSpeed;
        *outRight = exploreSpeed;
        return;
      }

      if (now - phaseStart > 5000) {
        turnRight = !turnRight;
        phaseStart = now;
        Serial.println("[AUTO] turn flip");
      }
      if (turnRight) { *outLeft = TURN_SPEED; *outRight = -TURN_SPEED; }
      else           { *outLeft = -TURN_SPEED; *outRight = TURN_SPEED; }
      return;
    }
  }
}
