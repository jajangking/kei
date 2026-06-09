# WIRING — Sambungin sesuai urutan baris biar kabel rapi

## 1. Power (sambungin ini DULUAN)

| ESP32 | kabel | komponen |
|---|---|---|
| **5V** | merah | VIN VL53L0X |
| **5V** | merah | VM TB6612 (power motor) |
| **3.3V** | orange | VCC TB6612 |
| **GPIO15** | orange | XSHUT VL53L0X |
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
| **GPIO32** | abu | STBY |
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
Batere (+) ── R1 (2×220Ω seri = 440Ω) ── GPIO34 ── R2 (220Ω) ── GND
```

Cara bikin R1: sambungin 2 resistor 220Ω secara seri (berantai). GPIO34 kebaca 2.6V di batere 7.4V (aman).

## 7. Servo SG90

| ESP32 | kabel | Servo |
|---|---|---|
| **GPIO5** | kuning | Signal |
| **5V** | merah | VCC |
| **GND** | coklat/hitam | GND |

## 8. MPU6050 (gyro + accelerometer, 6-axis)

Bagikan bus I2C sama VL53L0X.

| ESP32 | kabel | MPU6050 |
|---|---|---|
| **GPIO21** | hijau | SDA |
| **GPIO22** | kuning | SCL |
| **3.3V** | orange | VCC |
| **GND** | hitam | GND |
| **GND** | hitam | AD0 (set address 0x68) |

AD0 langsung ke GND (pilih I2C address 0x68). Jangan di-fly. Jangan pake 5V — MPU6050 cuma toleran 3.3V.

---

## Troubleshooting — VL53L0X gak kedetek

### 1. XSHUT harus GPIO, bukan 3.3V

Dulu XSHUT ke 3.3V — kalau pinnya longgar atau ada cold solder, sensornya half-enabled dan gak respond di I2C.

**Fix:** Pindahin XSHUT ke **GPIO15**. Kode bakal set HIGH pas init (`digitalWrite(VL_XSHUT_PIN, HIGH)`). Ini juga bisa hard-reset sensor via `retrySensor()` (pulse LOW → HIGH) tanpa restart ESP.

### 2. Wire.setTimeout jangan 10ms

`initVL53L0X()` dulu pake `Wire.setTimeout(10)` sebelum probing — terlalu agresif. Sensor butuh waktu lebih buat ngerespon.

**Fix:** Gak usah set timeout di init. Biarin pake default 50ms dari `Wire.setTimeout(50)` di `setup()`.

### 3. Retry init via command

Kalau sensor tetep gak kedetek pas boot, kirim:
```
POST /cmd {"retrySensor": true}
```
Atau buka `/diag` → klik "⟳ Retry VL53L0X". Ini bakal pulse XSHUT LOW→HIGH + coba init ulang.

### 4. I2C address alternatif

Kode sekarang nyoba **0x29** (default) dulu, terus **0x30** (beberapa breakout pake address alternatif via solder pad).

### 5. Cek wiring

| Pin VL53L0X | Koneksi |
|---|---|
| VIN | 5V (bukan 3.3V — butuh 5V buat VCSEL laser) |
| GND | GND |
| SDA | GPIO21 |
| SCL | GPIO22 |
| XSHUT | GPIO15 |

Kalo masih gak kedetek, cek voltase di VIN (5V) sama kontinuitas SDA/SCL. Kalo semua bener, breakout board mungkin rusak.
