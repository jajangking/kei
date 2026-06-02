#define PWMA 25
#define AIN1 26
#define AIN2 27

#define PWMB 13
#define BIN1 14
#define BIN2 33

#define STBY 32
#define BUZZER 4

#define CH_LEFT 0
#define CH_RIGHT 1

int speed = 200;

void motorA(int spd) {
  spd = constrain(spd, -255, 255);
  if (spd > 0) {
    digitalWrite(AIN1, HIGH);
    digitalWrite(AIN2, LOW);
    ledcWrite(CH_LEFT, spd);
  } else if (spd < 0) {
    digitalWrite(AIN1, LOW);
    digitalWrite(AIN2, HIGH);
    ledcWrite(CH_LEFT, -spd);
  } else {
    digitalWrite(AIN1, LOW);
    digitalWrite(AIN2, LOW);
    ledcWrite(CH_LEFT, 0);
  }
}

void motorB(int spd) {
  spd = constrain(spd, -255, 255);
  if (spd > 0) {
    digitalWrite(BIN1, HIGH);
    digitalWrite(BIN2, LOW);
    ledcWrite(CH_RIGHT, spd);
  } else if (spd < 0) {
    digitalWrite(BIN1, LOW);
    digitalWrite(BIN2, HIGH);
    ledcWrite(CH_RIGHT, -spd);
  } else {
    digitalWrite(BIN1, LOW);
    digitalWrite(BIN2, LOW);
    ledcWrite(CH_RIGHT, 0);
  }
}

void stopAll() {
  motorA(0);
  motorB(0);
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(AIN1, OUTPUT);
  pinMode(AIN2, OUTPUT);
  pinMode(BIN1, OUTPUT);
  pinMode(BIN2, OUTPUT);
  pinMode(STBY, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  digitalWrite(STBY, HIGH);

  // Buzzer bip
  digitalWrite(BUZZER, HIGH);
  delay(100);
  digitalWrite(BUZZER, LOW);

  ledcSetup(CH_LEFT, 1000, 8);
  ledcAttachPin(PWMA, CH_LEFT);

  ledcSetup(CH_RIGHT, 1000, 8);
  ledcAttachPin(PWMB, CH_RIGHT);

  stopAll();

  Serial.println("motor_test started");
}

void loop() {
  Serial.println("--- Motor A maju ---");
  motorA(speed);
  motorB(0);
  delay(3000);
  stopAll();
  delay(1000);

  Serial.println("--- Motor B maju ---");
  motorA(0);
  motorB(speed);
  delay(3000);
  stopAll();
  delay(1000);

  Serial.println("--- Dua motor mundur ---");
  motorA(-speed);
  motorB(-speed);
  delay(3000);
  stopAll();
  delay(2000);
}
