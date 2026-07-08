"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ObjectDetector, FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision";
import { loadDB, saveDB, registerFace, renameFace, deleteFace, recognize, type FaceRecord } from "../facerecog";
import VoiceGroq from "../voicegroq";

import type { LogEntry, ServoRead, FacingMode, MotorRef } from "./types";
import { ROBOT_R, TRAIL_LEN, MAX_SENSE, JOY_DEADZONE, MAX_LOG, SECTORS, SERVO_SCALE, WHEEL_BASE, PRESETS } from "./constants";
import { gridCellKey } from "./utils";
import { drawScene, type DrawState } from "./renderer";
import MonitorPanel from "./monitor-panel";
import { EvolutionEngine, Brain, LAYERS } from "./neuroevolve";

const _ = (...notes: [number, number][]) => notes;

const KNOWN_MELODIES: Record<string, (ws: WebSocket | null) => [number, number][] | null> = {
  pelangi: () => _(
    [262,300],[330,300],[392,300],[523,400],[392,300],[330,300],[262,600],[0,150],
    [330,300],[392,300],[523,400],[587,400],[523,400],[392,300],[330,600],[0,150],
    [392,200],[440,200],[523,400],[587,400],[659,400],[587,400],[523,400],[440,300],[392,300],[330,400],[0,200],
    [262,300],[330,300],[392,300],[523,400],[587,400],[659,400],[523,400],[587,400],[523,400],[392,300],[330,300],[262,800],[0,200],
    [392,200],[440,200],[494,300],[523,400],[587,300],[659,300],[784,500],[0,200],
    [659,300],[587,300],[523,400],[587,400],[523,400],[440,300],[392,300],[330,300],[262,600],[0,200],
    [262,300],[330,300],[392,300],[523,400],[587,400],[659,400],[523,400],[0,150],
    [262,300],[330,300],[392,300],[523,400],[587,400],[523,400],[392,300],[330,300],[262,800],
  ),
  bebek: () => _(
    [392,200],[440,200],[523,300],[440,200],[392,200],[349,300],[330,500],[0,150],
    [349,200],[392,200],[440,300],[349,200],[330,200],[294,300],[262,500],[0,150],
    [262,200],[330,200],[392,300],[349,200],[330,200],[294,300],[262,400],[0,150],
    [392,200],[440,200],[523,300],[587,300],[523,300],[440,200],[392,200],[349,300],[330,200],[294,200],[262,600],[0,200],
    [392,200],[440,200],[523,300],[440,200],[392,200],[349,300],[330,500],[0,150],
    [349,200],[392,200],[440,300],[349,200],[330,200],[294,300],[262,500],[0,150],
    [440,200],[494,200],[523,300],[587,300],[523,300],[494,200],[440,200],[0,150],
    [392,200],[440,200],[523,300],[440,200],[392,200],[349,300],[330,200],[294,200],[262,600],
  ),
  balonku: () => _(
    [262,200],[294,200],[330,200],[349,200],[392,400],[349,200],[330,200],[294,400],[0,150],
    [262,200],[294,200],[330,200],[349,200],[392,400],[440,400],[392,200],[349,200],[330,200],[294,200],[262,400],[0,150],
    [262,200],[294,200],[330,200],[349,200],[392,300],[440,200],[523,500],[0,150],
    [392,200],[349,200],[330,200],[294,200],[262,400],[294,200],[330,200],[349,200],[392,300],[349,200],[330,200],[294,200],[262,600],[0,200],
    [294,200],[330,200],[392,200],[440,200],[494,300],[440,200],[392,200],[330,400],[0,150],
    [262,200],[294,200],[330,200],[349,200],[392,300],[440,200],[523,500],[0,150],
    [523,200],[494,200],[440,200],[392,200],[349,300],[330,200],[294,200],[262,300],[0,150],
    [262,200],[294,200],[330,200],[349,200],[392,300],[440,300],[392,200],[349,200],[330,200],[294,200],[262,600],
  ),
  kupu: () => _(
    [523,300],[587,300],[659,300],[523,400],[659,300],[587,300],[523,600],[0,150],
    [494,300],[523,300],[587,300],[659,300],[523,400],[494,300],[440,600],[0,150],
    [392,200],[440,200],[494,300],[523,400],[587,300],[659,300],[523,500],[0,150],
    [523,300],[587,300],[659,300],[784,300],[659,300],[587,300],[523,300],[494,300],[440,300],[392,300],[330,300],[262,600],[0,200],
    [440,300],[494,300],[523,400],[587,400],[659,400],[784,400],[659,500],[0,150],
    [587,300],[659,300],[784,400],[659,400],[587,400],[523,400],[494,300],[440,600],[0,150],
    [523,300],[587,300],[659,300],[784,300],[659,300],[587,300],[523,400],[0,150],
    [494,300],[440,300],[392,300],[523,400],[440,300],[392,300],[330,300],[262,600],
  ),
  burung: () => _(
    [392,200],[523,200],[392,200],[523,200],[587,400],[659,400],[523,400],[0,150],
    [440,200],[494,200],[523,400],[440,200],[392,200],[349,400],[330,400],[0,150],
    [330,200],[392,200],[440,200],[494,200],[523,300],[587,200],[659,400],[0,150],
    [523,200],[587,200],[659,300],[784,300],[659,300],[587,300],[523,400],[440,200],[392,200],[349,300],[330,300],[262,600],[0,200],
    [392,200],[523,200],[587,300],[659,400],[523,400],[0,150],
    [440,200],[494,200],[523,400],[587,400],[659,300],[523,300],[0,150],
    [523,200],[587,200],[659,300],[784,400],[659,300],[587,300],[523,400],[440,300],[0,150],
    [523,300],[494,300],[440,300],[392,300],[349,300],[330,300],[294,300],[262,600],
  ),
  tahunbaru: () => _(
    [523,200],[523,200],[523,200],[659,400],[523,400],[784,400],[659,500],[0,150],
    [587,200],[523,200],[659,400],[784,400],[659,400],[523,500],[0,150],
    [523,200],[587,200],[659,300],[784,300],[659,300],[587,300],[523,400],[0,150],
    [392,200],[440,200],[523,300],[587,300],[523,300],[440,200],[392,200],[349,300],[330,300],[262,600],[0,200],
    [392,200],[440,200],[523,300],[587,300],[659,400],[523,400],[0,150],
    [494,200],[523,200],[587,300],[659,400],[784,400],[659,300],[523,400],[0,150],
    [523,200],[587,200],[659,300],[784,400],[659,300],[587,300],[523,400],[440,300],[0,150],
    [392,200],[349,200],[330,300],[294,300],[262,500],[330,300],[392,300],[523,500],
  ),
};

