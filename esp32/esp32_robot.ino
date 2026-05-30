#include <WiFi.h>
#include <WebSocketsServer_Generic.h>

// WIFI
const char* ssid = "STARLINK";
const char* password = "12345678910";

// WebSocket
WebSocketsServer webSocket(81);

// =======================
// TB6612FNG PINS
// =======================

// LEFT MOTOR
#define PWMA 25
#define AIN1 26
#define AIN2 27

// RIGHT MOTOR
#define PWMB 13
#define BIN1 14
#define BIN2 12

// STBY
#define STBY 33

// MAX SPEED
#define MAX_SPEED 255;

// =======================
// SETUP
// =======================

void setup() {

Serial.begin(115200);

// Motor pins
pinMode(AIN1, OUTPUT);
pinMode(AIN2, OUTPUT);

pinMode(BIN1, OUTPUT);
pinMode(BIN2, OUTPUT);

pinMode(STBY, OUTPUT);

digitalWrite(STBY, HIGH);

// PWM
ledcAttach(PWMA, 1000, 8);
ledcAttach(PWMB, 1000, 8);

stopMotors();

// WiFi
WiFi.begin(ssid, password);

Serial.print("Connecting WiFi");

while (WiFi.status() != WL_CONNECTED) {

delay(500);  
Serial.print(".");

}

Serial.println("");
Serial.println("WiFi Connected");

Serial.print("IP: ");
Serial.println(WiFi.localIP());

// WebSocket
webSocket.begin();

webSocket.onEvent(webSocketEvent);

Serial.println("WebSocket Started");
}

// =======================
// LOOP
// =======================

void loop() {

webSocket.loop();
}

// =======================
// WEBSOCKET EVENT
// =======================

void webSocketEvent(
uint8_t num,
WStype_t type,
uint8_t * payload,
size_t length
) {

switch(type) {

case WStype_CONNECTED:  

  Serial.println("Client Connected");  

  break;  

case WStype_DISCONNECTED:  

  Serial.println("Client Disconnected");  

  stopMotors();  

  break;  

case WStype_TEXT:  

  handleMessage(String((char*)payload));  

  break;  

default:  
  break;

}
}

// =======================
// HANDLE JSON MESSAGE
// =======================

void handleMessage(String msg) {

Serial.print("Received: ");
Serial.println(msg);

int leftMotor = 0;
int rightMotor = 0;

// Parse leftMotor
int leftIdx = msg.indexOf("\"leftMotor\"");

if (leftIdx >= 0) {

int colon = msg.indexOf(':', leftIdx);  
int comma = msg.indexOf(',', colon);  

if (comma < 0) {  
  comma = msg.indexOf('}', colon);  
}  

String val = msg.substring(colon + 1, comma);  

val.trim();  

leftMotor = val.toInt();

}

// Parse rightMotor
int rightIdx = msg.indexOf("\"rightMotor\"");

if (rightIdx >= 0) {

int colon = msg.indexOf(':', rightIdx);  
int comma = msg.indexOf(',', colon);  

if (comma < 0) {  
  comma = msg.indexOf('}', colon);  
}  

String val = msg.substring(colon + 1, comma);  

val.trim();  

rightMotor = val.toInt();

}

setMotorA(leftMotor);
setMotorB(rightMotor);
}

// =======================
// MOTOR A
// =======================

void setMotorA(int speed) {

speed = constrain(speed, -255, 255);

if (speed > 0) {

digitalWrite(AIN1, HIGH);  
digitalWrite(AIN2, LOW);  

ledcWrite(PWMA, speed);

} else if (speed < 0) {

digitalWrite(AIN1, LOW);  
digitalWrite(AIN2, HIGH);  

ledcWrite(PWMA, -speed);

} else {

digitalWrite(AIN1, LOW);  
digitalWrite(AIN2, LOW);  

ledcWrite(PWMA, 0);

}
}

// =======================
// MOTOR B
// =======================

void setMotorB(int speed) {

speed = constrain(speed, -255, 255);

if (speed > 0) {

digitalWrite(BIN1, HIGH);  
digitalWrite(BIN2, LOW);  

ledcWrite(PWMB, speed);

} else if (speed < 0) {

digitalWrite(BIN1, LOW);  
digitalWrite(BIN2, HIGH);  

ledcWrite(PWMB, -speed);

} else {

digitalWrite(BIN1, LOW);  
digitalWrite(BIN2, LOW);  

ledcWrite(PWMB, 0);

}
}

// =======================
// STOP
// =======================

void stopMotors() {

ledcWrite(PWMA, 0);
ledcWrite(PWMB, 0);

digitalWrite(AIN1, LOW);
digitalWrite(AIN2, LOW);

digitalWrite(BIN1, LOW);
digitalWrite(BIN2, LOW);
}
