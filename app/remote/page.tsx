"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Simulasi from "../simulasi";
import VoiceGroq from "../voicegroq";
import type { SceneMessage, SceneDetection } from "../lib/sceneTypes";
import type { Detection } from "@mediapipe/tasks-vision";

interface Telemetry {
  batteryPct?: number;
  batteryV?: number;
  rssi?: number;
  heap?: number;
  uptime?: number;
  mode?: string;
  left?: number;
  right?: number;
  ip?: string;
  ssid?: string;
  mqtt?: boolean;
  deviceName?: string;
  speed?: number;
  emergency?: boolean;
  powerSave?: boolean;
  rampRate?: number;
  speedLimit?: number;
  speedLimitEnabled?: boolean;
  maxSpeed?: number;
  motorTimeout?: number;
  leftTrim?: number;
  rightTrim?: number;
}

export default function RemotePage() {
  const [mqttBroker, setMqttBroker] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttBroker") || "" : "");
  const [mqttPort, setMqttPort] = useState(() => typeof window !== "undefined" ? Number(localStorage.getItem("mqttPort")) || 8884 : 8884);
  const [mqttUser, setMqttUser] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttUser") || "" : "");
  const [mqttPass, setMqttPass] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttPass") || "" : "");
  const [mqttPrefix, setMqttPrefix] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttPrefix") || "kei/robot" : "kei/robot");
  const [mqttConnected, setMqttConnected] = useState(false);
  const [mqttStatus, setMqttStatus] = useState("");
  const [deviceId, setDeviceId] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttDeviceId") || "" : "");
  const [manualDeviceId, setManualDeviceId] = useState("");
  const [scene, setScene] = useState<SceneMessage | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>({});
  const [showVideo, setShowVideo] = useState(false);
  const [sceneAge, setSceneAge] = useState(0);

  // Refs for Simulasi
  const headingRef = useRef(0);
  const posRef = useRef({ x: 300, y: 300 });
  const detectionsRef = useRef<Detection[]>([]);
  const telemetryMapRef = useRef<{ label: string; x: number; y: number; score: number; lastSeen: number; area: number }[]>([]);
  const trackLabelRef = useRef<string | null>(null);
  const trackTargetRef = useRef<{ label: string; lastSeen: number } | null>(null);
  const trackingRef = useRef(false);

  // Motor state
  const [leftMotor, setLeftMotor] = useState(0);
  const [rightMotor, setRightMotor] = useState(0);

  // MQTT refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mqttClientRef = useRef<any>(null);
  const mqttGenRef = useRef(0);
  const mqttPrefixRef = useRef("kei/robot");
  const mqttDeviceIdRef = useRef("");
  // Refs for VoiceGroq
  const recognizedFaceRef = useRef<{ name: string } | null>(null);
  const trackInfoRef = useRef("");
  const aiBusyRef = useRef(false);
  const motorRef = useRef({ sendMotor: (l: number, r: number) => {}, trackTarget: null as { label: string; lastSeen: number } | null, setTrackTarget: (t: { label: string; lastSeen: number } | null) => {}, aiMotor: null as { l: number; r: number } | null });

  const updateFromScene = useCallback((msg: SceneMessage) => {
    setScene(msg);
    setSceneAge(Date.now() - msg.timestamp);
    headingRef.current = msg.heading;
    posRef.current = msg.position;
    trackingRef.current = msg.tracking.active;
    trackLabelRef.current = msg.tracking.target || null;
    trackTargetRef.current = msg.tracking.target ? { label: msg.tracking.target, lastSeen: Date.now() } : null;
    trackInfoRef.current = msg.tracking.target ? `🔒 ${msg.tracking.target}` : msg.mode;
    const dets = msg.detections.map((d: SceneDetection) => ({
      categories: [{ categoryName: d.label, score: d.score, index: 0, displayName: d.label }],
      boundingBox: { originX: d.x, originY: d.y, width: d.width, height: d.height },
      keypoints: [] as any[],
    })) as Detection[];
    detectionsRef.current = dets;
    if (msg.faces.length > 0) {
      recognizedFaceRef.current = msg.faces[0];
    } else {
      recognizedFaceRef.current = null;
    }
  }, []);

  // Scene age ticker
  useEffect(() => {
    if (!scene) return;
    const iv = setInterval(() => setSceneAge(Date.now() - scene.timestamp), 1000);
    return () => clearInterval(iv);
  }, [scene]);

  // Send motor command via MQTT
  const sendMotor = useCallback((l: number, r: number) => {
    setLeftMotor(l);
    setRightMotor(r);
    const mqtt = mqttClientRef.current;
    const deviceId = mqttDeviceIdRef.current;
    if (mqtt?.connected && deviceId) {
      const cmdTopic = `${mqttPrefixRef.current}/${deviceId}/cmd`;
      mqtt.publish(cmdTopic, JSON.stringify({ leftMotor: l, rightMotor: r }));
    }
  }, []);

  motorRef.current = {
    sendMotor: sendMotor,
    trackTarget: trackTargetRef.current,
    setTrackTarget: (t) => {
      trackTargetRef.current = t;
      trackLabelRef.current = t?.label || null;
      trackInfoRef.current = t ? `🔒 ${t.label}` : "";
    },
    aiMotor: null,
  };

  const mqttStatusRef = useRef("");

  // Connect MQTT
  const connectMQTT = useCallback(async () => {
    if (!mqttBroker) {
      setMqttStatus("isi broker dulu");
      return;
    }
    try {
      if (mqttClientRef.current) { mqttClientRef.current.end(true); mqttClientRef.current = null; }
      mqttStatusRef.current = "menghubungkan...";
      setMqttStatus("menghubungkan...");
      const gen = ++mqttGenRef.current;
      const clientId = "kei-remote-" + Math.random().toString(36).slice(2, 8);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts: any = {
        clientId,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 15000,
        protocolVersion: 4,
      };
      if (mqttUser) opts.username = mqttUser;
      if (mqttPass) opts.password = mqttPass;
      localStorage.setItem("mqttUser", mqttUser);
      localStorage.setItem("mqttPass", mqttPass);
      const mqttMod = await import("mqtt/dist/mqtt.esm");
      const url = `wss://${mqttBroker}:${mqttPort}/mqtt`;
      const client = mqttMod.default.connect(url, opts);
      client.on("connect", () => {
        if (mqttGenRef.current !== gen) { client.end(true); return; }
        mqttStatusRef.current = "terhubung";
        setMqttConnected(true);
        setMqttStatus("terhubung");
        mqttPrefixRef.current = mqttPrefix;
        const sceneTopic = `${mqttPrefix}/+/scene`;
        const teleTopic = `${mqttPrefix}/+/telemetry`;
        client.subscribe(sceneTopic);
        client.subscribe(teleTopic);
      });
      client.on("message", (topic: string, payload: Buffer) => {
        if (mqttGenRef.current !== gen) return;
        try {
          const data = JSON.parse(payload.toString());
          const parts = topic.split("/");
          const did = parts.length >= 3 ? parts[parts.length - 2] : "";
          if (did) {
            if (!mqttDeviceIdRef.current) {
              mqttDeviceIdRef.current = did;
              setDeviceId(did);
            }
          }
          if (topic.endsWith("/scene")) {
            updateFromScene(data as SceneMessage);
          } else if (topic.endsWith("/telemetry")) {
            const { config: _cfg, ...rest } = data;
            setTelemetry(rest);
          }
        } catch {}
      });
      client.on("close", () => {
        if (mqttGenRef.current !== gen) return;
        setMqttConnected(false);
        if (!mqttStatusRef.current.startsWith("gagal")) {
          setMqttStatus("putus");
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on("error", (err: any) => {
        if (mqttGenRef.current !== gen) return;
        mqttStatusRef.current = "gagal: " + (err?.message || "unknown");
        setMqttStatus("gagal: " + (err?.message || "unknown"));
      });
      mqttClientRef.current = client;
      localStorage.setItem("mqttBroker", mqttBroker);
      localStorage.setItem("mqttPort", String(mqttPort));
      localStorage.setItem("mqttPrefix", mqttPrefix);
    } catch (e: unknown) {
      mqttStatusRef.current = "gagal: " + ((e as Error)?.message || "unknown");
      setMqttConnected(false);
      setMqttStatus("gagal: " + ((e as Error)?.message || "unknown"));
    }
  }, [mqttBroker, mqttPort, mqttPrefix, mqttUser, mqttPass, updateFromScene]);

  const disconnectMQTT = useCallback(() => {
    ++mqttGenRef.current;
    mqttClientRef.current?.end(true);
    mqttClientRef.current = null;
    setMqttConnected(false);
    setMqttStatus("putus");
  }, []);

  const autoConnectDoneRef = useRef(false);
  useEffect(() => {
    if (autoConnectDoneRef.current) return;
    if (typeof window === "undefined") return;
    const savedBroker = localStorage.getItem("mqttBroker");
    const savedDeviceId = localStorage.getItem("mqttDeviceId");
    if (savedDeviceId && !mqttDeviceIdRef.current) {
      mqttDeviceIdRef.current = savedDeviceId;
      setDeviceId(savedDeviceId);
    }
    if (savedBroker) {
      autoConnectDoneRef.current = true;
      connectMQTT();
    }
  }, [connectMQTT]);

  // Send ESP command (emergency, config)
  const sendESP = useCallback((data: object) => {
    const mqtt = mqttClientRef.current;
    const deviceId = mqttDeviceIdRef.current;
    if (mqtt?.connected && deviceId) {
      const cmdTopic = `${mqttPrefixRef.current}/${deviceId}/cmd`;
      mqtt.publish(cmdTopic, JSON.stringify(data));
    }
  }, []);

  // Joystick
  const joystickRef = useRef<HTMLDivElement>(null);
  const joyActiveRef = useRef(false);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const maxRRef = useRef(60);

  const handleJoyMove = useCallback((clientX: number, clientY: number) => {
    const el = joystickRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 10;
    maxRRef.current = maxR;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    setJoyPos({ x: dx, y: dy });
    const nx = dx / maxR;
    const ny = -dy / maxR;
    let l = (ny + nx) * 255;
    let r = (ny - nx) * 255;
    l = Math.max(-255, Math.min(255, Math.round(l)));
    r = Math.max(-255, Math.min(255, Math.round(r)));
    setLeftMotor(l);
    setRightMotor(r);
    sendMotor(l, r);
  }, [sendMotor]);

  const handleJoyEnd = useCallback(() => {
    joyActiveRef.current = false;
    setLeftMotor(0);
    setRightMotor(0);
    setJoyPos({ x: 0, y: 0 });
    sendMotor(0, 0);
  }, [sendMotor]);

  const keysRef = useRef(new Set<string>());
  const rafRef = useRef(0);
  const lastMotorRef = useRef({ l: 0, r: 0 });

  useEffect(() => {
    const loop = () => {
      if (joyActiveRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const k = keysRef.current;
      let l = 0, r = 0;
      if (k.has("w") || k.has("arrowup")) { l = 255; r = 255; }
      if (k.has("s") || k.has("arrowdown")) { l = -255; r = -255; }
      if (k.has("a") || k.has("arrowleft")) { l = -255; r = 255; }
      if (k.has("d") || k.has("arrowright")) { l = 255; r = -255; }
      const last = lastMotorRef.current;
      if (l !== last.l || r !== last.r) {
        lastMotorRef.current = { l, r };
        sendMotor(l, r);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    const down = (e: KeyboardEvent) => {
      if (joyActiveRef.current) return;
      keysRef.current.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => {
      if (joyActiveRef.current) return;
      keysRef.current.delete(e.key.toLowerCase());
      if (keysRef.current.size === 0) { sendMotor(0, 0); }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [sendMotor]);

  useEffect(() => {
    if (joyActiveRef.current) return;
    const maxR = maxRRef.current;
    if (maxR <= 0) return;
    const ny = (leftMotor + rightMotor) / 510;
    const nx = (leftMotor - rightMotor) / 510;
    setJoyPos({ x: nx * maxR, y: -ny * maxR });
  }, [leftMotor]);

  // Frame relay video polling
  const [frameUrl, setFrameUrl] = useState("");
  const [frameStatus, setFrameStatus] = useState<"waiting" | "loading" | "ok" | "error">("waiting");
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!showVideo) return;
    setFrameStatus("waiting");
    const timer = setInterval(() => {
      setFrameUrl(`/api/frame?t=${Date.now()}`);
    }, 500);
    return () => clearInterval(timer);
  }, [showVideo]);

  return (
    <main className="flex flex-col items-center bg-black min-h-dvh px-3 pt-3 pb-3 gap-1.5 overflow-y-auto">
      {/* HEADER */}
      <div className="w-full max-w-sm flex items-center gap-1.5">
        <a href="/"
          className="size-7 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-black/70 active:scale-90 flex-shrink-0">
          <svg className="size-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </a>
        <h1 className="text-white text-sm font-bold tracking-tight">REMOTE</h1>
        <div className={`size-2 rounded-full ${mqttConnected ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" : "bg-zinc-500"}`} />
        <span className="text-[7px] font-mono text-zinc-500 truncate flex-1">
          {deviceId || (mqttConnected ? "menunggu..." : "putus")}
        </span>
        {scene && (
          <span className={`text-[7px] font-mono ${sceneAge < 2000 ? "text-green-500" : sceneAge < 5000 ? "text-yellow-500" : "text-red-500"}`}>
            {sceneAge < 1000 ? "<1s" : `${(sceneAge / 1000).toFixed(0)}s`}
          </span>
        )}
      </div>

      {/* MQTT CONFIG */}
      {!mqttConnected && (
        <div className="w-full max-w-sm flex flex-col gap-1.5 p-2 rounded-xl bg-zinc-900/80 ring-1 ring-white/10">
          <div className="flex gap-1.5">
            <input value={mqttBroker} onChange={e => setMqttBroker(e.target.value)}
              placeholder="broker.hivemq.cloud"
              className="flex-1 min-w-0 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
            <input value={mqttPort} onChange={e => setMqttPort(Number(e.target.value))}
              placeholder="8884" type="number"
              className="w-14 px-1.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono text-center focus:outline-none" />
          </div>
          <div className="flex gap-1.5">
            <input value={mqttUser} onChange={e => setMqttUser(e.target.value)}
              placeholder="user"
              className="flex-1 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
            <input value={mqttPass} onChange={e => setMqttPass(e.target.value)}
              placeholder="pass" type="password"
              className="flex-1 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
          </div>
          <div className="flex gap-1.5">
            <input value={mqttPrefix} onChange={e => setMqttPrefix(e.target.value)}
              placeholder="kei/robot"
              className="flex-1 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
            <button onClick={connectMQTT}
              className="px-3 py-1 rounded-full bg-emerald-600 text-white text-[9px] font-mono font-bold active:scale-90">
              HUBUNG
            </button>
          </div>
          {mqttStatus && (
            <span className={`text-[8px] font-mono ${mqttStatus.startsWith("gagal") || mqttStatus.startsWith("isi") ? "text-red-400" : mqttStatus === "terhubung" ? "text-emerald-400" : "text-zinc-500"}`}>
              {mqttStatus}
            </span>
          )}
        </div>
      )}

      {/* CONNECTED BAR */}
      {mqttConnected && (
        <div className="w-full max-w-sm flex flex-col gap-1">
          <div className="flex gap-1.5 items-center">
            <button onClick={disconnectMQTT}
              className="px-2 py-1 rounded-full bg-zinc-800 text-zinc-300 text-[9px] font-mono border border-zinc-700 active:scale-90 flex-shrink-0">
              PUTUS MQTT
            </button>
            <span className="text-[7px] font-mono text-emerald-500">{mqttStatus}</span>
            <span className="flex-1" />
            <span className="text-[7px] font-mono text-zinc-600">MQTT {telemetry.mqtt ? "ON" : "OFF"}</span>
          </div>
          {!mqttDeviceIdRef.current && (
            <div className="flex gap-1.5 items-center">
              <input id="mqtt-device-id" value={manualDeviceId} onChange={e => setManualDeviceId(e.target.value)}
                placeholder="isi device ID manual"
                className="flex-1 min-w-0 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
              <button onClick={() => { if (manualDeviceId) { mqttDeviceIdRef.current = manualDeviceId; setDeviceId(manualDeviceId); localStorage.setItem("mqttDeviceId", manualDeviceId); } }}
                className="px-2 py-1 rounded-full bg-emerald-600 text-white text-[9px] font-mono font-bold active:scale-90 flex-shrink-0">
                SET
              </button>
            </div>
          )}
        </div>
      )}

      {/* VIDEO + STATUS ROW */}
      <div className="w-full max-w-sm grid grid-cols-3 gap-1.5">
        <div className="col-span-2 relative aspect-video rounded-xl overflow-hidden bg-zinc-900 ring-1 ring-white/10 flex-shrink-0">
          {showVideo && frameUrl ? (
            <>
              {frameStatus !== "ok" && (
                <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1 transition-opacity duration-200 ${
                  frameStatus === "error" ? "text-red-500" : "text-zinc-600"
                }`}>
                  <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                  <span className="text-[9px] font-mono">{frameStatus === "error" ? "gagal" : "menunggu..."}</span>
                </div>
              )}
              <img key={frameUrl} ref={imgRef} src={frameUrl} alt="live"
                onLoad={() => setFrameStatus("ok")}
                onError={() => setFrameStatus("error")}
                className="absolute inset-0 h-full w-full object-contain"
                style={{ opacity: frameStatus === "ok" ? 1 : 0 }} />
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-600">
              <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <span className="text-[9px] font-mono">video off</span>
            </div>
          )}
          <button onClick={() => setShowVideo(p => !p)}
            className={`absolute top-1.5 right-1.5 z-10 px-2 py-0.5 rounded-full text-[7px] font-mono font-bold border active:scale-90 ${
              showVideo ? "bg-emerald-600 border-emerald-600 text-white" : "bg-zinc-800 border-zinc-700 text-zinc-400"
            }`}>
            V {showVideo ? "ON" : "OFF"}
          </button>
        </div>

        {/* STATUS PANEL */}
        <div className="flex flex-col gap-1.5">
          {/* MODE */}
          <div className="flex-1 rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-2 py-1 flex flex-col items-center justify-center">
            <span className="text-[6px] font-mono text-zinc-600">MODE</span>
            <span className={`text-[9px] font-mono font-bold ${scene?.mode === "explore" ? "text-green-400" : scene?.mode === "avoid" ? "text-red-400" : scene?.mode === "follow" || scene?.tracking.active ? "text-blue-400" : "text-zinc-400"}`}>
              {scene?.tracking.active ? "FOLLOW" : (scene?.mode || "-").toUpperCase()}
            </span>
            {scene?.tracking.target && (
              <span className="text-[6px] font-mono text-blue-400 truncate max-w-full">{scene.tracking.target}</span>
            )}
          </div>
          {/* BATTERY */}
          <div className="flex-1 rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-2 py-1 flex flex-col items-center justify-center">
            <span className="text-[6px] font-mono text-zinc-600">BATERAI</span>
            <span className={`text-[11px] font-mono font-bold ${telemetry.batteryPct != null ? (telemetry.batteryPct > 60 ? "text-green-400" : telemetry.batteryPct > 20 ? "text-yellow-400" : "text-red-400") : "text-zinc-600"}`}>
              {telemetry.batteryPct != null ? `${telemetry.batteryPct}%` : "?"}
            </span>
            {telemetry.batteryV != null && (
              <span className="text-[6px] font-mono text-zinc-600">{telemetry.batteryV}V</span>
            )}
          </div>
          {/* RSSI */}
          <div className="flex-1 rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-2 py-1 flex flex-col items-center justify-center">
            <span className="text-[6px] font-mono text-zinc-600">SINYAL</span>
            <span className={`text-[9px] font-mono font-bold ${telemetry.rssi != null ? (telemetry.rssi > -70 ? "text-green-400" : telemetry.rssi > -85 ? "text-yellow-400" : "text-red-400") : "text-zinc-600"}`}>
              {telemetry.rssi ?? "?"} <span className="text-[7px]">dBm</span>
            </span>
          </div>
        </div>
      </div>

      {/* MAP + JOYSTICK GRID */}
      <div className="w-full max-w-sm grid grid-cols-2 gap-1.5">
        <div className="aspect-square rounded-xl bg-zinc-900 ring-1 ring-white/10 relative overflow-hidden">
          <Simulasi
            headingRef={headingRef}
            posRef={posRef}
            telemetryMapRef={telemetryMapRef}
            trackLabelRef={trackLabelRef}
            trackTargetRef={trackTargetRef}
            detectionsRef={detectionsRef}
            trackingRef={trackingRef}
            leftMotor={leftMotor}
            rightMotor={rightMotor}
          />
          {scene && (
            <div className="absolute bottom-1.5 left-1.5 z-10 text-[6px] font-mono text-zinc-600">
              {scene.mode} | {scene.detections.length} obj | {(scene.heading * 180 / Math.PI).toFixed(0)}°
            </div>
          )}
        </div>

        <div className="aspect-square rounded-2xl bg-zinc-900 ring-1 ring-white/10 touch-none select-none relative"
          ref={joystickRef}
          onPointerDown={(e) => { e.preventDefault(); keysRef.current.clear(); joyActiveRef.current = true; handleJoyMove(e.clientX, e.clientY); }}
          onPointerMove={(e) => { if (joyActiveRef.current) handleJoyMove(e.clientX, e.clientY); }}
          onPointerUp={handleJoyEnd}
          onPointerCancel={handleJoyEnd}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-2 rounded-full bg-zinc-700" />
          </div>
          <div className="absolute size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 backdrop-blur-md border border-white/20"
            style={{ left: `calc(50% + ${joyPos.x}px)`, top: `calc(50% + ${joyPos.y}px)` }} />
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 text-[7px] font-mono">
            <span className="text-blue-400">L:{leftMotor}</span>
            <span className="text-orange-400">R:{rightMotor}</span>
          </div>
        </div>
      </div>

      {/* FULL TELEMETRY */}
      <div className="w-full max-w-sm rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-3 py-1.5">
        <div className="text-[7px] font-semibold text-zinc-500 tracking-wider mb-1">TELEMETRI</div>
        <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 text-[8px] font-mono">
          <span className="text-zinc-500">L <span className="text-blue-400">{telemetry.left ?? "-"}</span></span>
          <span className="text-zinc-500">R <span className="text-orange-400">{telemetry.right ?? "-"}</span></span>
          <span className="text-zinc-500">mode <span className={telemetry.mode === "emergency" ? "text-red-400" : "text-green-400"}>{telemetry.mode ?? "-"}</span></span>
          <span className="text-zinc-500">rssi <span className="text-yellow-400">{telemetry.rssi ?? "-"}</span></span>
          <span className="text-zinc-500">heap <span className="text-fuchsia-400">{telemetry.heap ? `${(telemetry.heap / 1024).toFixed(0)}KB` : "-"}</span></span>
          <span className="text-zinc-500">uptime <span className="text-white">{telemetry.uptime ? `${Math.floor(telemetry.uptime / 60)}m${telemetry.uptime % 60}s` : "-"}</span></span>
          <span className="text-zinc-500">ip <span className="text-cyan-400">{telemetry.ip ?? "-"}</span></span>
          <span className="text-zinc-500">mqtt <span className={telemetry.mqtt ? "text-green-400" : "text-red-400"}>{telemetry.mqtt ? "ON" : "OFF"}</span></span>
          {telemetry.ssid && (
            <span className="text-zinc-500 col-span-2">ssid <span className="text-cyan-400">{telemetry.ssid}</span></span>
          )}
          {telemetry.deviceName && (
            <span className="text-zinc-500 col-span-2">nama <span className="text-fuchsia-400">{telemetry.deviceName}</span></span>
          )}
        </div>
      </div>

      {/* DETECTION LIST */}
      {scene && scene.detections.length > 0 && (
        <div className="w-full max-w-sm rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-3 py-1.5">
          <div className="text-[7px] font-semibold text-zinc-500 tracking-wider mb-1">
            DETEKSI ({scene.detections.length})
            {scene.pathClear ? <span className="text-green-500 ml-1">jalan aman</span> : <span className="text-red-500 ml-1">terhalang</span>}
          </div>
          <div className="space-y-0.5 max-h-28 overflow-y-auto">
            {scene.detections.map((d, i) => (
              <div key={i} className="flex items-center gap-1 text-[7px] font-mono">
                <span className={`size-1.5 rounded-full ${d.label === scene.tracking.target ? "bg-red-400" : "bg-green-500"}`} />
                <span className={d.label === scene.tracking.target ? "text-red-400 font-bold" : "text-green-400"}>
                  {d.label}
                </span>
                <span className="text-zinc-600">{(d.score * 100).toFixed(0)}%</span>
                <span className="text-zinc-700">[{d.x.toFixed(0)},{d.y.toFixed(0)} {d.width.toFixed(0)}x{d.height.toFixed(0)}]</span>
              </div>
            ))}
          </div>
          {scene.faces.length > 0 && (
            <div className="mt-1">
              <span className="px-1.5 py-0.5 rounded bg-fuchsia-900/60 text-[8px] font-mono text-fuchsia-300 border border-fuchsia-700/60">
                wajah: {scene.faces[0].name}
              </span>
            </div>
          )}
        </div>
      )}

      {/* FREE SECTORS */}
      {scene && scene.freeSectors.length > 0 && (
        <div className="w-full max-w-sm rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-3 py-1.5">
          <div className="text-[7px] font-semibold text-zinc-500 tracking-wider mb-1">SEKTOR</div>
          <div className="flex gap-1">
            {scene.freeSectors.map((free, i) => (
              <div key={i} className={`flex-1 h-3 rounded ${free ? "bg-green-700/60" : "bg-red-800/60"} flex items-center justify-center`}
                title={`Sektor ${i}: ${free ? "aman" : "terhalang"}`}>
                <span className="text-[5px] font-mono text-zinc-400">{i}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TEST PANEL */}
      {mqttConnected && (
        <div className="w-full max-w-sm rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-3 py-1.5">
          <div className="text-[7px] font-semibold text-zinc-500 tracking-wider mb-1.5">TEST</div>
          <div className="flex flex-wrap gap-1 mb-1">
            <button onClick={() => sendESP({ behavior: "wall" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border border-zinc-700 text-zinc-400 hover:bg-zinc-800 leading-none flex items-center active:scale-90">WALL</button>
            <button onClick={() => sendESP({ behavior: "edge" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border border-zinc-700 text-zinc-400 hover:bg-zinc-800 leading-none flex items-center active:scale-90">EDGE</button>
            <button onClick={() => sendESP({ behavior: "spin" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border border-amber-700 text-amber-400 hover:bg-zinc-800 leading-none flex items-center active:scale-90">SPIN</button>
            <button onClick={() => sendESP({ behavior: "drive" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border border-amber-700 text-amber-400 hover:bg-zinc-800 leading-none flex items-center active:scale-90">MAJU</button>
            <button onClick={() => sendESP({ behavior: "stop" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border border-red-700 text-red-400 hover:bg-zinc-800 leading-none flex items-center active:scale-90">STOP</button>
            <button onClick={() => sendESP({ behavior: "scan" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border leading-none flex items-center active:scale-90"
              style={{ borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)" }}>SCAN</button>
            <button onClick={() => sendESP({ behavior: "explore" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border leading-none flex items-center active:scale-90"
              style={{ borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)" }}>EXPLORE</button>
            <button onClick={() => sendESP({ behavior: "return" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border leading-none flex items-center active:scale-90"
              style={{ borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)" }}>PULANG</button>
            <button onClick={() => sendESP({ behavior: "follow" })}
              className="px-1.5 h-4 rounded text-[7px] font-bold border leading-none flex items-center active:scale-90"
              style={{ borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)" }}>FOLLOW</button>
          </div>
          <div className="text-[7px] font-mono text-zinc-600 truncate">{scene?.mode || "-"}</div>
        </div>
      )}

      {/* MOTOR CONFIG */}
      {mqttConnected && (
        <div className="w-full max-w-sm rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-3 py-1.5">
          <div className="text-[7px] font-semibold text-zinc-500 tracking-wider mb-1.5">MOTOR</div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <button onClick={() => sendESP({ powerSave: !(telemetry.powerSave ?? false) })}
              className="px-2 py-1 rounded-full text-[8px] font-mono font-bold active:scale-90"
              style={{
                backgroundColor: telemetry.powerSave ? "#3b82f6" : "transparent",
                borderColor: telemetry.powerSave ? "#3b82f6" : "rgba(255,255,255,0.15)",
                color: telemetry.powerSave ? "#000" : "rgba(255,255,255,0.4)",
              }}>
              {telemetry.powerSave ? "BATERAI" : "KENCANG"}
            </button>
            {[3, 8, 15].map(r => (
              <button key={r} onClick={() => sendESP({ rampRate: r })}
                className="px-2 py-1 rounded-full text-[8px] font-mono font-bold active:scale-90"
                style={{
                  backgroundColor: (telemetry.rampRate ?? 8) === r ? "#3b82f6" : "transparent",
                  borderColor: (telemetry.rampRate ?? 8) === r ? "#3b82f6" : "rgba(255,255,255,0.15)",
                  color: (telemetry.rampRate ?? 8) === r ? "#000" : "rgba(255,255,255,0.4)",
                }}>
                RAMP {r}
              </button>
            ))}
            <button onClick={() => sendESP({ speedLimitEnabled: !(telemetry.speedLimitEnabled ?? false) })}
              className="px-2 py-1 rounded-full text-[8px] font-mono font-bold active:scale-90"
              style={{
                minWidth: '64px',
                backgroundColor: telemetry.speedLimitEnabled ? "#f59e0b" : "transparent",
                borderColor: telemetry.speedLimitEnabled ? "#f59e0b" : "rgba(255,255,255,0.15)",
                color: telemetry.speedLimitEnabled ? "#000" : "rgba(255,255,255,0.4)",
              }}>
              LIMIT {telemetry.speedLimitEnabled ? (telemetry.speedLimit ?? 150) : "OFF"}
            </button>
            <input type="range" min="50" max="255" step="5"
              value={telemetry.speedLimit ?? 150}
              onChange={(e) => sendESP({ speedLimit: parseInt(e.target.value) })}
              className="flex-1 h-1 accent-amber-500 min-w-16"
              style={{ opacity: telemetry.speedLimitEnabled ? 1 : 0.25 }} />
          </div>
          <div className="flex flex-wrap gap-1.5 items-center mt-1">
            <span className="text-zinc-500 text-[7px] font-mono">max</span>
            <input type="range" min="128" max="255" step="1"
              value={telemetry.maxSpeed ?? 255}
              onChange={(e) => sendESP({ maxSpeed: parseInt(e.target.value) })}
              className="flex-1 h-1 accent-blue-500 min-w-16" />
            <span className="text-zinc-400 text-[7px] font-mono w-5 text-right">{telemetry.maxSpeed ?? 255}</span>
            <span className="text-zinc-500 text-[7px] font-mono ml-1">tm</span>
            <input type="number" min="1000" max="30000" step="1000"
              value={telemetry.motorTimeout ?? 5000}
              onChange={(e) => sendESP({ motorTimeout: parseInt(e.target.value) || 5000 })}
              className="w-12 px-1 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[7px] font-mono text-center" />
            <span className="text-zinc-500 text-[7px] font-mono ml-1">L◀</span>
            <input type="range" min="-100" max="100" step="1"
              value={telemetry.leftTrim ?? 0}
              onChange={(e) => sendESP({ leftTrim: parseInt(e.target.value) })}
              className="w-10 h-1 accent-cyan-500" />
            <span className="text-zinc-400 text-[7px] font-mono w-4 text-center">{telemetry.leftTrim ?? 0}</span>
            <span className="text-zinc-500 text-[7px] font-mono">R◀</span>
            <input type="range" min="-100" max="100" step="1"
              value={telemetry.rightTrim ?? 0}
              onChange={(e) => sendESP({ rightTrim: parseInt(e.target.value) })}
              className="w-10 h-1 accent-cyan-500" />
            <span className="text-zinc-400 text-[7px] font-mono w-4 text-center">{telemetry.rightTrim ?? 0}</span>
          </div>
        </div>
      )}

      {/* CONTROL BUTTONS */}
      {mqttConnected && (
        <div className="w-full max-w-sm flex gap-1.5 flex-wrap">
          <button onClick={() => sendESP({ emergency: !(telemetry.emergency ?? false) })}
            className="px-3 py-1.5 rounded-full text-[9px] font-mono font-bold border active:scale-90"
            style={{
              backgroundColor: telemetry.emergency ? "#ef4444" : "transparent",
              borderColor: telemetry.emergency ? "#ef4444" : "rgba(255,255,255,0.15)",
              color: telemetry.emergency ? "#fff" : "rgba(255,255,255,0.4)",
            }}>
            {telemetry.emergency ? "DARURAT" : "EMERGENCY"}
          </button>
          <button onClick={() => sendESP({ reboot: true })}
            className="px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 text-[9px] font-mono border border-zinc-700 active:scale-90">
            RESTART ESP
          </button>
          {scene && (
            <span className="text-[7px] font-mono text-zinc-700 flex items-center">
              {scene.mode} | ({scene.position.x.toFixed(0)},{scene.position.y.toFixed(0)}) | {(scene.heading * 180 / Math.PI).toFixed(0)}°
            </span>
          )}
        </div>
      )}

      {/* AI CHAT */}
      <VoiceGroq
        recognizedFaceRef={recognizedFaceRef}
        detectionsRef={detectionsRef}
        trackInfoRef={trackInfoRef}
        headingRef={headingRef}
        leftMotor={leftMotor}
        rightMotor={rightMotor}
        aiBusyRef={aiBusyRef}
        motorRef={motorRef}
        trackingRef={trackingRef}
        setTracking={() => {}}
      />
    </main>
  );
}