export default function SimulasiPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef({ x: 0, y: 350 });
  const headingRef = useRef(0);
  const velRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1.8);

  const leftMotorRef = useRef(0);
  const rightMotorRef = useRef(0);
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const joyActiveRef = useRef(false);
  const joystickRef = useRef<HTMLDivElement>(null);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const [leftMotor, setLeftMotor] = useState(0);
  const [rightMotor, setRightMotor] = useState(0);
  const scanDotsRef = useRef<Array<{ x: number; y: number }>>([]);
  const sweepPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastSweepAngleRef = useRef(-1);
  const distanceRef = useRef(-1);
  const [trimVal, setTrimVal] = useState(() => typeof window !== "undefined" ? Number(localStorage.getItem("kei_trim") || "0") : 0);
  const trimRef = useRef(0);
  useEffect(() => { trimRef.current = trimVal; localStorage.setItem("kei_trim", String(trimVal)); }, [trimVal]);
  const [sensorDist, setSensorDist] = useState("---");
  const gyroRef = useRef(0);
  const scanFrameCountRef = useRef(0);

  // Virtual Hardware State
  const [buzzerActive, setBuzzerActive] = useState(false);
  const [buzzerVol, setBuzzerVol] = useState(128);
  const [ledMode, setLedMode] = useState(0);
  const ledModeRef = useRef(0);
  const [ledMask, setLedMask] = useState(0);
  const lastBuzzerRef = useRef(0);
  const keyActiveRef = useRef(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const sectorDataRef = useRef<number[]>(SECTORS.map(() => -1));
  const [sectorData, setSectorData] = useState<number[]>(SECTORS.map(() => -1));

  // M3: Autopilot
  const [modul3Active, setModul3Active] = useState(false);
  const modul3ActiveRef = useRef(false);
  const sweepDirRef = useRef(1);
  const bestSectorRef = useRef(-1);
  const prevBestSectorRef = useRef(-1);
  const sweepLockedRef = useRef(false);
  const m3PhaseRef = useRef<"SWEEP" | "TURN" | "DRIVE" | "BACK" | "DONE">("SWEEP");
  const sweepTickRef = useRef(0);
  const turnTargetRadRef = useRef(0);
  const turnSpeedRef = useRef(0);
  const turnStuckCountRef = useRef(0);
  const turnYawLogRef = useRef<number[]>([]);
  const turnRampTickRef = useRef(0);
  const turnTimeoutRef = useRef(0);
  const backTickRef = useRef(0);
  const turnIsUturnRef = useRef(false);
  const driveTargetHeadingRef = useRef(0);

  // M4: Groq AI Hybrid
  const [modul4Active, setModul4Active] = useState(false);
  const modul4ActiveRef = useRef(false);  const aiSuggestionRef = useRef(-1);
  const aiSuggestionWeightRef = useRef(0);
  const aiLastCallRef = useRef(0);
  const aiCallCountRef = useRef(0);
  const [aiStatus, setAiStatus] = useState("—");
  const [groqApiKey, setGroqApiKey] = useState("");
  const groqApiKeyRef = useRef("");

  // M7: Neuro-Evolution
  const [modul7Active, setModul7Active] = useState(false);
  const modul7ActiveRef = useRef(false);
  const evoEngineRef = useRef<EvolutionEngine | null>(null);
  const [evoStats, setEvoStats] = useState({ gen: 0, best: 0, avg: 0, running: false, bestFitness: 0 });
  const [evoPreset, setEvoPreset] = useState<keyof typeof PRESETS>("LABIRIN");
  const deployGenomeRef = useRef<number[] | null>(null);
  const [evoBrainActive, setEvoBrainActive] = useState(false);
  const evoBrainActiveRef = useRef(false);
  const deployBrainRef = useRef<Brain | null>(null);
  const evoProgressRef = useRef(0);
  const [evoProgress, setEvoProgress] = useState(0);
  const evoPresets: (keyof typeof PRESETS)[] = ["DINDING", "LABIRIN", "RINTANGAN", "BUNTU", "SLALOM", "HUTAN"];

  // Camera state (needed by draw, declared early)
  const [camActive, setCamActive] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");

  // Occupancy Grid
  const occupancyRef = useRef<Map<string, number>>(new Map());

  // Monitor Log System
  const logEntriesRef = useRef<LogEntry[]>([
    { time: new Date().toLocaleTimeString("id-ID", { hour12: false }), msg: "Monitor log aktif", type: "info" }
  ]);
  const [showLog, setShowLog] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [nyataOpen, setNyataOpen] = useState(true);
  const [logTick, setLogTick] = useState(0);
  const logEvent = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    const now = new Date();
    const time = now.toLocaleTimeString("id-ID", { hour12: false });
    logEntriesRef.current.push({ time, msg, type });
    if (logEntriesRef.current.length > MAX_LOG) logEntriesRef.current = logEntriesRef.current.slice(-MAX_LOG);
    setLogTick(t => t + 1);
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const [espConnected, setEspConnected] = useState(false);
  const [espIp, setEspIp] = useState(() => typeof window !== "undefined" ? localStorage.getItem("kei_esp_ip") || "" : "");
  const saveEspIp = useCallback((ip: string) => {
    setEspIp(ip);
    localStorage.setItem("kei_esp_ip", ip);
  }, []);
  const telemetryRef = useRef<any>(null);
  const [telemetryTick, setTelemetryTick] = useState(0);
  const [servoAngle, setServoAngle] = useState(90);
  const servoRef = useRef(90);
  const telemetryYawRef = useRef(0);
  const sendServo = useCallback((deg: number) => {
    const prev = servoRef.current;
    const a = Math.round(Math.max(0, Math.min(180, deg)));
    if (a === prev) return; // skip kalo sama
    setServoAngle(a);
    servoRef.current = a;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ servo: 180 - a }));
    }
  }, [logEvent]);

  // Servo sweep history
  const servoHistoryRef = useRef<ServoRead[]>([]);

  const motorLogThrottleRef = useRef(0);
  const setMotors = useCallback((l: number, r: number) => {
    const prevL = leftMotorRef.current;
    const prevR = rightMotorRef.current;
    const clampMin = (v: number) => v === 0 ? 0 : Math.round(v > 0 ? Math.max(80, v) : Math.min(-80, v));
    l = clampMin(l);
    r = clampMin(r);
    leftMotorRef.current = l;
    rightMotorRef.current = r;
    setLeftMotor(l);
    setRightMotor(r);
    if (l !== prevL || r !== prevR) {
      const now = Date.now();
      const isStop = (l === 0 && r === 0);
      const isStart = (prevL === 0 && prevR === 0 && (l !== 0 || r !== 0));
      if ((isStop || isStart) && now - motorLogThrottleRef.current > 500) {
        motorLogThrottleRef.current = now;
        logEvent(`Motor ${isStop ? "STOP" : `L=${l} R=${r}`}`, "motor");
      }
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const tl = Math.max(-255, Math.min(255, l - trimRef.current));
      const tr = Math.max(-255, Math.min(255, r + trimRef.current));
      wsRef.current.send(JSON.stringify({ leftMotor: tl, rightMotor: tr }));
    }
  }, [logEvent]);

  const sendLED = useCallback((mode: number) => {
    const cmd = mode === 1 ? { led_hazard: ledModeRef.current !== 1 }
      : { led_signal: ledModeRef.current === mode ? 'off' : (mode === 2 ? 'left' : 'right') };
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(cmd));
    ledModeRef.current = ledModeRef.current === mode ? 0 : mode;
    setLedMode(ledModeRef.current);
  }, []);

  const handleJoyMove = useCallback((clientX: number, clientY: number) => {
    const el = joystickRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 10;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }

    const nxRaw = dx / maxR;
    const nyRaw = -dy / maxR;

    const applyDeadzone = (v: number) => {
      const abs = Math.abs(v);
      if (abs < JOY_DEADZONE) return 0;
      return (abs - JOY_DEADZONE) / (1 - JOY_DEADZONE) * (v > 0 ? 1 : -1);
    };
    const nx = applyDeadzone(nxRaw);
    const ny = applyDeadzone(nyRaw);

    const anyInput = Math.abs(nx) > 0.01 || Math.abs(ny) > 0.01;
    if (anyInput) setJoyPos({ x: dx, y: dy });
    else setJoyPos({ x: 0, y: 0 });

    let rawL = (ny + nx) * 255;
    let rawR = (ny - nx) * 255;
    const maxAbs = Math.max(Math.abs(rawL), Math.abs(rawR), 255);
    const sc = maxAbs > 255 ? 255 / maxAbs : 1;
    setMotors(Math.round(rawL * sc), Math.round(rawR * sc));
  }, [setMotors]);

  const handleJoyEnd = useCallback(() => {
    joyActiveRef.current = false;
    setMotors(0, 0);
    setJoyPos({ x: 0, y: 0 });
  }, [setMotors]);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const vw = rect.width;
    const vh = rect.height;
    const cx = vw / 2;
    const cy = vh / 2;
    const s = scaleRef.current;
    const p = posRef.current;
    return {
      x: (clientX - rect.left - cx) / s + p.x,
      y: (clientY - rect.top - cy) / s + p.y,
    };
  }, []);

  // WebSocket
  const connectESP = useCallback((ip: string) => {
    if (!ip) return;
    wsRef.current?.close();
    logEvent(`Hubung ESP32 ${ip}...`, "info");
    const ws = new WebSocket(`ws://${ip}:81/`);
    ws.onopen = () => { setEspConnected(true); logEvent("ESP32 tersambung!", "info"); };
    ws.onclose = () => { setEspConnected(false); logEvent("ESP32 putus", "warn"); };
    ws.onerror = () => { setEspConnected(false); logEvent("ESP32 error", "error"); };
    ws.onmessage = (e: MessageEvent) => {
      try {
        telemetryRef.current = JSON.parse(e.data as string);
        setTelemetryTick(t => t + 1);
      } catch {}
    };
    wsRef.current = ws;
  }, [logEvent]);

  const disconnectESP = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setEspConnected(false);
  }, []);

  const [discoveryStatus, setDiscoveryStatus] = useState("");
  const [isAPMode, setIsAPMode] = useState(false);

  const autoFindESP = useCallback(async () => {
    const probe = async (ip: string): Promise<string | null> => {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 2000);
        const r = await fetch(`http://${ip}/api/wifi/status`, { signal: c.signal });
        clearTimeout(t);
        if (r.ok) {
          const d = await r.json();
          if (d.ip) {
            if (d.mode === "ap") setIsAPMode(true);
            return d.ip;
          }
        }
      } catch {}
      // fallback: probe old /ping endpoint
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 1000);
        const r = await fetch(`http://${ip}/ping`, { signal: c.signal });
        clearTimeout(t);
        if (r.ok) return ip;
      } catch {}
      return null;
    };

    setDiscoveryStatus("mencari...");

    // 1. Coba kei.local
    let found = await probe("kei.local");
    if (found) {
      setDiscoveryStatus(`ditemukan: ${found}`);
      saveEspIp(found);
      setTimeout(() => connectESP(found), 50);
      return true;
    }

    // 2. Coba saved IP
    const saved = localStorage.getItem("kei_esp_ip");
    if (saved) {
      found = await probe(saved);
      if (found) {
        setDiscoveryStatus(`ditemukan: ${found}`);
        setTimeout(() => connectESP(found), 50);
        return true;
      }
    }

    // 3. Subnet cepat (common IPs)
    const commonIPs = ["192.168.42.129", "192.168.1.100", "192.168.0.100", "192.168.137.1", "10.0.2.1", "172.20.10.1"];
    for (const ip of commonIPs) {
      found = await probe(ip);
      if (found) {
        setDiscoveryStatus(`ditemukan: ${found}`);
        saveEspIp(found);
        setTimeout(() => connectESP(found), 50);
        return true;
      }
    }

    setDiscoveryStatus("tidak ditemukan. ESP di AP mode?");
    setIsAPMode(true);
    return false;
  }, [connectESP, saveEspIp, logEvent]);

  // Auto-retry saat disconnect
  const retryRef = useRef(0);
  useEffect(() => {
    if (espConnected || !espIp) return;
    const saved = localStorage.getItem("kei_esp_ip");
    if (!saved) return;
    const interval = setInterval(() => {
      retryRef.current++;
      if (retryRef.current > 10) { clearInterval(interval); return; }
      const ws = new WebSocket(`ws://${saved}:81/`);
      const t = setTimeout(() => { try { ws.close(); } catch {} }, 1500);
      ws.onopen = () => {
        clearTimeout(t);
        clearInterval(interval);
        connectESP(saved);
      };
      ws.onerror = () => { clearTimeout(t); try { ws.close(); } catch {} };
    }, 3000);
    return () => clearInterval(interval);
  }, [espConnected, espIp, connectESP]);

  // Evolution
  const runEvolution = useCallback(() => {
    if (evoEngineRef.current?.running) return;
    const obstacles = PRESETS[evoPreset] ?? PRESETS.LABIRIN;
    const engine = evoEngineRef.current ?? new EvolutionEngine();
    if (!evoEngineRef.current) {
      engine.createPopulation();
      evoEngineRef.current = engine;
    }
    engine.running = true;
    engine.goalX = 0;
    engine.goalY = 350;

    const totalGens = 200;
    let gen = engine.generation;
    const stepGen = () => {
      if (!engine.running || gen >= totalGens) {
        engine.running = false;
        if (engine.bestGenome) {
          deployGenomeRef.current = engine.bestGenome;
          const deployBrain = new Brain(LAYERS);
          deployBrain.fromGenome(engine.bestGenome);
          deployBrainRef.current = deployBrain;
        }
        setEvoStats(s => ({ ...s, running: false }));
        logEvent(`Evolusi selesai gen ${engine.generation} best=${engine.bestFitness.toFixed(0)}`, "nav");
        return;
      }
      const t0 = performance.now();
      const result = engine.runGeneration(obstacles);
      const elapsed = performance.now() - t0;
      gen = engine.generation;
      const progress = Math.min(gen / totalGens, 1);
      evoProgressRef.current = progress;
      setEvoProgress(progress);
      setEvoStats({
        gen: engine.generation,
        best: result.bestFitness,
        avg: result.avgFitness,
        bestFitness: engine.bestFitness,
        running: true,
      });
      if (engine.bestGenome) {
        deployGenomeRef.current = engine.bestGenome;
        const deployBrain = new Brain(LAYERS);
        deployBrain.fromGenome(engine.bestGenome);
        deployBrainRef.current = deployBrain;
      }
      const delay = Math.max(1, 20 - elapsed);
      setTimeout(stepGen, delay);
    };
    stepGen();
  }, [evoPreset, logEvent]);

  const stopEvolution = useCallback(() => {
    if (evoEngineRef.current) evoEngineRef.current.running = false;
    setEvoStats(s => ({ ...s, running: false }));
  }, []);

  // Physics tick
  const tick = useCallback(() => {
    const p = posRef.current;
    const h = headingRef.current;

    const tele = telemetryRef.current;
    const dRaw = (tele?.distance != null && tele.distance >= 0) ? tele.distance / 10 : -1;
    const prevD = distanceRef.current;
    const d = (dRaw > 0 && prevD > 0 && Math.abs(dRaw - prevD) > 100) ? prevD : Math.min(dRaw, MAX_SENSE);
    distanceRef.current = d;
    if (d > 0) setSensorDist(`${d.toFixed(0)}cm`);
    gyroRef.current = (tele?.gyroZ ?? 0) * 0.002;

    telemetryYawRef.current = tele?.yaw ?? 0;
    const y = tele?.yaw;
    if (y != null) headingRef.current = -y * Math.PI / 180;
    if (tele?.led_mode != null && tele.led_mode !== ledModeRef.current) {
      ledModeRef.current = tele.led_mode;
      setLedMode(tele.led_mode);
    }
    if (tele?.led != null && tele.led !== ledMask) setLedMask(tele.led);
    if (tele?.buzzer_vol != null && tele.buzzer_vol !== buzzerVol) setBuzzerVol(tele.buzzer_vol);

    const dots = scanDotsRef.current;
    const gyroMag = Math.abs(tele?.gyroZ ?? 0);
    const motorMoving = leftMotorRef.current !== 0 || rightMotorRef.current !== 0;
    const scanFrameCount = scanFrameCountRef.current;
    scanFrameCountRef.current = scanFrameCount + 1;
    if (dots.length > 500) {
      scanDotsRef.current = dots.slice(-300);
    }
    if (d > 0 && gyroMag < 15 && !motorMoving && scanFrameCount % 3 === 0) {
      const sa = servoRef.current;
      const servoRad = ((sa - 90) / SERVO_SCALE) * (Math.PI / 180);
      const hdg = headingRef.current + servoRad;
      const hitX = p.x + Math.sin(hdg) * (ROBOT_R + d);
      const hitY = p.y - Math.cos(hdg) * (ROBOT_R + d);
      const cur = scanDotsRef.current;
      let found = false;
      for (let i = 0; i < cur.length; i++) {
        if (Math.hypot(cur[i].x - hitX, cur[i].y - hitY) < 40) {
          cur[i].x = (cur[i].x + hitX) * 0.5;
          cur[i].y = (cur[i].y + hitY) * 0.5;
          found = true;
          break;
        }
      }
      if (!found) {
        cur.push({ x: hitX, y: hitY });
        if (cur.length > 500) cur.splice(0, 100);
      }
    }

    {
      const dt = 0.03;
      const speedFactor = 0.12;
      const l = Math.max(-255, Math.min(255, leftMotorRef.current - trimRef.current));
      const r = Math.max(-255, Math.min(255, rightMotorRef.current + trimRef.current));
      const avg = (l + r) / 2 * speedFactor;
      const ang = (r - l) / WHEEL_BASE * speedFactor;
      if (tele?.yaw == null) headingRef.current += ang * dt;
      velRef.current.x = Math.sin(headingRef.current) * avg;
      velRef.current.y = -Math.cos(headingRef.current) * avg;
      p.x += velRef.current.x * dt;
      p.y += velRef.current.y * dt;
    }

    if (dots.length > 20) {
      for (const dot of dots) {
        const gk = gridCellKey(dot.x, dot.y);
        if (occupancyRef.current.get(gk) !== 2) occupancyRef.current.set(gk, 2);
      }
      const rk = gridCellKey(p.x, p.y);
      if (!occupancyRef.current.has(rk)) occupancyRef.current.set(rk, 1);
      if (occupancyRef.current.size > 5000) {
        const arr = [...occupancyRef.current];
        occupancyRef.current = new Map(arr.slice(arr.length - 3000));
      }
    }

    // M3: Servo auto-sweep
    if (modul3ActiveRef.current && !sweepLockedRef.current) {
      sweepTickRef.current++;
      let sa = servoRef.current + sweepDirRef.current;
      if (sa >= 160) { sa = 160; sweepDirRef.current = -1; }
      if (sa <= 20) { sa = 20; sweepDirRef.current = 1; }
      sendServo(sa);
    }

    // Sector data
    {
      const s = servoRef.current;
      const currentDist = distanceRef.current;
      for (let i = 0; i < SECTORS.length; i++) {
        const sec = SECTORS[i];
        if (s >= sec.min && s <= sec.max) {
          const dist = currentDist > 0 ? currentDist : MAX_SENSE;
          sectorDataRef.current[i] = dist;
          setSectorData([...sectorDataRef.current]);
          break;
        }
      }
    }

    // M3: pilih sector terjauh (min 10cm)
    if (modul3ActiveRef.current && m3PhaseRef.current === "SWEEP" && !sweepLockedRef.current) {
      let best = -1, bestDist = -1;
      for (let i = 0; i < sectorDataRef.current.length; i++) {
        if (sectorDataRef.current[i] > bestDist) {
          bestDist = sectorDataRef.current[i];
          best = i;
        }
      }
      const ready = sweepTickRef.current > 300 && sectorDataRef.current.every(v => v >= 0);
      if (ready && best >= 0) {
        if (bestDist <= 30) {
          logEvent(`M3 buntu (${bestDist.toFixed(0)}cm), mundur`, "nav");
          sweepLockedRef.current = true;
          turnSpeedRef.current = 0;
          backTickRef.current = 0;
          m3PhaseRef.current = "BACK";
        } else {
          bestSectorRef.current = best;
          sweepLockedRef.current = true;
          sendServo(SECTORS[best].cx);
          logEvent(`M3 → ${SECTORS[best].id} (${bestDist.toFixed(0)}cm)`, "nav");
          turnTargetRadRef.current = headingRef.current + (SECTORS[best].cx - 90) * Math.PI / 180;
          turnSpeedRef.current = 0;
          turnStuckCountRef.current = 0;
          turnYawLogRef.current = [];
          turnTimeoutRef.current = 0;
          m3PhaseRef.current = "TURN";
        }
      }
    }

    // M3: TURN — putar gradual, timeout fallback kalo stall
    if (modul3ActiveRef.current && m3PhaseRef.current === "TURN" && !joyActiveRef.current && !keyActiveRef.current) {
      let diff = turnTargetRadRef.current - headingRef.current;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const degLeft = diff * 180 / Math.PI;
      if (Math.abs(degLeft) > 2.5) {
        turnTimeoutRef.current++;
        const log = turnYawLogRef.current;
        log.push(tele?.yaw ?? 0);
        if (log.length > 20) log.shift();
        const moving = log.length >= 20 && (log[log.length-1] - log[0]) > 0.5;
        if (turnSpeedRef.current > 0 && !moving && turnTimeoutRef.current > 50) {
          turnRampTickRef.current++;
          if (turnRampTickRef.current % 3 === 0) {
            turnSpeedRef.current = Math.min(turnSpeedRef.current + 1, 200);
          }
        } else {
          const targetSpeed = Math.min(Math.abs(degLeft) * 1.2 + 10, 130);
          if (turnSpeedRef.current < targetSpeed) {
            turnRampTickRef.current++;
            if (turnRampTickRef.current % 3 === 0) {
              turnSpeedRef.current = Math.min(turnSpeedRef.current + 1, targetSpeed);
            }
          } else if (turnSpeedRef.current > targetSpeed) {
            turnRampTickRef.current = 0;
            turnSpeedRef.current = Math.max(turnSpeedRef.current - 2, targetSpeed);
          }
        }
        const s = Math.round(turnSpeedRef.current);
        const l = degLeft > 0 ? s : -s;
        const r = degLeft > 0 ? -s : s;
        leftMotorRef.current = l;
        rightMotorRef.current = r;
        setLeftMotor(l);
        setRightMotor(r);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const tl = Math.max(-255, Math.min(255, l - trimRef.current));
          const tr = Math.max(-255, Math.min(255, r + trimRef.current));
          wsRef.current.send(JSON.stringify({ leftMotor: tl, rightMotor: tr }));
        }
      } else {
        setMotors(0, 0);
        turnSpeedRef.current = 0;
        sendServo(90);
        logEvent(`M3 heading OK ${(headingRef.current * 180 / Math.PI).toFixed(0)}°`, "nav");
        turnTimeoutRef.current = 0;
        if (turnIsUturnRef.current) {
          turnIsUturnRef.current = false;
          sweepLockedRef.current = false;
          bestSectorRef.current = -1;
          prevBestSectorRef.current = -1;
          sweepTickRef.current = 0;
          sweepDirRef.current = 1;
          sectorDataRef.current = SECTORS.map(() => -1);
          setSectorData([...sectorDataRef.current]);
          logEvent(`M3 uturn ok, sweep ulang`, "nav");
          m3PhaseRef.current = "SWEEP";
        } else {
          driveTargetHeadingRef.current = headingRef.current;
          m3PhaseRef.current = "DRIVE";
        }
      }
    }

    // M3: DRIVE — maju perlahan, stop di 35cm (biar ada waktu ngerem)
    if (modul3ActiveRef.current && m3PhaseRef.current === "DRIVE" && !joyActiveRef.current && !keyActiveRef.current) {
      const d = distanceRef.current;
      turnTimeoutRef.current++;
      if (d > 0 && d <= 35) {
        setMotors(0, 0);
        turnSpeedRef.current = 0;
        sweepLockedRef.current = false;
        bestSectorRef.current = -1;
        prevBestSectorRef.current = -1;
        sweepTickRef.current = 0;
        sweepDirRef.current = 1;
        sectorDataRef.current = SECTORS.map(() => -1);
        setSectorData([...sectorDataRef.current]);
        logEvent(`M3 stop ${d.toFixed(0)}cm, loop`, "nav");
        m3PhaseRef.current = "SWEEP";
      } else {
        const stalled = turnTimeoutRef.current > 600 && turnSpeedRef.current > 60;
        if (stalled) {
          logEvent(`M3 maju mentok, mundur`, "nav");
          setMotors(0, 0);
          turnSpeedRef.current = 0;
          backTickRef.current = 0;
          m3PhaseRef.current = "BACK";
        } else {
          const targetSpeed = d > 0 && d < 60 ? 35 : 60;
          if (turnTimeoutRef.current > 100) {
            turnRampTickRef.current++;
            if (turnRampTickRef.current % 3 === 0) {
              turnSpeedRef.current = Math.min(turnSpeedRef.current + 1, 120);
            }
          } else if (turnSpeedRef.current < targetSpeed) {
            turnRampTickRef.current++;
            if (turnRampTickRef.current % 3 === 0) {
              turnSpeedRef.current = Math.min(turnSpeedRef.current + 1, targetSpeed);
            }
          } else if (turnSpeedRef.current > targetSpeed) {
            turnRampTickRef.current = 0;
            turnSpeedRef.current = Math.max(turnSpeedRef.current - 1, targetSpeed);
          }
          const s = Math.round(turnSpeedRef.current);
          let headingErr = headingRef.current - driveTargetHeadingRef.current;
          while (headingErr > Math.PI) headingErr -= 2 * Math.PI;
          while (headingErr < -Math.PI) headingErr += 2 * Math.PI;
          const correction = Math.round(headingErr * 180 / Math.PI * 1.2);
          const clamped = Math.max(-40, Math.min(40, correction));
          const lm = Math.max(-255, Math.min(255, s - trimRef.current - clamped));
          const rm = Math.max(-255, Math.min(255, s + trimRef.current + clamped));
          leftMotorRef.current = lm;
          rightMotorRef.current = rm;
          setLeftMotor(lm);
          setRightMotor(rm);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ leftMotor: lm, rightMotor: rm }));
          }
        }
      }
    }

    // M3: BACK — mundur dulu kalo buntu
    if (modul3ActiveRef.current && m3PhaseRef.current === "BACK" && !joyActiveRef.current && !keyActiveRef.current) {
      backTickRef.current++;
      const speed = Math.min(Math.floor(backTickRef.current / 2) + 60, 150);
      const s = Math.round(speed);
      leftMotorRef.current = -s;
      rightMotorRef.current = -s;
      setLeftMotor(-s);
      setRightMotor(-s);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const tl = Math.max(-255, Math.min(255, -s - trimRef.current));
        const tr = Math.max(-255, Math.min(255, -s + trimRef.current));
        wsRef.current.send(JSON.stringify({ leftMotor: tl, rightMotor: tr }));
      }
      if (backTickRef.current > 80) {
        setMotors(0, 0);
        turnSpeedRef.current = 0;
        turnTargetRadRef.current = headingRef.current + Math.PI;
        turnStuckCountRef.current = 0;
        turnYawLogRef.current = [];
        turnTimeoutRef.current = 0;
        backTickRef.current = 0;
        turnIsUturnRef.current = true;
        logEvent(`M3 putar balik`, "nav");
        m3PhaseRef.current = "TURN";
      }
    }

    // M7: Neural deploy — jalan kalo aktif, M3 mati, nggak manual
    if (modul7ActiveRef.current && evoBrainActiveRef.current && deployGenomeRef.current && deployBrainRef.current
        && !modul3ActiveRef.current && !joyActiveRef.current && !keyActiveRef.current) {
      const b = deployBrainRef.current;
      const sectors = sectorDataRef.current;
      const hdg = headingRef.current;
      const spd = (Math.abs(leftMotorRef.current) + Math.abs(rightMotorRef.current)) / 510 / 2;
      const dist = distanceRef.current;
      const inputs = [
        ...sectors.map(v => v >= 0 ? v / MAX_SENSE : 1),
        Math.sin(hdg),
        Math.cos(hdg),
        spd,
        dist > 0 && dist < 20 ? 1 : 0,
      ];
      const outputs = b.forward(inputs);
      const ml = Math.max(-255, Math.min(255, Math.round(outputs[0] * 255)));
      const mr = Math.max(-255, Math.min(255, Math.round(outputs[1] * 255)));
      if (ml !== leftMotorRef.current || mr !== rightMotorRef.current) {
        leftMotorRef.current = ml;
        rightMotorRef.current = mr;
        setLeftMotor(ml);
        setRightMotor(mr);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ leftMotor: ml - trimRef.current, rightMotor: mr + trimRef.current }));
        }
      }
    }

    const d_now = distanceRef.current;
    let l = leftMotorRef.current;
    let r = rightMotorRef.current;

    // Virtual Buzzer
    if (d_now > 0 && d_now <= 50) {
      const now = Date.now();
      if (now - lastBuzzerRef.current > 200) {
        setBuzzerActive(p => !p);
        lastBuzzerRef.current = now;
      }
    } else setBuzzerActive(false);

  }, [logEvent, sendServo, setMotors]);

  // Draw — simplified, delegates to renderer
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const st: DrawState = {
      vw: rect.width,
      vh: rect.height,
      pos: posRef.current,
      heading: headingRef.current,
      scale: scaleRef.current,
      sensorDistance: distanceRef.current,
      servoAngle: servoRef.current,
      scanDots: scanDotsRef.current,
      vel: velRef.current,
    };
    drawScene(ctx, st);
  }, []);

  // Pointer handler (NYATA-only — no obstacle editor)
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
  }, []);
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
  }, []);
  const handlePointerUp = useCallback(() => {
  }, []);

  // Keyboard + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      scaleRef.current = Math.max(0.1, Math.min(10, scaleRef.current * (e.deltaY > 0 ? 0.9 : 1.1)));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    const keys = new Set<string>();
    const handleKeyDown = (e: KeyboardEvent) => {
      keys.add(e.key.toLowerCase());
      keyActiveRef.current = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) e.preventDefault();
      if (e.key.toLowerCase() === "q") sendServo(servoRef.current - 5);
      if (e.key.toLowerCase() === "e") sendServo(servoRef.current + 5);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      if (keys.size === 0) {
        keyActiveRef.current = false;
        if (!joyActiveRef.current) setMotors(0, 0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    let running = true;
    const loop = () => {
      if (!running) return;
      if (!joyActiveRef.current && telemetryRef.current && keyActiveRef.current) {
        let lm = 0, rm = 0;
        if (keys.has("w") || keys.has("arrowup")) { lm = 255; rm = 255; }
        if (keys.has("s") || keys.has("arrowdown")) { lm = -255; rm = -255; }
        if (keys.has("a") || keys.has("arrowleft")) { lm = -255; rm = 255; }
        if (keys.has("d") || keys.has("arrowright")) { lm = 255; rm = -255; }
        if (keys.has(" ")) { lm = 0; rm = 0; }
        setMotors(lm, rm);
      }
      tick();
      draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    return () => {
      running = false;
      canvas.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [tick, draw, setMotors, sendServo]);

  // Init pos
  useEffect(() => {
    posRef.current = { x: 0, y: 350 };
    headingRef.current = 0;
    lastSweepAngleRef.current = -1;
  }, []);

  // Sync joystick visual
  useEffect(() => {
    if (joyActiveRef.current) return;
    const el = joystickRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxR = rect.width / 2 - 10;
    if (maxR <= 0) return;
    const ny = (leftMotor + rightMotor) / 510;
    const nx = (leftMotor - rightMotor) / 510;
    setJoyPos({ x: nx * maxR, y: -ny * maxR });
  }, [leftMotor, rightMotor]);

  // Sync module refs
  useEffect(() => {
    if (!modul3Active) {
      sweepLockedRef.current = false;
      prevBestSectorRef.current = -1;
      bestSectorRef.current = -1;
      m3PhaseRef.current = "SWEEP";
      sweepTickRef.current = 0;
      turnSpeedRef.current = 0;
      turnIsUturnRef.current = false;
      setMotors(0, 0);
    }
    modul3ActiveRef.current = modul3Active;
  }, [modul3Active]);
  useEffect(() => { modul4ActiveRef.current = modul4Active; }, [modul4Active]);
  useEffect(() => { modul7ActiveRef.current = modul7Active; }, [modul7Active]);
  useEffect(() => { evoBrainActiveRef.current = evoBrainActive; }, [evoBrainActive]);
  useEffect(() => {
    const saved = localStorage.getItem("kei_groq_key");
    if (saved) { setGroqApiKey(saved); groqApiKeyRef.current = saved; }
  }, []);
  useEffect(() => { groqApiKeyRef.current = groqApiKey; }, [groqApiKey]);

  // M5: Camera + Vision AI
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [modelReady, setModelReady] = useState(false);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [detectionCount, setDetectionCount] = useState(0);
  const detectionsRef = useRef<Detection[]>([]);
  const faceDetectionsRef = useRef<Detection[]>([]);
  const [recognizedFace, setRecognizedFace] = useState("");
  const recognizedFaceRef = useRef<{ name: string } | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const detectTimerRef = useRef(0);
  const trackInfoRef = useRef("");
  const aiBusyRef = useRef(false);
  const trackingRef = useRef(false);
  const [tracking, setTracking] = useState(false);
  const motorRef = useRef<MotorRef>({
    sendMotor: (l: number, r: number) => { setMotors(l, r); },
    trackTarget: null,
    setTrackTarget: (t) => { motorRef.current.trackTarget = t; },
    aiMotor: null,
  });
  const [faceLock, setFaceLock] = useState(false);
  const faceLockRef = useRef(false);

  // Face recognition DB
  const faceDBRef = useRef<FaceRecord[]>([]);
  const [faceDBCount, setFaceDBCount] = useState(0);

  // M6: TTS
  const [ttsActive, setTtsActive] = useState(false);
  const ttsActiveRef = useRef(false);
  const ttsCtxRef = useRef<AudioContext | null>(null);
  const speakTTS = useCallback(async (text: string) => {
    if (!ttsActiveRef.current || !text) return;
    if (ttsCtxRef.current) return;
    try {
      const res = await fetch(`/api/tts?text=${encodeURIComponent(text)}`);
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const ctx = new AudioContext();
      ttsCtxRef.current = ctx;
      const audioBuf = await ctx.decodeAudioData(buf);
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ctx.destination);
      src.start();
      src.onended = () => { if (ttsCtxRef.current === ctx) { ctx.close(); ttsCtxRef.current = null; } };
    } catch {}
  }, []);
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const ttsAiSaran = (s: string) => pick([`Menurut AI ${s} aja`, `AI bilang ${s}`, `AI saran ${s}`, `${s} kata AI`]);

  // Camera webcam
  useEffect(() => {
    if (!camActive) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        streamRef.current?.getTracks().forEach(t => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch { setCamActive(false); }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };
  }, [camActive, facingMode]);

  // MediaPipe model loading
  useEffect(() => {
    if (!camActive) return;
    let cancelled = false;
    setModelLoading(true);
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks("/wasm");
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
        if (cancelled) return;
        detectorRef.current = det;
        faceDetectorRef.current = faceDet;
        setModelReady(true);
      } catch (e) {
        logEvent(`Model vision error: ${e}`, "error");
      } finally { setModelLoading(false); }
    })();
    return () => { cancelled = true; detectorRef.current?.close(); faceDetectorRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camActive]);

  // Detection overlay
  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.videoWidth < 1) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width = video.videoWidth;
    const h = canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, w, h);
    for (const d of detectionsRef.current) {
      const bb = d.boundingBox;
      if (!bb) continue;
      const isFace = d.categories[0]?.categoryName === "face";
      ctx.strokeStyle = isFace ? "#d946ef" : "#3b82f6";
      ctx.lineWidth = 2;
      ctx.strokeRect(bb.originX, bb.originY, bb.width, bb.height);
      ctx.fillStyle = isFace ? "#d946ef" : "#3b82f6";
      ctx.font = "bold 10px monospace";
      const label = isFace
        ? (recognizedFaceRef.current?.name || "wajah")
        : `${d.categories[0]?.categoryName || "?"} ${Math.round((d.categories[0]?.score || 0) * 100)}%`;
      ctx.fillText(label, bb.originX, bb.originY - 4);
    }
  }, []);

  // Detection loop
  useEffect(() => {
    if (!camActive || !modelReady) return;
    let running = true;
    const detect = async () => {
      if (!running) return;
      const video = videoRef.current;
      const det = detectorRef.current;
      const faceDet = faceDetectorRef.current;
      if (video && video.videoWidth > 0 && det && faceDet) {
        try {
          const [objects, faces] = await Promise.all([
            det.detect(video),
            faceDet.detect(video),
          ]);
          const all: Detection[] = [...(objects.detections || [])];
          for (const f of faces.detections || []) {
            all.push({ ...f, categories: [{ ...f.categories[0], categoryName: "face", score: 1 }] });
          }
          detectionsRef.current = all;
          setDetectionCount(all.length);
          let faceName = "";
          for (const f of faces.detections || []) {
            const kp = f.keypoints?.map(k => [k.x, k.y]).flat() || [];
            if (kp.length >= 12) {
              const rec = recognize(kp, faceDBRef.current);
              if (rec) faceName = rec.name;
            }
          }
          recognizedFaceRef.current = faceName ? { name: faceName } : null;
          if (faceName !== recognizedFace) setRecognizedFace(faceName);
          if (faceLockRef.current && faces.detections && faces.detections.length > 0) {
            const f = faces.detections[0];
            const fcx = (f.boundingBox?.originX || 0) + (f.boundingBox?.width || 320) / 2;
            const fbx = 320;
            const err = (fcx - fbx) / fbx;
            const base = 100;
            const steer = Math.round(err * 80);
            setMotors(base - steer, base + steer);
            trackInfoRef.current = faceName ? `🔒 ${faceName}` : "🔒 wajah";
          } else if (!faceLockRef.current && !trackInfoRef.current.startsWith("🤖")) {
            trackInfoRef.current = "";
          }
          drawOverlay();
        } catch {}
      }
      detectTimerRef.current = window.setTimeout(detect, 200);
    };
    detect();
    return () => { running = false; clearTimeout(detectTimerRef.current); };
  }, [camActive, modelReady, drawOverlay, recognizedFace]);

  // Load face DB
  useEffect(() => {
    (async () => {
      const db = await loadDB();
      faceDBRef.current = db;
      setFaceDBCount(db.length);
    })();
  }, []);

  useEffect(() => { ttsActiveRef.current = ttsActive; }, [ttsActive]);
  useEffect(() => { faceLockRef.current = faceLock; }, [faceLock]);
  useEffect(() => { trackingRef.current = tracking; }, [tracking]);

  // ═══════════════════════════════════════════════════════════════
  // JSX (unchanged from original — same markup)
  // ═══════════════════════════════════════════════════════════════
  return (
    <main className="fixed inset-0 bg-black select-none touch-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-default"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Toolbar */}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 flex gap-1.5">
        <button
          onClick={() => setModulesOpen(p => !p)}
          className={`px-2 py-1 rounded-full text-[10px] font-mono border active:scale-90 transition-colors ${
            modulesOpen
              ? "bg-cyan-600 border-cyan-500 text-white"
              : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
          }`}
        >
          MODUL
        </button>
        {modulesOpen && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 flex flex-col gap-1.5 min-w-[220px] bg-zinc-900/80 backdrop-blur-md px-3 py-2.5 rounded-xl border border-white/10 z-50">

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M3</span>
                <span className="text-[10px] font-mono text-zinc-300">AUTOPILOT</span>
              </div>
              <button
                onClick={() => { setModul3Active(p => !p); modul3ActiveRef.current = !modul3Active; }}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  modul3Active
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {modul3Active ? "ON" : "OFF"}
              </button>
            </div>
            {modul3Active && (
              <div className="pl-4 text-[9px] font-mono text-zinc-400">
                {m3PhaseRef.current === "SWEEP" && `sweep ${sweepTickRef.current}...`}
                {m3PhaseRef.current === "TURN" && `→ ${SECTORS[bestSectorRef.current]?.id} putar...`}
                {m3PhaseRef.current === "DRIVE" && `→ maju ${sensorDist}`}
                {m3PhaseRef.current === "BACK" && `← mundur`}
                {m3PhaseRef.current === "TURN" && turnIsUturnRef.current && `↻ putar balik`}
                {m3PhaseRef.current === "DONE" && `✓ ${SECTORS[bestSectorRef.current]?.id} (${sectorData[bestSectorRef.current]?.toFixed(0)}cm)`}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M4</span>
                <span className="text-[10px] font-mono text-zinc-300">AI GROQ</span>
              </div>
              <button
                onClick={() => { setModul4Active(p => !p); modul4ActiveRef.current = !modul4Active; }}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  modul4Active
                    ? "bg-violet-600 border-violet-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {modul4Active ? "ON" : "OFF"}
              </button>
            </div>
            {modul4Active && (
              <div className="pl-4 text-[9px] font-mono space-y-1">
                <div className="flex items-center gap-1.5">
                  <input value={groqApiKey} onChange={e => { setGroqApiKey(e.target.value); groqApiKeyRef.current = e.target.value; localStorage.setItem("kei_groq_key", e.target.value); }}
                    placeholder="Groq API key"
                    type="password"
                    className="flex-1 min-w-0 px-2 py-1 rounded bg-zinc-800 text-white text-[8px] font-mono placeholder-zinc-600 focus:outline-none border border-zinc-700" />
                  {groqApiKey && <div className="size-1.5 rounded-full bg-green-400 shrink-0" />}
                </div>
                <div>
                  <span className="text-violet-400">{aiStatus}</span>
                  {aiSuggestionRef.current >= 0 && (
                    <span className="text-zinc-600 ml-1">→{SECTORS[aiSuggestionRef.current].id} +{aiSuggestionWeightRef.current}</span>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M5</span>
                <span className="text-[10px] font-mono text-zinc-300">CAMERA</span>
              </div>
              <button
                onClick={() => setCamActive(p => !p)}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  camActive
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {camActive ? "ON" : "OFF"}
              </button>
            </div>
            {camActive && (
              <div className="pl-4 text-[9px] font-mono space-y-1">
                <div className="flex gap-1">
                  <button
                    onClick={() => setFacingMode(p => p === "user" ? "environment" : "user")}
                    className="px-1.5 py-0.5 rounded text-[7px] bg-zinc-800 text-zinc-400 border border-zinc-700"
                  >
                    {facingMode === "user" ? "SELFIE" : "DEPAN"}
                  </button>
                  <button
                    onClick={() => { setFaceLock(p => !p); faceLockRef.current = !faceLock; }}
                    className={`px-1.5 py-0.5 rounded text-[7px] border ${
                      faceLock ? "bg-rose-600 border-rose-500 text-white" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}
                  >
                    {faceLock ? "☠ IKUT" : "☠ LOCK"}
                  </button>
                  <button
                    onClick={() => setShowCamera(p => !p)}
                    className={`px-1.5 py-0.5 rounded text-[7px] border ${
                      showCamera ? "bg-cyan-600 border-cyan-500 text-white" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}
                  >
                    TAMPIL
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[7px]">
                  <span className={modelReady ? "text-emerald-400" : "text-zinc-600"}>
                    {modelLoading ? "memuat model..." : modelReady ? `${detectionCount} objek` : "mati"}
                  </span>
                  {recognizedFace && <span className="text-fuchsia-400">{recognizedFace}</span>}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M6</span>
                <span className="text-[10px] font-mono text-zinc-300">SUARA</span>
              </div>
              <button
                onClick={() => { setTtsActive(p => !p); ttsActiveRef.current = !ttsActive; }}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  ttsActive
                    ? "bg-amber-600 border-amber-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {ttsActive ? "ON" : "OFF"}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M7</span>
                <span className="text-[10px] font-mono text-zinc-300">NEURAL</span>
              </div>
              <button
                onClick={() => { setModul7Active(p => !p); modul7ActiveRef.current = !modul7Active; }}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  modul7Active
                    ? "bg-orange-600 border-orange-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {modul7Active ? "ON" : "OFF"}
              </button>
            </div>
            {modul7Active && (
              <div className="pl-4 text-[9px] font-mono space-y-1">
                <select value={evoPreset} onChange={e => setEvoPreset(e.target.value as keyof typeof PRESETS)}
                  className="w-full px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[8px] font-mono border border-zinc-700 outline-none"
                >
                  {evoPresets.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <div className="flex items-center gap-1 mt-1">
                  <button onClick={runEvolution} disabled={evoStats.running}
                    className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold border active:scale-90 ${
                      evoStats.running
                        ? "bg-zinc-700 border-zinc-600 text-zinc-500 cursor-not-allowed"
                        : "bg-orange-600 border-orange-500 text-white"
                    }`}
                  >
                    {evoStats.running ? "•••" : "EVOLVE"}
                  </button>
                  {evoStats.running && (
                    <button onClick={stopEvolution}
                      className="px-2 py-0.5 rounded text-[8px] font-mono font-bold border bg-red-900/50 border-red-800 text-red-400 active:scale-90"
                    >
                      STOP
                    </button>
                  )}
                  <button onClick={() => { setEvoBrainActive(p => !p); evoBrainActiveRef.current = !evoBrainActive; }}
                    className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold border active:scale-90 ${
                      evoBrainActive
                        ? "bg-emerald-600 border-emerald-500 text-white"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}
                  >
                    {evoBrainActive ? "PAKAI" : "MATI"}
                  </button>
                </div>
                <div className="text-[7px] space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-600">gen</span>
                    <span className="text-orange-300 w-10">{evoStats.gen}</span>
                    <span className="text-zinc-600">best</span>
                    <span className="text-emerald-400 w-10">{evoStats.best.toFixed(0)}</span>
                    <span className="text-zinc-600">avg</span>
                    <span className="text-zinc-400 w-10">{evoStats.avg.toFixed(0)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500 transition-all duration-200" style={{ width: `${evoProgress * 100}%` }} />
                  </div>
                  <div className="text-zinc-600 text-[6px]">
                    {deployGenomeRef.current ? `otak siap (best=${evoStats.bestFitness.toFixed(0)})` : "otak kosong"}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <button
          onClick={() => setShowLog(p => !p)}
          className={`px-2 py-1 rounded-full text-[10px] font-mono border active:scale-90 ${
            showLog
              ? "bg-violet-600 border-violet-500 text-white"
              : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
          }`}
        >
          MONITOR
        </button>
        {showLog && (
          <MonitorPanel
            logEntriesRef={logEntriesRef}
            logTick={logTick}
            setShowLog={setShowLog}
            navDebugRef={{
              posRef,
              headingRef,
              sectorDataRef,
              occupancyRef,
              modul4Active,
              camActive,
              ttsActive,
            }}
          />
        )}
        <button
          onClick={() => setShowVoice(p => !p)}
          className={`px-2 py-1 rounded-full text-[10px] font-mono border active:scale-90 ${
            showVoice
              ? "bg-emerald-600 border-emerald-500 text-white"
              : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
          }`}
        >
          VOICE
        </button>
        {showVoice && (
          <div className="fixed top-14 right-4 z-50">
            <VoiceGroq
              recognizedFaceRef={recognizedFaceRef}
              detectionsRef={detectionsRef as any}
              trackInfoRef={trackInfoRef}
              aiBusyRef={aiBusyRef}
              headingRef={headingRef}
              leftMotor={leftMotor}
              rightMotor={rightMotor}
              trackingRef={trackingRef}
              setTracking={setTracking}
              motorRef={motorRef}
            />
          </div>
        )}
      </div>

      {/* ESP Panel */}
      <div className="fixed top-3 left-3 flex flex-col gap-1.5 items-start">
        <div className="flex items-center gap-1">
          <span className="px-2 py-1 rounded-full text-[9px] font-mono font-bold bg-cyan-600 border border-cyan-500 text-white">
            NYATA
          </span>
          <button
            onClick={() => setNyataOpen(o => !o)}
            className="size-5 flex items-center justify-center rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-[9px] font-mono active:scale-90"
          >
            {nyataOpen ? "▲" : "▼"}
          </button>
        </div>
        {nyataOpen && (
          <div className="flex flex-col gap-1.5 bg-zinc-900/60 backdrop-blur-sm p-2 rounded-xl border border-white/10">
            <div className="flex gap-1">
              <input
                value={espIp}
                onChange={e => saveEspIp(e.target.value)}
                placeholder="kei.local / 192.168.x.x"
                className="w-28 px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-[8px] font-mono text-zinc-300 outline-none"
              />
              <button
                onClick={() => espConnected ? disconnectESP() : connectESP(espIp || "kei.local")}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border active:scale-90 ${
                  espConnected
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400"
                }`}
              >
                {espConnected ? "ON" : "HUBUNG"}
              </button>
              {!espConnected && (
                <button onClick={autoFindESP}
                  className="px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border bg-zinc-800 border-zinc-700 text-zinc-400 active:scale-90 hover:text-white"
                >
                  CARI
                </button>
              )}
            </div>
            {discoveryStatus && !espConnected && (
              <div className="text-[8px] font-mono text-zinc-600">{discoveryStatus}</div>
            )}
            {isAPMode && !espConnected && (
              <div className="text-[7px] font-mono text-amber-500/80 mt-1 leading-tight">
                ESP mode AP &mdash; Hubungkan HP ke WiFi <strong>KEI-XXXX</strong> (pw: 12345678),<br/>
                lalu buka <strong>http://192.168.4.1</strong> di browser
              </div>
            )}
            {espConnected && (
              <div className="flex flex-col gap-0.5 text-[7px] font-mono text-zinc-500">
                <span className="text-emerald-500">WS tersambung</span>
                {(() => {
                  const t = telemetryRef.current;
                  if (!t) return null;
                  return (
                    <>
                      <span>jarak: {t.distance > 0 ? `${(t.distance / 10).toFixed(0)}cm` : "—"}</span>
                      <span>gyro: {t.gyroZ?.toFixed(1) ?? "—"}°/s</span>
                      <span>arah: {t.yaw?.toFixed(0) ?? "—"}°</span>
                      <span>baterai: {t.battery ?? "—"}</span>
                      <span>RSSI: {t.rssi ?? "—"}dBm</span>
                    </>
                  );
                })()}
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-zinc-600">S:</span>
                  <input
                    type="range"
                    min="0"
                    max="180"
                    value={servoAngle}
                    onChange={e => sendServo(Number(e.target.value))}
                    className="w-16 h-1.5 accent-cyan-500 cursor-pointer"
                  />
                  <span className="text-cyan-400 w-5 text-center">{Math.round(90 + (servoAngle - 90) / SERVO_SCALE)}°</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-zinc-600">V:</span>
                  <input type="range" min="0" max="255" value={buzzerVol}
                    onChange={e => { const v = Number(e.target.value); setBuzzerVol(v); if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ buzzer_vol: v })); }}
                    className="w-16 h-1.5 accent-cyan-500 cursor-pointer" />
                  <span className="text-cyan-400 w-5 text-center">{buzzerVol}</span>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-0.5 mt-1 text-[7px] font-mono text-zinc-500">
              <div className="flex items-center gap-1">
                <span className="text-zinc-600">TRIM:</span>
                <input type="range" min="-100" max="100" step="1" value={trimVal}
                  onChange={e => setTrimVal(Number(e.target.value))}
                  className="w-16 h-1.5 accent-cyan-500 cursor-pointer" />
                <input type="number" min="-100" max="100" value={trimVal}
                  onChange={e => setTrimVal(Math.max(-100, Math.min(100, Number(e.target.value) || 0))) }
                  className="w-10 px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[8px] font-mono text-center outline-none" />
              </div>
            </div>
            <div className="flex gap-1 mt-1">
              {[
                { lbl: 'HAZARD', mode: 1 },
                { lbl: '◀ KIRI', mode: 2 },
                { lbl: 'KANAN ▶', mode: 3 },
              ].map(b => (
                <button key={b.mode} onClick={() => sendLED(b.mode)}
                  className={`px-1.5 py-0.5 rounded-md text-[7px] font-mono font-bold border active:scale-90 ${
                    ledMode === b.mode
                      ? 'bg-amber-600 border-amber-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                  }`}
                >
                  {b.lbl}
                </button>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              {[
                { lbl: '◀', idx: 0, color: 'bg-white' },
                { lbl: '▶', idx: 1, color: 'bg-white' },
                { lbl: '◀', idx: 2, color: 'bg-red-500' },
                { lbl: '▶', idx: 3, color: 'bg-red-500' },
              ].map(b => {
                const on = (ledMask >> b.idx) & 1;
                return (
                  <button key={b.idx} onClick={() => {
                    const arr = [0, 0, 0, 0];
                    for (let i = 0; i < 4; i++) arr[i] = i === b.idx ? (on ? 0 : 1) : ((ledMask >> i) & 1);
                    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ led: arr }));
                  }}
                    className={`size-4 rounded-sm border active:scale-90 ${on ? b.color + ' border-transparent' : 'bg-zinc-800 border-zinc-700'}`}
                  />
                );
              })}
            </div>
            <div className="flex gap-1 mt-1">
              {[
                { lbl: '♪ HBD', melody: 'birthday' },
                { lbl: '♪ START', melody: 'startup' },
                { lbl: '📯 KLAKSON', melody: 'klakson' },
              ].map(b => (
                <button key={b.melody} onClick={() => {
                  if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ buzzer: b.melody }));
                }}
                  className="px-1.5 py-0.5 rounded-md text-[7px] font-mono font-bold border bg-zinc-800 border-zinc-700 text-zinc-400 active:scale-90 hover:text-white"
                >
                  {b.lbl}
                </button>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              <input type="text" id="melodyInput" placeholder="262/200,294/400,330/800"
                className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[7px] font-mono outline-none placeholder-zinc-600"
              />
              <button onClick={() => {
                const el = document.getElementById('melodyInput') as HTMLInputElement;
                if (!el) return;
                const raw = el.value.trim();
                if (!raw) return;
                const parts = raw.split(',').map(s => s.trim());
                const arr: number[][] = [];
                for (const p of parts) {
                  const m = p.match(/^(\d+)\/(\d+)$/);
                  if (m) arr.push([parseInt(m[1]), parseInt(m[2])]);
                }
                if (arr.length && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ melody: arr }));
              }}
                className="px-1.5 py-0.5 rounded-md text-[7px] font-mono font-bold border bg-zinc-800 border-zinc-700 text-zinc-400 active:scale-90 hover:text-white"
              >
                ▶
              </button>
            </div>
            <div className="flex gap-1 mt-1">
              {['pelangi', 'bebek', 'balonku', 'kupu', 'burung', 'tahunbaru'].map(label => (
                <button key={label} onClick={() => {
                  const arr = KNOWN_MELODIES[label]?.(wsRef.current);
                  if (arr && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ melody: arr }));
                }}
                  className="px-1.5 py-0.5 rounded-md text-[6px] font-mono font-bold border bg-zinc-800 border-zinc-700 text-zinc-400 active:scale-90 hover:text-white"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              <input type="text" id="melodyPrompt" placeholder="AI: nada tahun baru..."
                className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[7px] font-mono outline-none placeholder-zinc-600"
              />
              <button id="melodyAiBtn" onClick={async () => {
                const btn = document.getElementById('melodyAiBtn') as HTMLButtonElement;
                const inp = document.getElementById('melodyPrompt') as HTMLInputElement;
                if (!btn || !inp) return;
                const prompt = inp.value.trim();
                if (!prompt || !groqApiKeyRef.current) return;
                btn.textContent = '...';
                btn.disabled = true;
                try {
                  const res = await fetch('/api/groq/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      messages: [{ role: 'user', content: prompt }],
                      apiKey: groqApiKeyRef.current,
                      systemPrompt: 'Kamu komposer melodi buzzer. Pake not dari range luas: 131(C3),147(D3),165(E3),175(F3),196(G3),220(A3),247(B3),262(C4),294(D4),330(E4),349(F4),392(G4),440(A4),494(B4),523(C5),587(D5),659(E5),698(F5),784(G5),880(A5),988(B5),1047(C6). Boleh pake not 0 (diam) 50-100ms. Mulai & akhir di 262(C4). Variasikan: naik-turun, lompat oktaf, tempo beda (dur 100-600). 12-20 not. Balas ONLY freq/dur pisah koma. Contoh: 262/300,440/300,523/200,659/200,784/400,659/200,523/200,440/300,262/500. Jangan tulis apapun selain itu.',
                    }),
                  });
                  if (!res.ok) throw Error('Gagal');
                  const reader = res.body?.getReader();
                  if (!reader) throw Error('No reader');
                  const dec = new TextDecoder();
                  let full = '';
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    full += dec.decode(value, { stream: true });
                  }
                  const lines = full.split('\n');
                  let melodyText = '';
                  for (const l of lines) {
                    if (!l.startsWith('data: ')) continue;
                    const d = l.slice(6).trim();
                    if (d === '[DONE]') continue;
                    try { melodyText += JSON.parse(d).choices?.[0]?.delta?.content || ''; } catch {}
                  }
                  const parts = melodyText.split(',').map(s => s.trim());
                  const arr: number[][] = [];
                  for (const p of parts) {
                    const m = p.match(/^(\d+)\/(\d+)$/);
                    if (m) arr.push([parseInt(m[1]), parseInt(m[2])]);
                  }
                  if (arr.length && wsRef.current?.readyState === WebSocket.OPEN) {
                    (document.getElementById('melodyInput') as HTMLInputElement).value = parts.filter(p => /^\d+\/\d+$/.test(p.trim())).join(',');
                    wsRef.current.send(JSON.stringify({ melody: arr }));
                  }
                } catch {}
                btn.textContent = '✨';
                btn.disabled = false;
              }}
                className="px-1.5 py-0.5 rounded-md text-[7px] font-mono font-bold border bg-zinc-800 border-zinc-700 text-zinc-400 active:scale-90 hover:text-white"
              >
                ✨
              </button>
            </div>
            <button onClick={() => { if (window.confirm('Restart ESP?')) wsRef.current?.send(JSON.stringify({ reboot: true })); }}
              className="w-full px-2 py-1 rounded-md text-[8px] font-mono font-bold border bg-red-900/50 border-red-800 text-red-400 active:scale-90 hover:bg-red-800/50 hover:text-red-300"
            >
              ⟳ RESTART
            </button>
          </div>
        )}
      </div>

      {/* Camera panel */}
      {showCamera && camActive && (
        <div className="fixed bottom-6 right-4 z-40 w-[240px] h-[180px] rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-zinc-900">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          <canvas ref={overlayRef} className="absolute inset-0 w-full h-full" />
          <div className="absolute top-1 left-1 flex gap-1">
            <span className={`px-1 py-0.5 rounded text-[6px] font-mono ${modelReady ? "bg-emerald-600/80 text-white" : "bg-zinc-800/80 text-zinc-500"}`}>
              {modelReady ? "AI" : "..."}
            </span>
            {recognizedFace && (
              <span className="px-1 py-0.5 rounded text-[6px] font-mono bg-fuchsia-600/80 text-white">{recognizedFace}</span>
            )}
          </div>
        </div>
      )}

      {/* Joystick */}
      <div
        ref={joystickRef}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 size-36 rounded-full bg-zinc-900/80 backdrop-blur-md border border-white/10 touch-none select-none"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          joyActiveRef.current = true;
          handleJoyMove(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (joyActiveRef.current) handleJoyMove(e.clientX, e.clientY);
        }}
        onPointerUp={handleJoyEnd}
        onPointerCancel={handleJoyEnd}
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="size-2 rounded-full bg-zinc-700" />
        </div>
        <div
          className="absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 backdrop-blur-md border border-white/20 pointer-events-none"
          style={{ left: `calc(50% + ${joyPos.x}px)`, top: `calc(50% + ${joyPos.y}px)` }}
        />
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-2 text-[9px] font-mono pointer-events-none whitespace-nowrap">
          <span className="text-blue-400">L:{leftMotor}</span>
          <span className="text-orange-400">R:{rightMotor}</span>
        </div>
      </div>
    </main>
  );
}
