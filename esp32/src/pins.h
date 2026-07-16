#ifndef PINS_H
#define PINS_H

#define FW_VERSION "2.0.1-powersave " __DATE__ " " __TIME__

#define PIN_LED    2
#define PIN_BUZZ   4

#define PIN_PWMA  25
#define PIN_AIN1  26
#define PIN_AIN2  27
#define PIN_PWMB  13
#define PIN_BIN1  14
#define PIN_BIN2  33
#define PIN_STBY  32

#define PIN_SDA   21
#define PIN_SCL   22

// LED eksternal (2 putih depan, 2 merah belakang)
// Note: GPIO0 & 15 aman dipake sebagai output setelah boot
#define PIN_LED_1   5
#define PIN_LED_2  23
#define PIN_LED_3   0
#define PIN_LED_4  15

#define PWM_MOT_A  0
#define PWM_MOT_B  1
#define PWM_BUZZ   2
#define PWM_SERVO  3

#define PWM_FREQ_MOTOR  1000
#define PWM_FREQ_SERVO  50
#define PWM_RES         8
#define PWM_RES_SERVO   12
#define MOTOR_TIMEOUT_DEFAULT 300

#endif
