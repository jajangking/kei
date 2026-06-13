#include "led.h"
#include "pins.h"

static const uint8_t ledPins[LED_COUNT] = {PIN_LED_1, PIN_LED_2, PIN_LED_3, PIN_LED_4};
static int ledState = 0;

void initLEDs() {
  for (int i = 0; i < LED_COUNT; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);
  }
}

void setLED(int idx, bool on) {
  if (idx < 0 || idx >= LED_COUNT) return;
  digitalWrite(ledPins[idx], on ? HIGH : LOW);
  if (on)
    ledState |= (1 << idx);
  else
    ledState &= ~(1 << idx);
}

void setLEDs(int mask) {
  for (int i = 0; i < LED_COUNT; i++) {
    bool on = (mask >> i) & 1;
    digitalWrite(ledPins[i], on ? HIGH : LOW);
  }
  ledState = mask & 0xF;
}

int getLEDs() { return ledState; }
