#ifndef LED_H
#define LED_H

#include <Arduino.h>

#define LED_COUNT 4

void initLEDs();
void setLED(int idx, bool on);
void setLEDs(int mask);
int getLEDs();

#endif
