"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ObjectDetector, FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision";
import Simulasi from "./simulasi";
import AIGroq from "./aigroq";
import { loadDB, saveDB, registerFace, recognize, type FaceRecord } from "./facerecog";
import mqtt from "mqtt/dist/mqtt.esm";

interface Telemetry {
  speed?: number;
  mode?: string;
  rssi?: number;
  heap?: number;
  uptime?: number;
  left?: number;
  right?: number;
  powerSave?: boolean;
  emergency?: boolean;
  ip?: string;
  ssid?: string;
  pong?: boolean;
  wifiConfig?: boolean;
  rampRate?: number;
  speedLimitEnabled?: boolean;
  speedLimit?: number;
  maxSpeed?: number;
  motorTimeout?: number;
}

export default function VisionPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamImgRef = useRef<HTMLImageElement>(null);
  const streamDetCanvasRef = useRef<HTMLCanvasElement>(null);

  const [active, setActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [source, setSource] = useState<"local" | "stream">("local");
  const [streamUrl, setStreamUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const proxiedStreamUrl = streamUrl ? `/api/proxy?url=${encodeURIComponent(streamUrl)}` : "";

  const [espIp, setEspIp] = useState(() => typeof window !== "undefined" ? localStorage.getItem("espIp") || "" : "");
  const espIpRef = useRef(espIp);
  useEffect(() => { espIpRef.current = espIp; }, [espIp]);
  const [wsConnected, setWsConnected] = useState(false);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [showEspInput, setShowEspInput] = useState(false);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPass, setWifiPass] = useState("");
  const [showWifiConfig, setShowWifiConfig] = useState(false);
  const [mqttBroker, setMqttBroker] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttBroker") || "" : "");
  const [mqttPort, setMqttPort] = useState(() => typeof window !== "undefined" ? Number(localStorage.getItem("mqttPort")) || 8884 : 8884);
  const [mqttUser, setMqttUser] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttUser") || "" : "");
  const [mqttPass, setMqttPass] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttPass") || "" : "");
  const [mqttPrefix, setMqttPrefix] = useState(() => typeof window !== "undefined" ? localStorage.getItem("mqttPrefix") || "kei/robot" : "kei/robot");
  const [showMqttInput, setShowMqttInput] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [leftMotor, setLeftMotor] = useState(0);
  const [rightMotor, setRightMotor] = useState(0);
  const [telemetry, setTelemetry] = useState<Telemetry>({});

  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [detectionCount, setDetectionCount] = useState(0);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const detectionsRef = useRef<Detection[]>([]);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const faceTickRef = useRef(0);
  const faceDBRef = useRef<FaceRecord[]>([]);
  const faceLandmarksRef = useRef<number[]>([]);
  const recognizedFaceRef = useRef<FaceRecord | null>(null);
  const [registering, setRegistering] = useState(false);
  const [regName, setRegName] = useState("");

  interface SmoothBox {
    key: string;
    x: number; y: number; w: number; h: number;
    score: number;
    label: string;
  }
  const smoothRef = useRef<SmoothBox[]>([]);

  const [straightAssist, setStraightAssist] = useState(false);
  const straightAssistRef = useRef(false);

  const [tracking, setTracking] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(true);
  const trackingRef = useRef(false);
  const [trackInfo, setTrackInfo] = useState("");
  const trackInfoRef = useRef("");
  useEffect(() => { trackInfoRef.current = trackInfo; }, [trackInfo]);

  useEffect(() => { if (espIp) localStorage.setItem("espIp", espIp); }, [espIp]);
  const trackTargetRef = useRef<{ label: string; lastSeen: number } | null>(null);
  const trackLabelRef = useRef<string | null>(null);
  const trackLostRef = useRef(0);
  const persistenceRef = useRef<Map<string, number[]>>(new Map());
  const HYST_ACQUIRE = 0.30;
  const HYST_RELEASE = 0.15;
  const PERSIST_FRAMES = 5;
  const PERSIST_MIN = 2;
  const searchPhaseRef = useRef(0);
  const searchTimerRef = useRef(0);
  const [pickerTargets, setPickerTargets] = useState<string[]>([]);
  const scanStateRef = useRef<'idle'|'scanning'|'waiting'|'moving'>('idle');
  const scanFrameRef = useRef(0);
  const scanMapRef = useRef<Array<{label: string; area: number}[]>>([]);
  const scanTargetSeeRef = useRef(false);
  const scanBestSecRef = useRef(0);
  const headingRef = useRef(0);
  const posRef = useRef({ x: 300, y: 300 });
  interface TeleEntry { label: string; x: number; y: number; score: number; lastSeen: number; area: number; }
  const telemetryMapRef = useRef<TeleEntry[]>([]);
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brightnessRef = useRef(255);
  const darkFramesRef = useRef(0);
  const darkAvoidRef = useRef(false);
  const darkPhaseRef = useRef(0);
  const darkTimerRef = useRef(0);

  const prevFrameRef = useRef<number[]>([]);
  const stuckFramesRef = useRef(0);
  const stuckCooldownRef = useRef(0);
  const scanLevelRef = useRef(0);
  const SPIRAL_MOVES = [0, 50, 80, 120, 180];
  const SPIRAL_MAX = 4;

  const [debug, setDebug] = useState(false);
  const debugRef = useRef(false);
  const detectTimeRef = useRef(0);
  const aiBusyRef = useRef(false);

  const sendMotor = useCallback((l: number, r: number) => {
    const h = headingRef.current;
    const p = posRef.current;
    const diff = Math.abs(l - r);
    const sum = Math.abs(l + r);
    if (diff > 30 && sum < 80) {
      headingRef.current += (r - l) / 510 * 0.06;
    } else if (sum > 30 && diff < 80) {
      const avg = (l + r) / 510;
      p.x += Math.sin(h) * avg * 2;
      p.y -= Math.cos(h) * avg * 2;
    } else if (diff > 30 && sum > 30) {
      headingRef.current += (r - l) / 510 * 0.03;
      const avg = (l + r) / 510;
      p.x += Math.sin(h) * avg * 1.5;
      p.y -= Math.cos(h) * avg * 1.5;
    }
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ leftMotor: l, rightMotor: r }));
      return;
    }
    const mqtt = mqttClientRef.current;
    if (mqtt?.connected) {
      const deviceId = mqttDeviceIdRef.current;
      if (deviceId) {
        mqtt.publish(`${mqttPrefixRef.current}/${deviceId}/cmd`, JSON.stringify({ leftMotor: l, rightMotor: r }));
      }
      return;
    }
    const ip = espIpRef.current;
    if (ip) {
      fetch(`http://${ip}/cmd`, { method: 'POST', body: JSON.stringify({ leftMotor: l, rightMotor: r }) }).catch(() => {});
    }
  }, []);

  // Keyboard
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
        setLeftMotor(l); setRightMotor(r);
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
      if (keysRef.current.size === 0) { setLeftMotor(0); setRightMotor(0); sendMotor(0, 0); }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [sendMotor, setLeftMotor, setRightMotor]);

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

    if (straightAssistRef.current && l * r > 0 && l !== 0) {
      const results = detectionsRef.current;
      const video = videoRef.current;
      const vw = video?.videoWidth || 640;
      let bestCx = 0;
      let bestDist = Infinity;
      for (const d of results) {
        const box = d.boundingBox!;
        const cx = (box.originX + box.width / 2) / vw - 0.5;
        const ad = Math.abs(cx);
        if (ad < bestDist) { bestDist = ad; bestCx = cx; }
      }
      if (bestDist < 0.4) {
        const corr = Math.round(bestCx * 0.3 * Math.abs(l));
        l -= corr;
        r += corr;
      }
    }

    setLeftMotor(l); setRightMotor(r);
    sendMotor(l, r);
  }, [sendMotor, setLeftMotor, setRightMotor]);

  const handleJoyEnd = useCallback(() => {
    joyActiveRef.current = false;
    setLeftMotor(0); setRightMotor(0);
    setJoyPos({ x: 0, y: 0 });
    sendMotor(0, 0);
  }, [sendMotor, setLeftMotor, setRightMotor]);

  // Sync joystick visual from motor values
  useEffect(() => {
    if (joyActiveRef.current) return;
    const maxR = maxRRef.current;
    if (maxR <= 0) return;
    const ny = (leftMotor + rightMotor) / 510;
    const nx = (leftMotor - rightMotor) / 510;
    setJoyPos({ x: nx * maxR, y: -ny * maxR });
  }, [leftMotor, rightMotor]);

  // ESP
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const espGenRef = useRef(0);
  const connectESP = useCallback(async () => {
    if (!espIp) return;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
    wsRef.current?.close();
    wsRef.current = null;
    let targetIp = espIp;
    if (/[a-zA-Z]/.test(espIp)) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 2000);
        const r = await fetch(`http://${espIp}/`, { signal: c.signal });
        clearTimeout(t);
        if (r.ok) { const d = await r.json(); if (d.ip) { targetIp = d.ip; setEspIp(d.ip); } }
      } catch {}
    }
    const gen = ++espGenRef.current;
    const ws = new WebSocket(`ws://${targetIp}:81`);
    ws.onopen = () => {
      if (espGenRef.current !== gen) { ws.close(); return; }
      setWsConnected(true);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: true }));
      }, 10000);
    };
    ws.onmessage = (e) => {
      if (espGenRef.current !== gen) return;
      try { const d = JSON.parse(e.data); const { config: _cfg, ...rest } = d; setTelemetry(p => ({ ...p, ...rest })); } catch {}
    };
    ws.onclose = () => {
      if (espGenRef.current !== gen) return;
      setWsConnected(false); setTelemetry({}); wsRef.current = null;
      if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
      reconnectTimerRef.current = setTimeout(() => connectESP(), 3000);
    };
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [espIp]);

  const disconnectESP = useCallback(() => {
    ++espGenRef.current;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
    wsRef.current?.close();
    wsRef.current = null;
    setWsConnected(false);
    setTelemetry({});
  }, []);

  // MQTT
  const mqttClientRef = useRef<any>(null);
