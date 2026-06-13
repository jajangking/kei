#ifndef LED_H
#define LED_H

#include <Arduino.h>

#define LED_COUNT 4

#define LED_MODE_AUTO     0
#define LED_MODE_HAZARD   1
#define LED_MODE_SIGNAL_L 2
#define LED_MODE_SIGNAL_R 3

void initLEDs();
void setLED(int idx, bool on);
void setLEDs(int mask);
void setLEDMode(int mode);
int  getLEDs();
int  getLEDMode();
void updateLEDs();

#endif
