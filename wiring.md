# WIRING KEi ROBOT

## ESP32 → VL53L0X
```
ESP32            VL53L0X
5V  ───────────  VIN
3.3V ─────────── XSHUT
GND ───────────  GND
GPIO21 ────────  SDA
GPIO22 ────────  SCL
```

## ESP32 → TB6612 (Motor Driver)
```
ESP32            TB6612
3.3V ─────────── VCC
3.3V ─────────── STBY
GND ───────────  GND
GPIO25 ────────  PWMA
GPIO26 ────────  AIN1
GPIO27 ────────  AIN2
GPIO13 ────────  PWMB
GPIO14 ────────  BIN1
GPIO33 ────────  BIN2
```

## TB6612 → Motor DC
```
TB6612           MOTOR
A01 ───────────  Kiri (+)
A02 ───────────  Kiri (-)
B01 ───────────  Kanan (+)
B02 ───────────  Kanan (-)
```

## TB6612 → Batere
```
TB6612           BATERE (+)
VM ───────────── Pin (+) baterai
```

## ESP32 → Buzzer
```
ESP32            BUZZER
GPIO4 ────────── I/O
3.3V ─────────── VCC
GND ───────────  GND
```

## Batere → Voltage Divider (ukur tegangan di dashboard)
```
BATERE (+) ── R1 (2×220Ω seri = 440Ω) ── GPIO34 ── R2 (220Ω) ── GND
```
