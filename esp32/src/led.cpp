#include "led.h"
#include "pins.h"

static const uint8_t ledPins[LED_COUNT] = {PIN_LED_1, PIN_LED_2, PIN_LED_3, PIN_LED_4};
static int ledBase = 0;
static int ledMode = LED_MODE_AUTO;
static int ledBlink = 0;
static unsigned long lastToggle = 0;

void initLEDs() {
  for (int i = 0; i < LED_COUNT; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);
  }
}

static void writePins(int mask) {
  for (int i = 0; i < LED_COUNT; i++)
    digitalWrite(ledPins[i], (mask >> i) & 1 ? HIGH : LOW);
}

void setLED(int idx, bool on) {
  if (idx < 0 || idx >= LED_COUNT) return;
  if (on)
    ledBase |= (1 << idx);
  else
    ledBase &= ~(1 << idx);
  if (ledMode == LED_MODE_AUTO) writePins(ledBase);
}

void setLEDs(int mask) {
  ledBase = mask & 0xF;
  if (ledMode == LED_MODE_AUTO || ledMode == LED_MODE_MANUAL) writePins(ledBase);
}

void setLEDMode(int mode) {
  if (mode < 0 || mode > LED_MODE_MANUAL) return;
  ledMode = mode;
  lastToggle = 0;
  if (mode == LED_MODE_AUTO) writePins(ledBase);
}

int getLEDs() { return ledMode == LED_MODE_AUTO ? ledBase : ledBlink; }
int getLEDMode() { return ledMode; }

void updateLEDs() {
  if (ledMode == LED_MODE_AUTO || ledMode == LED_MODE_MANUAL) return;

  unsigned long interval;
  int blinkMask;

  if (ledMode == LED_MODE_HAZARD) {
    interval = 300;
    blinkMask = 0xF;
  } else if (ledMode == LED_MODE_SIGNAL_L) {
    interval = 400;
    blinkMask = 0x05; // bit 0 dan 2 (LED kiri)
  } else {
    interval = 400;
    blinkMask = 0x0A; // bit 1 dan 3 (LED kanan)
  }

  unsigned long now = millis();
  if (now - lastToggle >= interval) {
    lastToggle = now;
    ledBlink = (ledBlink == blinkMask) ? 0 : blinkMask;
    writePins(ledBlink);
  }
}
