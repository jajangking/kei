#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#include <Preferences.h>

struct RuntimeCfg {
  int maxSpeed = 255;
  int rampRate = 255;
  int motorTimeout = 300;
  int leftTrim = 0;
  int rightTrim = 0;
};

struct SpeedLimitCfg {
  bool enabled = false;
  int limit = 100;
};

struct WifiCfg {
  String ssid = "STARLINK";
  String pass = "12345678910";
};

struct MqttCfg {
  String broker = "";
  int port = 8883;
  String user = "";
  String pass = "";
  String prefix = "kei/robot";
  bool enabled = false;
  bool tls = true;
};

extern RuntimeCfg runtimeCfg;
extern SpeedLimitCfg speedLimitCfg;
extern WifiCfg wifiCfg;
extern MqttCfg mqttCfg;
extern String deviceName;
extern bool powerSave;

void loadAllConfig();
void saveRuntime();
void saveSpeedLimit();
void savePowerSave();
void saveWifi(const String &ssid, const String &pass);
void saveMqtt(const MqttCfg &c);
void saveDeviceName(const String &name);
void factoryReset();
String getDeviceId();

#endif
