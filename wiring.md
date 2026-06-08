# WIRING — Sambungin sesuai urutan baris biar kabel rapi

## 1. Power (sambungin ini DULUAN)

| ESP32 | kabel | komponen |
|---|---|---|
| **5V** | merah | VIN VL53L0X |
| **5V** | merah | VM TB6612 (power motor) |
| **3.3V** | orange | VCC TB6612 |
| **3.3V** | orange | STBY TB6612 |
| **3.3V** | orange | XSHUT VL53L0X |
| **3.3V** | orange | VCC Buzzer |
| **GND** | hitam | GND VL53L0X |
| **GND** | hitam | GND TB6612 |
| **GND** | hitam | GND Buzzer |
| **GND** | hitam | GND Batere (-) |

## 2. I2C Sensor

| ESP32 | kabel | VL53L0X |
|---|---|---|
| **GPIO21** | hijau | SDA |
| **GPIO22** | kuning | SCL |

## 3. Motor Driver

| ESP32 | kabel | TB6612 |
|---|---|---|
| **GPIO25** | biru | PWMA |
| **GPIO26** | putih | AIN1 |
| **GPIO27** | coklat | AIN2 |
| **GPIO13** | biru | PWMB |
| **GPIO14** | putih | BIN1 |
| **GPIO33** | coklat | BIN2 |

## 4. Motor DC

| TB6612 | kabel | Motor |
|---|---|---|
| **A01** | abu | Kiri (+) |
| **A02** | abu | Kiri (-) |
| **B01** | abu | Kanan (+) |
| **B02** | abu | Kanan (-) |

## 5. Buzzer

| ESP32 | kabel | Buzzer |
|---|---|---|
| **GPIO4** | ungu | I/O |
| *udah di power section di atas* | | |

## 6. Voltage Divider (ukur tegangan batere)

```
Batere (+) ── R1 (220Ω) ── GPIO34 ── R2 (2×220Ω seri = 440Ω) ── GND
```

Cara bikin R2: sambungin 2 resistor 220Ω secara seri (berantai). GPIO34 kebaca 2.6V (aman).
