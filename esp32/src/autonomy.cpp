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
#define SCAN_WAIT      250

static String behavior = "stop";
static String phase = "idle";
static unsigned long phaseStart = 0;
static bool turnRight = true;
static int stuckCount = 0;
static bool safetyOverride = false;

// Scan state
static int scanStep = 0;
static unsigned long scanStepTime = 0;
static int sectorDist[3] = {-1, -1, -1}; // 0=left(180°), 1=front(90°), 2=right(0°)

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
  scanStep = 0;
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

  int dist = readDistance();
  bool blocked = (dist > 0 && dist < getSafetyThreshold());
  unsigned long now = millis();

  if (behavior == "explore") {
    if (phase == "idle") {
      phase = "fwd";
      phaseStart = now;
      sectorDist[1] = dist;
      *outLeft = EXPLORE_SPEED;
      *outRight = EXPLORE_SPEED;
      return;
    }

    if (phase == "fwd") {
      sectorDist[1] = dist;
      if (blocked) {
        stuckCount++;
        Serial.printf("[AUTO] blocked %d dist=%d\n", stuckCount, dist);
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
        phase = "scan";
        scanStep = 1;
        scanStepTime = now;
        setServoAngle(0); // look right
        sectorDist[0] = -1; sectorDist[2] = -1;
      }
      *outLeft = REV_SPEED;
      *outRight = REV_SPEED;
      return;
    }

    if (phase == "scan") {
      if (scanStep == 1) {
        if (now - scanStepTime >= SCAN_WAIT) {
          sectorDist[2] = readDistance();
          scanStep = 2;
          scanStepTime = now;
          setServoAngle(180); // look left
        }
      } else if (scanStep == 2) {
        if (now - scanStepTime >= SCAN_WAIT) {
          sectorDist[0] = readDistance();
          scanStep = 3;
          scanStepTime = now;
          setServoAngle(90); // back to center
        }
      } else if (scanStep == 3) {
        if (now - scanStepTime >= SCAN_WAIT) {
          int ri = sectorDist[2], le = sectorDist[0];
          if (le > 0 && ri > 0)          turnRight = (ri >= le);
          else if (le > 0)               turnRight = false;
          else if (ri > 0)               turnRight = true;
          // else: stick with current turnRight (alternating)
          Serial.printf("[AUTO] scan L=%d R=%d turn=%s\n", le, ri, turnRight?"R":"L");
          scanStep = 0;
          phase = "turn";
          phaseStart = now;
        }
      }
      *outLeft = 0;
      *outRight = 0;
      return;
    }

    if (phase == "turn") {
      sectorDist[1] = dist;
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
