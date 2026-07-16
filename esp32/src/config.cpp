#include "config.h"
#include <WiFi.h>

RuntimeCfg runtimeCfg;
SpeedLimitCfg speedLimitCfg;
WifiCfg wifiCfg;
MqttCfg mqttCfg;
String deviceName;
bool powerSave = false;

void loadAllConfig() {
  {
    Preferences p; p.begin("runtime", true);
    runtimeCfg.maxSpeed = p.getInt("maxSpeed", 255);
    runtimeCfg.rampRate = p.getInt("rampRate", 255);
    runtimeCfg.motorTimeout = p.getInt("motorTimeout", 300);
    runtimeCfg.leftTrim = p.getInt("leftTrim", 0);
    runtimeCfg.rightTrim = p.getInt("rightTrim", 0);
    p.end();
  }
  {
    Preferences p; p.begin("pwr", true);
    powerSave = p.getBool("save", true);
    p.end();
  }
  {
    Preferences p; p.begin("sl", true);
    speedLimitCfg.enabled = p.getBool("enabled", false);
    speedLimitCfg.limit = p.getInt("limit", 100);
    p.end();
  }
  {
    Preferences p; p.begin("wifi", true);
    String s = p.getString("ssid", "");
    String pass = p.getString("pass", "");
    p.end();
    if (s.length() > 0) { wifiCfg.ssid = s; wifiCfg.pass = pass; }
  }
  {
    Preferences p; p.begin("mqtt", true);
    mqttCfg.broker = p.getString("broker", "");
    mqttCfg.port = p.getInt("port", 8883);
    mqttCfg.user = p.getString("user", "");
    mqttCfg.pass = p.getString("pass", "");
    mqttCfg.prefix = p.getString("prefix", "kei/robot");
    mqttCfg.enabled = p.getBool("enabled", false);
    mqttCfg.tls = p.getBool("tls", true);
    p.end();
  }
  {
    Preferences p; p.begin("dname", true);
    String n = p.getString("name", "");
    p.end();
    if (n.length() > 0) deviceName = n;
  }
}

void saveRuntime() {
  Preferences p; p.begin("runtime", false);
  p.putInt("maxSpeed", runtimeCfg.maxSpeed);
  p.putInt("rampRate", runtimeCfg.rampRate);
  p.putInt("motorTimeout", runtimeCfg.motorTimeout);
  p.putInt("leftTrim", runtimeCfg.leftTrim);
  p.putInt("rightTrim", runtimeCfg.rightTrim);
  p.end();
}

void saveSpeedLimit() {
  Preferences p; p.begin("sl", false);
  p.putBool("enabled", speedLimitCfg.enabled);
  p.putInt("limit", speedLimitCfg.limit);
  p.end();
}

void savePowerSave() {
  Preferences p; p.begin("pwr", false);
  p.putBool("save", powerSave);
  p.end();
}

void saveWifi(const String &ssid, const String &pass) {
  Preferences p; p.begin("wifi", false);
  p.putString("ssid", ssid);
  p.putString("pass", pass);
  p.end();
  wifiCfg.ssid = ssid;
  wifiCfg.pass = pass;
}

void saveMqtt(const MqttCfg &c) {
  Preferences p; p.begin("mqtt", false);
  p.putString("broker", c.broker);
  p.putInt("port", c.port);
  p.putString("user", c.user);
  p.putString("pass", c.pass);
  p.putString("prefix", c.prefix);
  p.putBool("enabled", c.enabled);
  p.putBool("tls", c.tls);
  p.end();
  mqttCfg = c;
}

void saveDeviceName(const String &name) {
  Preferences p; p.begin("dname", false);
  p.putString("name", name);
  p.end();
  deviceName = name;
}

void factoryReset() {
  Preferences p;
  p.begin("runtime", false); p.clear(); p.end();
  p.begin("pwr", false); p.clear(); p.end();
  p.begin("sl", false); p.clear(); p.end();
  p.begin("dname", false); p.clear(); p.end();
  p.begin("mqtt", false); p.clear(); p.end();
  p.begin("wifi", false); p.clear(); p.end();
}

String getDeviceId() {
  if (deviceName.length() > 0) return deviceName;
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  return mac;
}