const mqttTeleTopicRef = useRef("");
const mqttPrefixRef = useRef("kei/robot");
const mqttDeviceIdRef = useRef("");
  const mqttGenRef = useRef(0);
  const [mqttStatus, setMqttStatus] = useState("");

  const connectMQTT = useCallback(() => {
    if (!mqttBroker) return;
    try {
      if (mqttClientRef.current) { mqttClientRef.current.end(true); mqttClientRef.current = null; }
      setMqttStatus("menghubungkan...");
      const gen = ++mqttGenRef.current;
      const clientId = "kei-web-" + Math.random().toString(36).slice(2, 8);
      const opts: any = {
        clientId,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 15000,
        protocolVersion: 4,
      };
      if (mqttUser) { opts.username = mqttUser; opts.password = mqttPass; }
      localStorage.setItem("mqttUser", mqttUser);
      localStorage.setItem("mqttPass", mqttPass);
      const url = `wss://${mqttBroker}:8884/mqtt`;
      console.log("[MQTT] connecting to", url);
      const client = mqtt.connect(url, opts);
      client.on("connect", () => {
        if (mqttGenRef.current !== gen) { client.end(true); return; }
        console.log("[MQTT] connected");
        setMqttConnected(true);
        setMqttStatus("terhubung");
        mqttPrefixRef.current = mqttPrefix;
        const teleTopic = `${mqttPrefix}/+/telemetry`;
        mqttTeleTopicRef.current = mqttPrefix;
        client.subscribe(teleTopic);
      });
      client.on("message", (topic: string, payload: Buffer) => {
        if (mqttGenRef.current !== gen) return;
        try {
          const data = JSON.parse(payload.toString());
          const parts = topic.split("/");
          if (parts.length >= 3) {
            mqttDeviceIdRef.current = parts[2];
          }
          if (data.ip && data.ip !== espIpRef.current) {
            setEspIp(data.ip);
          }
          const { config: _cfg, ...rest } = data;
          setTelemetry(p => ({ ...p, ...rest }));
        } catch {}
      });
      client.on("close", () => {
        if (mqttGenRef.current !== gen) return;
        console.log("[MQTT] disconnected");
        setMqttConnected(false);
        setMqttStatus("putus");
      });
      client.on("error", (err: any) => {
        if (mqttGenRef.current !== gen) return;
        console.error("[MQTT] error:", err?.message || err);
        setMqttStatus("gagal: " + (err?.message || "unknown"));
        client.end(true);
      });
      mqttClientRef.current = client;
      localStorage.setItem("mqttBroker", mqttBroker);
      localStorage.setItem("mqttPort", String(mqttPort));
      localStorage.setItem("mqttPrefix", mqttPrefix);
    } catch (e: any) {
      console.error("[MQTT] exception:", e);
      setMqttConnected(false);
      setMqttStatus("gagal: " + (e?.message || "unknown"));
    }
  }, [mqttBroker, mqttUser, mqttPass, mqttPrefix]);

  const disconnectMQTT = useCallback(() => {
    ++mqttGenRef.current;
    mqttClientRef.current?.end(true);
    mqttClientRef.current = null;
    setMqttConnected(false);
    setMqttStatus("putus");
  }, []);

  const sendESP = useCallback((data: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return;
    }
    const mqtt = mqttClientRef.current;
    if (mqtt?.connected) {
      const deviceId = mqttDeviceIdRef.current;
      if (deviceId) {
        const cmdTopic = `${mqttPrefixRef.current}/${deviceId}/cmd`;
        mqtt.publish(cmdTopic, JSON.stringify(data));
      }
      return;
    }
    const ip = espIpRef.current;
    if (ip) {
      fetch(`http://${ip}/cmd`, { method: 'POST', body: JSON.stringify(data) }).catch(() => {});
    }
  }, []);

  const sendPing = useCallback(() => sendESP({ ping: true }), [sendESP]);
  const sendEmergency = useCallback(() => sendESP({ emergency: true }), [sendESP]);
  const sendConfig = useCallback((cfg: object) => sendESP(cfg), [sendESP]);

  const discoverESP = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanStatus("mencari...");
    const subnets = ["192.168.42", "192.168.43", "192.168.44", "192.168.137", "192.168.1", "192.168.0", "10.0.2", "10.223", "172.20.10"];
    const ips: string[] = [];
    for (const s of subnets) {
      ips.push(`${s}.129`, `${s}.1`, `${s}.100`, `${s}.101`, `${s}.254`);
    }
    for (const s of subnets) {
      for (let i = 1; i <= 254; i++) {
        const ip = `${s}.${i}`;
        if (!ips.includes(ip)) ips.push(ip);
      }
    }
    let found = "";
    // coba kei.local dulu via HTTP
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1000);
      const r = await fetch("http://kei.local/", { signal: c.signal });
      clearTimeout(t);
      if (r.ok) { const d = await r.json(); if (d.ip) found = d.ip; }
    } catch {}
    if (!found) for (const ip of ips) {
      if (found) break;
      setScanStatus(ip);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 300);
        const res = await fetch(`http://${ip}/`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          const data = await res.json();
          if (data.name && data.ip) { found = ip; break; }
        }
      } catch {}
    }
    if (!found) {
      for (const ip of ips) {
        if (found) break;
        setScanStatus(ip);
        try {
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://${ip}:81`);
            const t = setTimeout(() => { try { ws.close(); } catch {} reject(); }, 200);
            ws.onopen = () => {
              clearTimeout(t);
              ws.send(JSON.stringify({ ping: true }));
              const t2 = setTimeout(() => { try { ws.close(); } catch {} reject(); }, 300);
              ws.onmessage = (e) => {
                try {
                  if (JSON.parse(e.data).pong) { clearTimeout(t2); ws.close(); found = ip; resolve(); }
                } catch {}
              };
            };
            ws.onerror = () => { clearTimeout(t); reject(); };
          });
        } catch {}
      }
    }
    setScanning(false);
    setScanStatus(found ? `ditemukan: ${found}` : "tidak ditemukan. cek IP di serial monitor ArduinoDroid");
    if (found) { setEspIp(found); setTimeout(() => connectESP(), 50); }
  }, [scanning, connectESP]);

  // Camera
  useEffect(() => {
    if (!active || source !== "local") return;
    let cancelled = false;
    (async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch { setActive(false); }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [active, facingMode, source]);

  // MediaPipe models
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setModelLoading(true);
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks("/wasm");
        if (cancelled) return;
        const [det, faceDet] = await Promise.all([
          ObjectDetector.createFromOptions(vision, {
            baseOptions: { modelAssetPath: "/efficientdet_lite0.tflite" },
            scoreThreshold: 0.3,
            maxResults: 5,
            runningMode: "IMAGE",
          }),
          FaceDetector.createFromOptions(vision, {
            baseOptions: { modelAssetPath: "/blaze_face_short_range.tflite" },
            runningMode: "IMAGE",
          }),
        ]);
        if (cancelled) { det.close(); faceDet.close(); return; }
        detectorRef.current = det;
        faceDetectorRef.current = faceDet;
        setModelReady(true);
        setModelLoading(false);
      } catch (e) {
        console.error("[MODEL LOAD]", e);
        setModelReady(false);
        setModelLoading(false);
      }
    })();
    return () => { cancelled = true; detectorRef.current?.close(); detectorRef.current = null; faceDetectorRef.current?.close(); faceDetectorRef.current = null; setModelReady(false); setModelLoading(false); };
  }, [active]);

  // Detection + render loop
  const detectingRef = useRef(false);
  useEffect(() => {
    if (!active || !modelReady) { detectingRef.current = false; return; }

    const video = videoRef.current;
    if (!video) return;

    detectingRef.current = true;

    const detectAndDraw = () => {
      if (!detectingRef.current) return;
      const det = detectorRef.current;
      if (!det) return;

      // Determine detection source
      let detectSource: HTMLVideoElement | HTMLCanvasElement | null = null;
      let sourceW = 640, sourceH = 480;
      if (source === "local") {
        if (!video || video.readyState < 2 || !video.videoWidth) return;
        detectSource = video;
        sourceW = video.videoWidth;
        sourceH = video.videoHeight;
      } else if (streamUrl) {
        const img = streamImgRef.current;
        const detCanvas = streamDetCanvasRef.current;
        if (!img || !detCanvas || !img.complete || !img.naturalWidth) return;
        sourceW = img.naturalWidth;
        sourceH = img.naturalHeight;
        detCanvas.width = sourceW;
        detCanvas.height = sourceH;
        try { detCanvas.getContext('2d')!.drawImage(img, 0, 0); } catch { return; }
        detectSource = detCanvas;
      } else return;

      // Skip heavy inference while user is manually driving via joystick or AI is busy
      if (!joyActiveRef.current && !aiBusyRef.current) {
        const t0 = performance.now();
        try {
          const results = det.detect(detectSource);
          detectTimeRef.current = Math.round(performance.now() - t0);
          let all: Detection[] = results.detections;
          setDetectionCount(results.detections.length);

          // Run face detection every other tick
          faceTickRef.current++;
          if (faceTickRef.current % 2 === 0) {
            const faceDet = faceDetectorRef.current;
            if (faceDet) {
              const faceResults = faceDet.detect(detectSource);
              for (const d of faceResults.detections) {
                if (d.categories[0]) d.categories[0].categoryName = 'face';
                all.push(d);
              }
              // Recognize face from keypoints
              if (faceResults.detections.length > 0) {
                const fd = faceResults.detections[0];
                if (fd.keypoints && fd.keypoints.length >= 4) {
                  const kp: number[] = [];
                  for (const k of fd.keypoints) { kp.push(k.x * (video?.videoWidth || 640), k.y * (video?.videoHeight || 480)); }
                  faceLandmarksRef.current = kp;
                  const rec = recognize(kp, faceDBRef.current);
                  recognizedFaceRef.current = rec;
                }
              } else {
                recognizedFaceRef.current = null;
              }
            }
          }

          detectionsRef.current = all;
          updateSmooth(all);
        } catch (err) {
          console.error("detect error:", err);
        }
      }

      // Throttle overlay/tracking to every other tick to save CPU during AI chat
      if (aiBusyRef.current) {
        tickSkipRef.current++;
        if (tickSkipRef.current % 2 !== 0) return;
      }
      drawOverlay();
      if (!aiBusyRef.current) processTracking(detectionsRef.current);
    };

    const tickSkipRef = { current: 0 };

    const detectIv = setInterval(detectAndDraw, 250);
    return () => { detectingRef.current = false; clearInterval(detectIv); };
  }, [active, modelReady]);

  function updateSmooth(raw: Detection[]) {
    const existing = smoothRef.current;
    const matched = new Set<number>();

    const next: SmoothBox[] = [];

    for (const d of raw) {
      const box = d.boundingBox!;
      const cat = d.categories[0];
      const key = cat.categoryName;
      const cx = box.originX + box.width / 2;
      const cy = box.originY + box.height / 2;

      let best = -1;
      let bestDist = 80;
      for (let i = 0; i < existing.length; i++) {
        if (matched.has(i)) continue;
        if (existing[i].key !== key) continue;
        const dx = existing[i].x + existing[i].w / 2 - cx;
        const dy = existing[i].y + existing[i].h / 2 - cy;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }

      const alpha = 0.5;
      if (best >= 0) {
        matched.add(best);
        const e = existing[best];
        next.push({
          key,
          x: e.x + (box.originX - e.x) * alpha,
          y: e.y + (box.originY - e.y) * alpha,
          w: e.w + (box.width - e.w) * alpha,
          h: e.h + (box.height - e.h) * alpha,
          score: cat.score,
          label: `${cat.categoryName} ${(cat.score * 100).toFixed(0)}%`,
        });
      } else {
        next.push({
          key, x: box.originX, y: box.originY, w: box.width, h: box.height,
          score: cat.score,
          label: `${cat.categoryName} ${(cat.score * 100).toFixed(0)}%`,
        });
      }
    }

    smoothRef.current = next;
  }

  function drawOverlay() {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    const img = streamImgRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let vw = 640, vh = 480;
    if (source === "local" && video) {
      vw = video.videoWidth || 640;
      vh = video.videoHeight || 480;
    } else if (img && img.complete) {
      vw = img.naturalWidth || 640;
      vh = img.naturalHeight || 480;
    }
    const rect = canvas.parentElement!.getBoundingClientRect();
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const ox = (rect.width - vw * scale) / 2;
    const oy = (rect.height - vh * scale) / 2;

    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.clearRect(0, 0, rect.width, rect.height);

    for (const s of smoothRef.current) {
      const x = ox + s.x * scale;
      const y = oy + s.y * scale;
      const w = s.w * scale;
      const h = s.h * scale;
      const len = Math.max(10, Math.min(24, Math.min(w, h) * 0.2));
      const isLocked = trackingRef.current && s.key === trackLabelRef.current;
      const isFace = s.key === 'face';
      const color = isLocked ? "#ef4444" : isFace ? "#d946ef" : "#3b82f6";

      ctx.save();

      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = color;
      ctx.lineWidth = isLocked ? 2.5 : 2;
      ctx.beginPath();
      ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
      ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
      ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
      ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // For face detections, only show label if recognized
      const displayLabel = isFace
        ? (recognizedFaceRef.current ? recognizedFaceRef.current.name : null)
        : s.label;

      if (displayLabel) {
        ctx.font = "10px monospace";
        const tw = ctx.measureText(displayLabel).width;
        const labelAbove = y > 22;
        const lx = x;
        const ly = labelAbove ? y - 20 : y + h + 2;

        ctx.beginPath();
        ctx.roundRect(lx, ly, tw + 10, 18, 3);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#fff";
        ctx.fillText(displayLabel, lx + 5, ly + 13);
      }

      ctx.restore();
    }
  }

  function sampleBrightness(): number {
    let canvas = brightnessCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      brightnessCanvasRef.current = canvas;
    }
    let w = 640, h = 480;
    if (source === "local") {
      const video = videoRef.current;
      if (video && video.videoWidth) { w = video.videoWidth; h = video.videoHeight; }
    } else {
      const img = streamImgRef.current;
      if (img && img.complete && img.naturalWidth) { w = img.naturalWidth; h = img.naturalHeight; }
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 255;
    if (source === "local") {
      const video = videoRef.current;
      if (video) ctx.drawImage(video, 0, 0);
      else return 255;
    } else {
      const img = streamImgRef.current;
      if (img && img.complete) ctx.drawImage(img, 0, 0);
      else return 255;
    }
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 32) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      count++;
    }
    return sum / count;
  }

  function sampleStuck(): boolean {
    const GRID_W = 8, GRID_H = 6;
    let canvas = brightnessCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      brightnessCanvasRef.current = canvas;
    }
    let w = 640, h = 480;
    const video = videoRef.current;
    const img = streamImgRef.current;
    if (source === "local" && video && video.videoWidth) {
      w = video.videoWidth; h = video.videoHeight;
    } else if (img && img.complete && img.naturalWidth) {
      w = img.naturalWidth; h = img.naturalHeight;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    if (source === "local" && video) ctx.drawImage(video, 0, 0);
    else if (img && img.complete) ctx.drawImage(img, 0, 0);
    else return false;
    const data = ctx.getImageData(0, 0, w, h).data;
    const sig: number[] = [];
    const stepX = Math.floor(w / GRID_W);
    const stepY = Math.floor(h / GRID_H);
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const px = gx * stepX + stepX / 2;
        const py = gy * stepY + stepY / 2;
        const idx = (py * w + px) * 4;
        sig.push((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
      }
    }
    const prev = prevFrameRef.current;
    prevFrameRef.current = sig;
    if (prev.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff += Math.abs(sig[i] - prev[i]);
    return diff < 15;
  }

  function filterDetections(raw: Detection[]): Detection[] {
    const persist = persistenceRef.current;
    const seen = new Set<string>();

    for (const d of raw) {
      const label = d.categories[0].categoryName;
      const score = d.categories[0].score;
      const target = trackTargetRef.current;
      const thresh = target && target.label === label ? HYST_RELEASE : HYST_ACQUIRE;
      if (score >= thresh) {
        seen.add(label);
      }
    }

    // Update persistence buffer
    for (const [label, buf] of persist) {
      buf.push(seen.has(label) ? 1 : 0);
      if (buf.length > PERSIST_FRAMES) buf.shift();
    }
    for (const label of seen) {
      if (!persist.has(label)) {
        persist.set(label, [1]);
      }
    }

    const stable = new Set<string>();
    for (const [label, buf] of persist) {
      if (buf.length >= PERSIST_MIN) {
        const count = buf.reduce((a, b) => a + b, 0);
        if (count >= PERSIST_MIN) stable.add(label);
      }
    }

    return raw.filter(d => {
      const label = d.categories[0].categoryName;
      const score = d.categories[0].score;
      const target = trackTargetRef.current;
      const thresh = target && target.label === label ? HYST_RELEASE : HYST_ACQUIRE;
      return score >= thresh && stable.has(label);
    });
  }

  function processTracking(detections: Detection[]) {
    if (!trackingRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    const stableDetections = filterDetections(detections);

    // Dark detection
    brightnessRef.current = sampleBrightness();
    if (brightnessRef.current < 35) {
      darkFramesRef.current++;
    } else {
      darkFramesRef.current = 0;
      darkAvoidRef.current = false;
    }
    if (darkFramesRef.current > 15) {
      darkAvoidRef.current = true;
    }

    if (darkAvoidRef.current) {
      const p = darkPhaseRef.current;
      darkTimerRef.current++;
      if (p === 0) {
        setLeftMotor(0); setRightMotor(0);
        sendMotor(0, 0);
        setTrackInfo('gelap!');
        if (darkTimerRef.current > 10) {
          darkPhaseRef.current = 1;
          darkTimerRef.current = 0;
        }
      } else if (p === 1) {
        setLeftMotor(-180); setRightMotor(-180);
        sendMotor(-180, -180);
        if (darkTimerRef.current > 20) {
          darkPhaseRef.current = 2;
          darkTimerRef.current = 0;
        }
      } else if (p === 2) {
        setLeftMotor(-180); setRightMotor(180);
        sendMotor(-180, 180);
        if (darkTimerRef.current > 120) {
          darkPhaseRef.current = 3;
          darkTimerRef.current = 0;
        }
      } else {
        setLeftMotor(0); setRightMotor(0);
        sendMotor(0, 0);
        darkAvoidRef.current = false;
        darkFramesRef.current = 0;
        darkPhaseRef.current = 0;
        scanStateRef.current = 'idle';
        setTrackInfo('cari...');
      }
      return;
    }

    // Stuck detection — only when motors are running
    if (stuckCooldownRef.current > 0) stuckCooldownRef.current--;
    const motorRunning = leftMotor !== 0 || rightMotor !== 0;
    if (motorRunning && stuckCooldownRef.current === 0) {
      if (sampleStuck()) {
        stuckFramesRef.current++;
        if (stuckFramesRef.current > 10) {
          stuckFramesRef.current = 0;
          stuckCooldownRef.current = 60;
          scanStateRef.current = 'idle';
          scanLevelRef.current = 0;
          trackTargetRef.current = null;
          setLeftMotor(-200); setRightMotor(200);
          sendMotor(-200, 200);
          setTrackInfo('stuck! puter...');
          setTimeout(() => {
            setLeftMotor(0); setRightMotor(0);
            sendMotor(0, 0);
          }, 800);
          return;
        }
      } else {
        stuckFramesRef.current = 0;
      }
    } else {
      stuckFramesRef.current = 0;
    }

    // Visual obstacle avoidance
    const obstacle = stableDetections.find(d => {
      if (trackLabelRef.current && d.categories[0].categoryName === trackLabelRef.current) return false;
      const box = d.boundingBox!;
      const area = (box.width / vw) * (box.height / vh);
      const cx = (box.originX + box.width / 2) / vw;
      return area > 0.25 && cx > 0.2 && cx < 0.8;
    });

    // Update telemetry map with persistent object positions
    {
      const h = headingRef.current;
      const p = posRef.current;
      const now = Date.now();
      const map = telemetryMapRef.current;
      const used = new Set<number>();
      for (const d of detections) {
        const box = d.boundingBox!;
        const cat = d.categories[0];
        const nx = (box.originX + box.width / 2) / vw;
        const area = (box.width / vw) * (box.height / vh);
        if (area < 0.005) continue;
        const angle = (nx - 0.5) * Math.PI;
        const dist = (1 - Math.min(area * 8, 1)) * 180;
        const absAngle = h + angle - Math.PI / 2;
        const wx = p.x + Math.cos(absAngle) * dist;
        const wy = p.y + Math.sin(absAngle) * dist;
        let matched = -1;
        for (let i = 0; i < map.length; i++) {
          if (used.has(i)) continue;
          if (map[i].label !== cat.categoryName) continue;
          if (Math.hypot(map[i].x - wx, map[i].y - wy) < 40) {
            matched = i;
            break;
          }
        }
        if (matched >= 0) {
          const e = map[matched];
          e.x = e.x + (wx - e.x) * 0.3;
          e.y = e.y + (wy - e.y) * 0.3;
          e.score = Math.max(e.score, cat.score);
          e.area = Math.max(e.area, area);
          e.lastSeen = now;
          used.add(matched);
        } else {
          map.push({ label: cat.categoryName, x: wx, y: wy, score: cat.score, lastSeen: now, area });
          used.add(map.length - 1);
        }
      }
      // Remove stale entries (>30s old)
      for (let i = map.length - 1; i >= 0; i--) {
        if (now - map[i].lastSeen > 30000) map.splice(i, 1);
      }
    }

    const target = trackTargetRef.current;

    if (target) {
      let found: { cx: number; cy: number; area: number; box: Detection["boundingBox"] } | null = null;
      for (const d of stableDetections) {
        if (d.categories[0].categoryName !== target.label) continue;
        const box = d.boundingBox!;
        const cx = (box.originX + box.width / 2) / vw;
        const cy = (box.originY + box.height / 2) / vh;
        const area = (box.width / vw) * (box.height / vh);
        if (area < 0.005) continue;
        if (!found || Math.hypot(cx - 0.5, cy - 0.5) < Math.hypot(found.cx - 0.5, found.cy - 0.5)) {
          found = { cx, cy, area, box };
        }
      }

      if (found) {
        trackLostRef.current = 0;
        scanStateRef.current = 'idle';
        trackTargetRef.current = { ...target, lastSeen: Date.now() };
        setTrackInfo(`${target.label}`);

        // Obstacle avoidance — if something big is in the way, swerve
        if (obstacle) {
          const obox = obstacle.boundingBox!;
          const ocx = (obox.originX + obox.width / 2) / vw;
          const steer = ocx < 0.5 ? 120 : -120;
          setLeftMotor(steer); setRightMotor(-steer);
          sendMotor(steer, -steer);
          setTrackInfo(`hindar ${obstacle.categories[0].categoryName}`);
        } else {
          trackObject(found);
        }
      } else {
        trackLostRef.current++;
        if (trackLostRef.current > 30) {
          trackTargetRef.current = null;
          setTrackInfo(`cari ${trackLabelRef.current}...`);
        }
      }
    }

    if (!trackTargetRef.current) {
      let best: { area: number; label: string } | null = null;
      for (const d of stableDetections) {
        if (trackLabelRef.current && d.categories[0].categoryName !== trackLabelRef.current) continue;
        const box = d.boundingBox!;
        const area = (box.width / vw) * (box.height / vh);
        if (area > 0.015 && (!best || area > best.area)) {
          best = { area, label: d.categories[0].categoryName };
        }
      }
      if (best) {
        trackTargetRef.current = { label: best.label, lastSeen: Date.now() };
        trackLabelRef.current = best.label;
        trackLostRef.current = 0;
        scanStateRef.current = 'idle';
        setTrackInfo(`🔒 ${best.label}`);
        return;
      }

      const SCAN_FRAMES = 60;
      const SECTORS = 16;
      const scan = scanStateRef.current;

      if (scan === 'idle') {
        scanStateRef.current = 'scanning';
        scanFrameRef.current = 0;
        scanMapRef.current = Array.from({length: SECTORS}, () => []);
        scanTargetSeeRef.current = false;
        setTrackInfo('scan...');
      }

      if (scan === 'scanning') {
        scanFrameRef.current++;
        const speed = 80;
        setLeftMotor(-speed); setRightMotor(speed);
        sendMotor(-speed, speed);

        const sector = Math.min(Math.floor((scanFrameRef.current / SCAN_FRAMES) * SECTORS), SECTORS - 1);
        const sectorData = scanMapRef.current[sector];
        for (const d of stableDetections) {
          const box = d.boundingBox!;
          const label = d.categories[0].categoryName;
          const area = (box.width / vw) * (box.height / vh);
          if (area > 0.005) {
            sectorData.push({label, area});
          }
          if (trackLabelRef.current && label === trackLabelRef.current) {
            scanTargetSeeRef.current = true;
          }
        }

        if (scanFrameRef.current >= SCAN_FRAMES) {
          scanStateRef.current = 'waiting';
          scanFrameRef.current = 0;
          setLeftMotor(0); setRightMotor(0);
          sendMotor(0, 0);

          let bestSec = 0;
          if (scanTargetSeeRef.current && trackLabelRef.current) {
            let bestArea = 0;
            for (let i = 0; i < SECTORS; i++) {
              for (const o of scanMapRef.current[i]) {
                if (o.label === trackLabelRef.current && o.area > bestArea) {
                  bestArea = o.area;
                  bestSec = i;
                }
              }
            }
            setTrackInfo('target terlihat!');
          } else {
            let leastObj = Infinity;
            for (let i = 0; i < SECTORS; i++) {
              const count = scanMapRef.current[i].length;
              if (count < leastObj) {
                leastObj = count;
                bestSec = i;
              }
            }
            setTrackInfo(`arah ${bestSec}`);
          }
          scanBestSecRef.current = bestSec;
        }
      }

      if (scan === 'waiting') {
        scanFrameRef.current++;
        const elapsed = scanFrameRef.current;

        if (elapsed < 10) {
          setLeftMotor(0); setRightMotor(0);
          sendMotor(0, 0);
          return;
        }

        const speed = 150;
        const bestSec = scanBestSecRef.current;
        const lastScanSector = SECTORS - 1;
        const dstCW = (bestSec - lastScanSector + SECTORS) % SECTORS;
        const dstCCW = (lastScanSector - bestSec + SECTORS) % SECTORS;
        const rotateSectors = Math.min(dstCW, dstCCW);
        const reverse = dstCCW < dstCW;
        const rotateFrames = Math.round((rotateSectors / SECTORS) * SCAN_FRAMES);
        const rotElapsed = elapsed - 10;

        if (rotElapsed < rotateFrames) {
          if (reverse) {
            setLeftMotor(speed); setRightMotor(-speed);
            sendMotor(speed, -speed);
          } else {
            setLeftMotor(-speed); setRightMotor(speed);
            sendMotor(-speed, speed);
          }
          setTrackInfo(`muter...`);
        } else {
          setLeftMotor(0); setRightMotor(0);
          sendMotor(0, 0);

          if (scanTargetSeeRef.current && trackLabelRef.current) {
            scanStateRef.current = 'idle';
            setTrackInfo('cari...');
          } else {
            scanStateRef.current = 'moving';
            scanFrameRef.current = 0;
            setTrackInfo('maju...');
          }
        }
      }

      if (scan === 'moving') {
        scanFrameRef.current++;
        const moveFrames = SPIRAL_MOVES[scanLevelRef.current] || 180;
        setLeftMotor(120); setRightMotor(120);
        sendMotor(120, 120);
        if (scanFrameRef.current >= moveFrames) {
          setLeftMotor(0); setRightMotor(0);
          sendMotor(0, 0);
          if (scanLevelRef.current >= SPIRAL_MAX) {
            scanLevelRef.current = 0;
            scanStateRef.current = 'idle';
            setTrackInfo('cari lagi...');
          } else {
            scanLevelRef.current++;
            scanStateRef.current = 'scanning';
            scanFrameRef.current = 0;
            scanMapRef.current = Array.from({length: SECTORS}, () => []);
            scanTargetSeeRef.current = false;
            setTrackInfo(`spiral ${scanLevelRef.current}/${SPIRAL_MAX}`);
          }
        }
      }
    }
  }

  function trackObject(found: { cx: number; cy: number; area: number }) {
    const stopZone = 0.22;
    if (found.area > stopZone) {
      setLeftMotor(0); setRightMotor(0);
      sendMotor(0, 0);
      setTrackInfo(`🔒 ${trackLabelRef.current} ✅`);
      return;
    }
    const errorX = found.cx - 0.5;
    const kp = 200;
    const turn = errorX * kp;
    const speedT = found.area / stopZone;
    const baseSpeed = Math.round((1 - speedT) * 200);
    let l = baseSpeed - Math.round(turn);
    let r = baseSpeed + Math.round(turn);
    l = Math.max(-255, Math.min(255, l));
    r = Math.max(-255, Math.min(255, r));
    setLeftMotor(l); setRightMotor(r);
    sendMotor(l, r);
  }

  useEffect(() => { faceDBRef.current = loadDB(); }, []);

  useEffect(() => () => {
    wsRef.current?.close();
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
  }, []);

  return (
    <main className="flex flex-col items-center bg-black min-h-dvh px-3 pt-3 pb-3 gap-2 overflow-y-auto">
      {/* CAMERA + OVERLAY + HUD */}
      <div className="relative w-full max-w-sm aspect-square rounded-xl overflow-hidden bg-zinc-900 ring-1 ring-white/10 flex-shrink-0">
        <video ref={videoRef} autoPlay playsInline muted
          className={`absolute inset-0 h-full w-full object-contain ${source !== "local" ? "hidden" : ""}`} />
        {source === "stream" && proxiedStreamUrl ? (
          <img ref={streamImgRef} src={proxiedStreamUrl} crossOrigin="anonymous" alt="stream"
            className="absolute inset-0 h-full w-full object-contain" />
        ) : null}
        <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none z-20" />
        <canvas ref={streamDetCanvasRef} className="hidden" />

        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <div className="size-8 rounded-full border border-zinc-600 flex items-center justify-center">
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <span className="text-[9px] font-medium tracking-wider">MATI</span>
          </div>
        )}

        {source === "stream" && !streamUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <div className="size-8 rounded-full border border-zinc-600 flex items-center justify-center">
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <span className="text-[9px] font-medium tracking-wider">STREAM KOSONG</span>
          </div>
        )}

        {/* Top HUD */}
        <button onClick={() => setShowEspInput((p) => !p)}
          className="absolute top-1.5 left-1.5 z-30 h-7 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center gap-1.5 px-2 hover:bg-black/70">
          <div className={`size-2 rounded-full ${wsConnected || mqttConnected ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" : "bg-zinc-500"}`} />
          <span className="text-[7px] font-mono tracking-wider text-zinc-400">ESP</span>
        </button>
        {modelLoading && !modelReady && (
          <div className="absolute top-1.5 left-9 z-30 flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-[7px] text-yellow-400 font-mono">model...</span>
          </div>
        )}
        {modelReady && (
          <div className="absolute top-1.5 left-9 z-30 flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-green-400" />
            <span className="text-[7px] text-green-400 font-mono">{detectionCount} obj</span>
            <button onClick={() => {
              if (tracking) {
                setTracking(false); trackingRef.current = false; trackTargetRef.current = null; trackLabelRef.current = null; setTrackInfo(""); setPickerTargets([]);
              } else {
                setTracking(true); trackingRef.current = true;
                const labels = [...new Set(detectionsRef.current.map(d => d.categories[0].categoryName))];
                if (labels.length === 0) { setTrackInfo("mencari..."); } else if (labels.length === 1) {
                  trackTargetRef.current = { label: labels[0], lastSeen: Date.now() }; trackLabelRef.current = labels[0]; setTrackInfo(`🔒 ${labels[0]}`); setPickerTargets([]);
                } else { setPickerTargets(labels); setTrackInfo("pilih objek"); }
              }
            }}
              className="ml-1 size-4 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border"
              style={{ backgroundColor: tracking ? "#ef4444" : "transparent", borderColor: tracking ? "#ef4444" : "rgba(255,255,255,0.2)", color: tracking ? "#000" : "rgba(255,255,255,0.5)" }}>
              F
            </button>
            {tracking && trackInfo && (
              <span className="text-[7px] text-red-400 font-mono ml-0.5">{trackInfo}</span>
            )}
            <button onClick={() => { setDebug(p => { debugRef.current = !p; return !p; }); }}
              className="ml-1 size-4 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border"
              style={{ backgroundColor: debug ? "rgba(255,255,255,0.2)" : "transparent", borderColor: debug ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)", color: debug ? "#fff" : "rgba(255,255,255,0.4)" }}>
              D
            </button>
          </div>
        )}
        <button onClick={() => { if (source === "stream") { setSource("local"); setActive(false); } else { setSource("stream"); setActive(true); } }}
          className="absolute top-1.5 right-1.5 z-30 size-7 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-black/70 active:scale-90">
          <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12.75 3.03v.568c0 .334.148.65.405.864l1.068.89c.442.369.535 1.01.216 1.49l-.51.766a2.25 2.25 0 0 1-1.161.886l-.143.048a1.107 1.107 0 0 0-.57 1.664c.369.555.169 1.307-.427 1.605L9 13.125l3.75-6.375" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 20.25a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          </svg>
        </button>

        {/* Bottom HUD */}
        {source === "local" && (
          <button onClick={() => setActive((p) => !p)}
            className="absolute bottom-1.5 right-1.5 z-30 size-8 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-black/70 active:scale-90">
            <div className={`size-2.5 rounded-full duration-300 ${active ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-zinc-500"}`} />
          </button>
        )}
        {source === "local" && (
          <button onClick={() => setFacingMode((p) => p === "environment" ? "user" : "environment")}
            className="absolute bottom-1.5 left-1.5 z-30 size-8 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-black/70 active:scale-90">
            <svg className="size-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </button>
        )}

        {/* TARGET PICKER */}
        {pickerTargets.length > 0 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 flex gap-1.5">
            {pickerTargets.map(label => (
              <button key={label} onClick={() => { trackTargetRef.current = { label, lastSeen: Date.now() }; trackLabelRef.current = label; setTrackInfo(`🔒 ${label}`); setPickerTargets([]); }}
                className="px-2 py-1 rounded-full bg-black/70 text-white text-[9px] font-mono font-bold border border-white/20 backdrop-blur-md active:scale-90">
                {label}
              </button>
            ))}
          </div>
        )}

        {/* FACE REGISTER */}
        {!registering && recognizedFaceRef.current === null && faceLandmarksRef.current.length > 0 && (
          <button onClick={() => { setRegistering(true); setRegName(""); }}
            className="absolute bottom-8 right-2 z-40 size-7 rounded-full bg-fuchsia-600/80 text-white text-[8px] font-mono font-bold border border-fuchsia-400/40 backdrop-blur-md flex items-center justify-center active:scale-90">
            +
          </button>
        )}
        {registering && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex gap-1 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl px-2.5 py-2 items-center">
            <input value={regName} onChange={e => setRegName(e.target.value)} placeholder="nama"
              className="w-24 px-1.5 py-0.5 rounded bg-zinc-800 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
            <button onClick={() => {
              if (!regName) return;
              faceDBRef.current = registerFace(faceDBRef.current, regName, faceLandmarksRef.current);
              recognizedFaceRef.current = faceDBRef.current[faceDBRef.current.length - 1];
              setRegistering(false);
            }}
              className="px-2 py-0.5 rounded-full bg-fuchsia-600 text-white text-[7px] font-mono font-bold active:scale-90">
              SIMPAN
            </button>
            <button onClick={() => setRegistering(false)}
              className="px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300 text-[7px] font-mono active:scale-90">
              X
            </button>
          </div>
        )}
      </div>

      {/* DEBUG PANEL */}
      {debug && (
        <div className="w-full max-w-sm rounded-xl bg-zinc-900/90 ring-1 ring-white/10 px-3 py-2 text-[8px] font-mono">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-zinc-400">
            <span>detect: <span className="text-white">{detectTimeRef.current}ms</span></span>
            <span>fps: <span className="text-white">{detectTimeRef.current > 0 ? (1000 / detectTimeRef.current).toFixed(1) : "-"}</span></span>
            <span>model: <span className="text-white">EfficientDet Lite0</span></span>
            <span>motor: <span className="text-blue-400">L:{leftMotor}</span><span className="text-zinc-600">/{telemetry.left ?? '?'}</span> <span className="text-orange-400">R:{rightMotor}</span><span className="text-zinc-600">/{telemetry.right ?? '?'}</span></span>
            <span>track: <span className="text-white">{trackInfo || "-"}</span></span>
            <span>scan: <span className="text-purple-400">{scanStateRef.current}</span></span>
            <span>gelap: <span className={darkAvoidRef.current ? "text-red-400" : "text-zinc-600"}>{darkAvoidRef.current ? "YA" : "tidak"}</span> <span className="text-zinc-600">({brightnessRef.current.toFixed(0)})</span></span>
            <span>ws: <span className={wsConnected ? "text-green-400" : "text-red-400"}>{wsConnected ? "ON" : "OFF"}</span></span>
          </div>
          {detectionsRef.current.length > 0 && (
            <div className="mt-1 pt-1 border-t border-white/5 text-zinc-500 leading-3">
              {detectionsRef.current.map((d, i) => {
                const b = d.boundingBox!;
                return (
                  <div key={i} className="truncate">
                    <span className="text-green-400">{d.categories[0].categoryName}</span>
                    <span className="text-zinc-600"> ({d.categories[0].score.toFixed(2)}) </span>
                    <span className="text-zinc-600">[{b.originX.toFixed(0)},{b.originY.toFixed(0)} {b.width.toFixed(0)}x{b.height.toFixed(0)}]</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ESP / STREAM INPUT */}
      {showEspInput && (
        <div className="w-full max-w-sm flex flex-col gap-1.5">
          {/* baris 1: IP + HUBUNG + CARI + PING */}
          <div className="flex gap-1.5">
            <input value={espIp} onChange={(e) => setEspIp(e.target.value)}
              placeholder="IP atau kei.local"
              className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
            <button onClick={wsConnected ? disconnectESP : connectESP}
              className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold flex-shrink-0">
              {wsConnected ? "PUTUS" : "HUBUNG"}
            </button>
            <button onClick={discoverESP}
              className="px-2.5 py-1.5 rounded-full bg-zinc-800 text-zinc-300 text-[9px] font-mono font-bold border border-zinc-700 flex-shrink-0 active:scale-90 disabled:opacity-40"
              disabled={scanning}>
              {scanning ? "..." : "CARI"}
            </button>
            <button onClick={sendPing}
              className="px-2.5 py-1.5 rounded-full bg-zinc-800 text-zinc-300 text-[9px] font-mono font-bold border border-zinc-700 flex-shrink-0 active:scale-90">
              PING
            </button>
          </div>
          {scanStatus && !wsConnected && (
            <span className="text-[7px] font-mono text-zinc-600">{scanStatus}</span>
          )}
          {/* baris 2: MQTT toggle + status */}
          <div className="flex gap-1.5 items-center">
            <button onClick={() => setShowMqttInput(p => !p)}
              className={`px-2.5 py-1.5 rounded-full text-[9px] font-mono font-bold border flex-shrink-0 active:scale-90 ${
                mqttConnected
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : "bg-transparent border-zinc-700 text-zinc-400"
              }`}>
              MQTT {mqttConnected ? "ON" : "OFF"}
            </button>
            {mqttConnected ? (
              <button onClick={disconnectMQTT}
                className="px-2 py-1.5 rounded-full bg-zinc-800 text-zinc-300 text-[9px] font-mono border border-zinc-700 flex-shrink-0 active:scale-90">
                PUTUS MQTT
              </button>
            ) : mqttBroker ? (
              <button onClick={connectMQTT}
                className="px-2 py-1.5 rounded-full bg-emerald-700 text-white text-[9px] font-mono font-bold flex-shrink-0 active:scale-90">
                HUBUNG MQTT
              </button>
            ) : null}
            {mqttStatus && (
              <span className="text-[7px] font-mono truncate max-w-28"
                style={{ color: mqttConnected ? "#34d399" : mqttStatus.includes("gagal") ? "#ef4444" : "#a1a1aa" }}>
                {mqttStatus}
              </span>
            )}
          </div>
          {/* MQTT config */}
          {showMqttInput && (
            <div className="flex flex-col gap-1.5 p-2 rounded-xl bg-zinc-900/80 ring-1 ring-white/10">
              <div className="flex gap-1.5">
                <input value={mqttBroker} onChange={e => setMqttBroker(e.target.value)}
                  placeholder="broker.hivemq.cloud"
                  className="flex-1 min-w-0 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
                <input value={mqttPort} onChange={e => setMqttPort(Number(e.target.value))}
                  placeholder="8884"
                  title="Browser: WSS :8884 | ESP: TLS :8883"
                  className="w-14 px-1.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500 text-center" />
              </div>
              <div className="flex gap-1.5">
                <input value={mqttUser} onChange={e => setMqttUser(e.target.value)}
                  placeholder="username"
                  className="flex-1 min-w-0 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
                <input value={mqttPass} onChange={e => setMqttPass(e.target.value)}
                  placeholder="password"
                  type="password"
                  className="flex-1 min-w-0 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="flex gap-1.5">
                <input value={mqttPrefix} onChange={e => setMqttPrefix(e.target.value)}
                  placeholder="kei/robot"
                  className="flex-1 min-w-0 px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
              </div>
              <div className="flex gap-1">
                <button onClick={connectMQTT}
                  className="flex-1 px-2 py-1 rounded-full bg-emerald-600 text-white text-[9px] font-mono font-bold active:scale-90">
                  HUBUNGKAN
                </button>
                <button onClick={() => sendESP({ mqttBroker, mqttPort: 8883, mqttUser, mqttPass, mqttPrefix, mqttEnabled: true })}
                  className="px-2 py-1 rounded-full bg-zinc-800 text-zinc-300 text-[9px] font-mono border border-zinc-700 active:scale-90">
                  KIRIM KE ESP
                </button>
              </div>
            </div>
          )}
          {/* baris 3: kontrol + telemetry */}
          {wsConnected && (
            <>
              <div className="flex flex-wrap gap-1.5 items-center">
                <button onClick={() => sendESP({ emergency: !(telemetry.emergency ?? false) })}
                  className="px-2 py-1 rounded-full text-[9px] font-mono font-bold active:scale-90 flex-shrink-0"
                  style={{
                    backgroundColor: (telemetry.emergency) ? '#ef4444' : 'transparent',
                    borderColor: (telemetry.emergency) ? '#ef4444' : 'rgba(255,255,255,0.15)',
                    color: (telemetry.emergency) ? '#fff' : 'rgba(255,255,255,0.4)',
                  }}>
                  {(telemetry.emergency) ? 'DARURAT' : 'EMERGENCY'}
                </button>
                <button onClick={() => {
                  const next = !(telemetry.powerSave ?? false);
                  const label = next ? 'BATERAI (hemat)' : 'KENCANG (cepat)';
                  if (window.confirm(`Ubah ke mode ${label}?\n\nESP akan restart.`)) {
                    sendConfig({ powerSave: next });
                  }
                }}
                  className="px-2 py-1 rounded-full text-[9px] font-mono font-bold border active:scale-90 flex-shrink-0"
                  style={{
                    backgroundColor: (telemetry.powerSave ?? false) ? '#3b82f6' : 'transparent',
                    borderColor: (telemetry.powerSave ?? false) ? '#3b82f6' : 'rgba(255,255,255,0.15)',
                    color: (telemetry.powerSave ?? false) ? '#000' : 'rgba(255,255,255,0.4)',
                  }}>
                  {(telemetry.powerSave ?? false) ? 'BATERAI' : 'KENCANG'}
                </button>
                {[3, 8, 15].map(r => (
                  <button key={r} onClick={() => sendConfig({ rampRate: r })}
                    className="px-2 py-1 rounded-full text-[9px] font-mono font-bold border active:scale-90 flex-shrink-0"
                    style={{
                      backgroundColor: (telemetry.rampRate ?? 8) === r ? '#3b82f6' : 'transparent',
                      borderColor: (telemetry.rampRate ?? 8) === r ? '#3b82f6' : 'rgba(255,255,255,0.15)',
                      color: (telemetry.rampRate ?? 8) === r ? '#000' : 'rgba(255,255,255,0.4)',
                    }}>
                    RAMP {r}
                  </button>
                ))}
                <button onClick={() => sendConfig({ speedLimitEnabled: !(telemetry.speedLimitEnabled ?? false) })}
                  className="px-2 py-1 rounded-full text-[9px] font-mono font-bold border active:scale-90 flex-shrink-0"
                  style={{
                    minWidth: '74px',
                    backgroundColor: (telemetry.speedLimitEnabled) ? '#f59e0b' : 'transparent',
                    borderColor: (telemetry.speedLimitEnabled) ? '#f59e0b' : 'rgba(255,255,255,0.15)',
                    color: (telemetry.speedLimitEnabled) ? '#000' : 'rgba(255,255,255,0.4)',
                  }}>
                  LIMIT {(telemetry.speedLimitEnabled) ? telemetry.speedLimit ?? 150 : 'OFF'}
                </button>
                <input type="range" min="50" max="255" step="5"
                  value={telemetry.speedLimit ?? 150}
                  onChange={(e) => sendConfig({ speedLimit: parseInt(e.target.value) })}
                  className="w-20 h-1 accent-amber-500"
                  style={{ opacity: telemetry.speedLimitEnabled ? 1 : 0.25 }} />
                <span className="text-zinc-500 text-[8px] font-mono">max</span>
                <input type="range" min="128" max="255" step="1"
                  value={telemetry.maxSpeed ?? 255}
                  onChange={(e) => sendConfig({ maxSpeed: parseInt(e.target.value) })}
                  className="w-16 h-1 accent-blue-500" />
                <span className="text-zinc-500 text-[7px] font-mono w-6 text-right">{telemetry.maxSpeed ?? 255}</span>
                <span className="text-zinc-500 text-[8px] font-mono">tm</span>
                <input type="number" min="1000" max="30000" step="1000"
                  value={telemetry.motorTimeout ?? 5000}
                  onChange={(e) => sendConfig({ motorTimeout: parseInt(e.target.value) || 5000 })}
                  className="w-12 px-1 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-white text-[7px] font-mono text-center" />
              </div>
              {/* telemetry grid */}
              <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 px-3 py-1.5 rounded-xl bg-zinc-900/80 ring-1 ring-white/10 text-[8px] font-mono">
                <span className="text-zinc-500">L <span className="text-blue-400">{telemetry.left ?? telemetry.speed ?? '-'}</span></span>
                <span className="text-zinc-500">R <span className="text-orange-400">{telemetry.right ?? telemetry.speed ?? '-'}</span></span>
                <span className="text-zinc-500">mode <span className={telemetry.mode === 'emergency' ? 'text-red-400' : 'text-green-400'}>{telemetry.mode ?? '-'}</span></span>
                <span className="text-zinc-500">rssi <span className="text-yellow-400">{telemetry.rssi ?? '-'} dBm</span></span>
                <span className="text-zinc-500">heap <span className="text-fuchsia-400">{telemetry.heap ? `${(telemetry.heap / 1024).toFixed(0)}KB` : '-'}</span></span>
                <span className="text-zinc-500">uptime <span className="text-white">{telemetry.uptime ? `${Math.floor(telemetry.uptime / 60)}m${telemetry.uptime % 60}s` : '-'}</span></span>
                <span className="text-zinc-500">{telemetry.ip ?? '-'}</span>
                {telemetry.ssid && (
                  <span className="text-zinc-500 col-span-2">ssid <span className="text-cyan-400">{telemetry.ssid}</span></span>
                )}
                {telemetry.ssid && (
                  <button onClick={() => setShowWifiConfig((p) => !p)}
                    className="text-right text-[7px] font-mono text-zinc-600 hover:text-zinc-300 active:scale-90">
                    {showWifiConfig ? "tutup" : "ganti wifi"}
                  </button>
                )}
              </div>
              {/* wifi config */}
              {showWifiConfig && (
                <div className="flex gap-1.5">
                  <input value={wifiSsid} onChange={(e) => setWifiSsid(e.target.value)}
                    placeholder="SSID baru"
                    className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
                  <input value={wifiPass} onChange={(e) => setWifiPass(e.target.value)}
                    placeholder="Password"
                    type="password"
                    className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
                  <button onClick={() => { sendESP({ ssid: wifiSsid, password: wifiPass }); setWifiSsid(""); setWifiPass(""); setShowWifiConfig(false); }}
                    className="px-3 py-1.5 rounded-full bg-amber-600 text-white text-[9px] font-mono font-bold active:scale-90 flex-shrink-0">
                    GANTI
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {source === "stream" && (
        <div className="flex gap-1.5 w-full max-w-sm">
          <input value={inputUrl} onChange={(e) => setInputUrl(e.target.value)}
            placeholder="URL stream"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
          <button onClick={() => setStreamUrl(inputUrl)}
            className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-200 flex-shrink-0">
            {streamUrl ? "GANTI" : "PAKAI"}
          </button>
        </div>
      )}

      {/* TELEMETRI + JOYSTICK */}
      <div className="w-full max-w-sm grid grid-cols-2 gap-2">
        <div className="aspect-square rounded-xl bg-zinc-900 ring-1 ring-white/10 relative overflow-hidden">
          {showTelemetry ? (
            <Simulasi
              headingRef={headingRef}
              posRef={posRef}
              telemetryMapRef={telemetryMapRef}
              scanStateRef={scanStateRef}
              scanMapRef={scanMapRef}
              scanBestSecRef={scanBestSecRef}
              scanTargetSeeRef={scanTargetSeeRef}
              trackLabelRef={trackLabelRef}
              trackTargetRef={trackTargetRef}
              detectionsRef={detectionsRef}
              trackingRef={trackingRef}
              leftMotor={leftMotor}
              rightMotor={rightMotor}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[8px] font-mono text-zinc-600">TELEMETRI OFF</span>
            </div>
          )}
          <button onClick={() => setShowTelemetry(p => !p)}
            className="absolute top-1.5 left-1.5 z-10 size-5 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border"
            style={{ backgroundColor: showTelemetry ? "#a855f7" : "transparent", borderColor: showTelemetry ? "#a855f7" : "rgba(255,255,255,0.15)", color: showTelemetry ? "#000" : "rgba(255,255,255,0.4)" }}>
            T
          </button>
          <div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-x-2 px-2 py-1 text-[6px] font-mono text-zinc-600 bg-black/40">
            <span><span style={{ color: '#3b82f6' }}>&#9650;</span> robot</span>
            <span><span style={{ color: '#22c55e' }}>&#8593;</span> gerak</span>
            <span><span style={{ color: 'rgba(239,68,68,0.6)' }}>██</span> halang</span>
            <span><span style={{ color: 'rgba(34,197,94,0.6)' }}>██</span> kosong</span>
            <span><span style={{ color: '#22c55e' }}>&#9679;</span> objek</span>
            <span><span style={{ color: '#ef4444' }}>&#9679;</span> target</span>
          </div>
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
          <div
            className="absolute size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 backdrop-blur-md border border-white/20"
            style={{ left: `calc(50% + ${joyPos.x}px)`, top: `calc(50% + ${joyPos.y}px)` }}
          />
          <div className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1.5">
            <button onClick={() => { setStraightAssist(p => { straightAssistRef.current = !p; return !p; }); }}
              className="size-5 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border"
              style={{ backgroundColor: straightAssist ? "#3b82f6" : "transparent", borderColor: straightAssist ? "#3b82f6" : "rgba(255,255,255,0.15)", color: straightAssist ? "#000" : "rgba(255,255,255,0.4)" }}>
              S
            </button>
          </div>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-10 flex gap-2 text-[7px] font-mono">
            <span className="text-blue-400">L:{leftMotor}</span><span className="text-zinc-600">/{telemetry.left ?? '?'}</span>
            <span className="text-orange-400">R:{rightMotor}</span><span className="text-zinc-600">/{telemetry.right ?? '?'}</span>
          </div>
        </div>
      </div>

      {/* AI GROQ */}
      <AIGroq
        recognizedFaceRef={recognizedFaceRef}
        detectionsRef={detectionsRef}
        trackInfoRef={trackInfoRef}
        scanStateRef={scanStateRef}
        aiBusyRef={aiBusyRef}
      />
    </main>
  );
}
