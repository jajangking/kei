"use client";

import { useRef, useEffect, useCallback, useState } from "react";

import type { LogEntry, ServoRead, ModuleCtx } from "./types";
import { ROBOT_R, TRAIL_LEN, MAX_SENSE, MAX_LOG, SECTORS, SERVO_SCALE, WHEEL_BASE, PRESETS } from "./constants";
import { gridCellKey } from "./utils";
import { drawScene, type DrawState } from "./renderer";
import MonitorPanel from "./monitor-panel";
import { m8Tick, m8Safety, createM8State, type M8State } from "./m8-reactive";
import { m9Tick, createM9State, type M9State } from "./m9-groq";

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


  // M8: Reactive Vector
  const [modul8Active, setModul8Active] = useState(false);
  const modul8ActiveRef = useRef(false);
  const m8Ref = useRef<M8State>(createM8State());

  // M9: Groq AI Navigator
  const [modul9Active, setModul9Active] = useState(false);
  const modul9ActiveRef = useRef(false);
  const m9Ref = useRef<M9State>(createM9State());
  const [m9TickN, setM9TickN] = useState(0);


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
    setMotors(l, r);
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
  const [manualIP, setManualIP] = useState("");

  const scanSubnetFull = useCallback(async (subnet: string): Promise<string | null> => {
    const ips: string[] = [];
    for (let i = 1; i <= 254; i++) ips.push(`${subnet}.${i}`);

    const BATCH = 30;
    const TIMEOUT = 400;

    for (let i = 0; i < ips.length; i += BATCH) {
      if (i > 0) setDiscoveryStatus(`scan ${subnet}.x... ${Math.round(i/254*100)}%`);
      const batch = ips.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(ip =>
        Promise.race([
          fetch(`http://${ip}/api/wifi/status`, { signal: AbortSignal.timeout(TIMEOUT) })
            .then(async r => r.ok ? { ip, d: await r.json() } : null)
            .catch(() => null),
          fetch(`http://${ip}/ping`, { signal: AbortSignal.timeout(TIMEOUT) })
            .then(r => r.ok ? { ip, d: { ip } } : null)
            .catch(() => null),
        ])
      ));
      const found = results.find(r => r);
      if (found) {
        if (found.d.mode === "ap") setIsAPMode(true);
        return found.ip;
      }
    }
    return null;
  }, []);

  const autoFindESP = useCallback(async () => {
    const probe = async (ip: string, ms = 1500): Promise<{ ip: string; mode?: string } | null> => {
      try {
        const r = await fetch(`http://${ip}/api/wifi/status`, { signal: AbortSignal.timeout(ms) });
        if (r.ok) {
          const d = await r.json();
          if (d.ip) return { ip: d.ip, mode: d.mode };
        }
      } catch {}
      try {
        const r = await fetch(`http://${ip}/ping`, { signal: AbortSignal.timeout(ms) });
        if (r.ok) return { ip };
      } catch {}
      return null;
    };

    setDiscoveryStatus("mencari...");

    // 1. kei.local
    let found = await probe("kei.local", 1000);
    if (found) {
      setDiscoveryStatus(`ditemukan: ${found.ip}`);
      saveEspIp(found.ip);
      setTimeout(() => connectESP(found.ip), 50);
      return true;
    }

    // 2. saved IP
    const saved = localStorage.getItem("kei_esp_ip");
    if (saved) {
      found = await probe(saved, 1000);
      if (found) {
        setDiscoveryStatus(`ditemukan: ${found.ip}`);
        setTimeout(() => connectESP(found.ip), 50);
        return true;
      }
    }

    // 3. Full subnet scan (concurrent, 3 subnet hotspot)
    const hotSubnets = ["192.168.43", "192.168.42", "192.168.0"];
    for (const sn of hotSubnets) {
      found = { ip: sn + ".1" };
      const gate = await probe(found.ip, 300);
      if (gate) {
        const r = await scanSubnetFull(sn);
        if (r) {
          setDiscoveryStatus(`ditemukan: ${r}`);
          saveEspIp(r);
          setTimeout(() => connectESP(r), 50);
          return true;
        }
      }
    }

    // 4. common single IPs
    const singles = ["192.168.1.100", "192.168.137.1", "10.0.2.1", "172.20.10.1", "192.168.43.100"];
    for (const ip of singles) {
      found = await probe(ip, 500);
      if (found) {
        setDiscoveryStatus(`ditemukan: ${found.ip}`);
        saveEspIp(found.ip);
        setTimeout(() => connectESP(found.ip), 50);
        return true;
      }
    }

    setDiscoveryStatus("tidak ditemukan. Coba ketik manual IP ESP:");
    setIsAPMode(true);
    return false;
  }, [connectESP, saveEspIp, logEvent, scanSubnetFull]);

  const handleManualConnect = useCallback(() => {
    const ip = manualIP.trim();
    if (!ip) return;
    saveEspIp(ip);
    connectESP(ip);
  }, [manualIP, saveEspIp, connectESP]);

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


    // === M8/M9 tick ===
    const mCtx: ModuleCtx = {
      sectorDataRef, distanceRef, headingRef, gyroRef, posRef, servoRef,
      leftMotorRef, rightMotorRef, trimRef, sendServo, setMotors, wsRef,
      joyActiveRef, keyActiveRef, logEvent,
    };
    if (modul8ActiveRef.current && !modul3ActiveRef.current) {
      m8Tick(mCtx, m8Ref.current);
    }
    if (modul9ActiveRef.current && !modul3ActiveRef.current) {
      m9Tick(mCtx, m9Ref.current);
    }
    // Safety clamp — selalu jalan kalau M8 aktif
    if (modul8ActiveRef.current && !modul3ActiveRef.current) {
      m8Safety(mCtx);
    }

    // === Auto-sweep (M3) — skip kalau M8 aktif ===
    if (modul3ActiveRef.current && !modul8ActiveRef.current && !sweepLockedRef.current && !joyActiveRef.current && !keyActiveRef.current) {
      sweepTickRef.current++;
      let sa = servoRef.current + sweepDirRef.current;
      if (sa >= 160) { sa = 160; sweepDirRef.current = -1; }
      if (sa <= 20) { sa = 20; sweepDirRef.current = 1; }
      sendServo(sa);
    }
    // Auto-sweep untuk M8: jalan kalau M8 IDLE, skip kalau M8 TURN/BACK
    if (modul8ActiveRef.current && !modul3ActiveRef.current && m8Ref.current.phaseRef.current === "IDLE" && !joyActiveRef.current && !keyActiveRef.current) {
      let sa = servoRef.current + sweepDirRef.current;
      if (sa >= 160) { sa = 160; sweepDirRef.current = -1; }
      if (sa <= 20) { sa = 20; sweepDirRef.current = 1; }
      sendServo(sa);
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
    const maxR = maxRRef.current;
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
  useEffect(() => {
    modul8ActiveRef.current = modul8Active;
    if (!modul8Active) {
      m8Ref.current.phaseRef.current = "IDLE";
      m8Ref.current.tickRef.current = 0;
      m8Ref.current.bestSectorRef.current = -1;
      m8Ref.current.targetHeadingRef.current = 0;
      setMotors(0, 0);
      sendServo(90);
    }
  }, [modul8Active, sendServo, setMotors]);
  useEffect(() => {
    modul9ActiveRef.current = modul9Active;
    if (!modul9Active) {
      m9Ref.current.lastReplyRef.current = "";
      m9Ref.current.contextRef.current = "";
      setM9TickN(t => t + 1);
    }
  }, [modul9Active]);

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
                <span className="text-[8px] font-mono text-zinc-500">M8</span>
                <span className="text-[10px] font-mono text-zinc-300">REACTIF</span>
              </div>
              <button
                onClick={() => { setModul8Active(p => !p); modul8ActiveRef.current = !modul8Active; }}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  modul8Active
                    ? "bg-cyan-600 border-cyan-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {modul8Active ? "ON" : "OFF"}
              </button>
            </div>
            {modul8Active && !espConnected && (
              <div className="pl-4 text-[7px] font-mono text-zinc-500">hubungkan ESP dulu</div>
            )}
            {modul8Active && espConnected && (
              <div className="pl-4 text-[9px] font-mono text-zinc-400">
                {m8Ref.current.phaseRef.current === "IDLE" && (
                  <span className="text-green-400">jalan {sensorDist}</span>
                )}
                {m8Ref.current.phaseRef.current === "TURN" && (
                  <span className="text-orange-400">putar → S{(m8Ref.current.bestSectorRef.current ?? -1) + 1}</span>
                )}
                {m8Ref.current.phaseRef.current === "BACK" && (
                  <span className="text-yellow-400">mundur...</span>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M9</span>
                <span className="text-[10px] font-mono text-zinc-300">GROQ AI</span>
              </div>
              <button
                onClick={() => { setModul9Active(p => !p); modul9ActiveRef.current = !modul9Active; }}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  modul9Active
                    ? "bg-violet-600 border-violet-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {modul9Active ? "ON" : "OFF"}
              </button>
            </div>
            {modul9Active && (
              <div className="pl-4 text-[9px] font-mono text-zinc-400 space-y-1">
                {!localStorage.getItem("kei_groq_key") ? (
                  <span className="text-yellow-400">set Groq API key dulu</span>
                ) : (
                  <>
                    {m9Ref.current.contextRef.current && (
                      <div className="text-zinc-500 whitespace-pre-wrap leading-tight">{m9Ref.current.contextRef.current}</div>
                    )}
                    <div>
                      {m9Ref.current.busyRef.current ? (
                        <span className="text-violet-400">thinking...</span>
                      ) : m9Ref.current.lastReplyRef.current ? (
                        <span className="text-violet-300">{m9Ref.current.lastReplyRef.current}</span>
                      ) : (
                        <span className="text-zinc-500">menunggu scan...</span>
                      )}
                    </div>
                  </>
                )}
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
              lalu buka <strong>http://192.168.4.1</strong> di browser untuk cek IP STA
              </div>
            )}
            {!espConnected && (
              <div className="flex gap-1 mt-1">
                <input
                  className="w-24 bg-zinc-800 border border-zinc-700 rounded text-[9px] px-1.5 py-0.5 text-zinc-300 font-mono outline-none focus:border-amber-500"
                  placeholder="IP manual"
                  value={manualIP}
                  onChange={e => setManualIP(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleManualConnect()}
                />
                <button
                  onClick={handleManualConnect}
                  className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-zinc-800 border border-zinc-700 text-zinc-400 active:scale-90 hover:text-white disabled:opacity-40"
                  disabled={!manualIP.trim()}
                >
                  SET
                </button>
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
                if (!prompt) return;
                btn.textContent = '...';
                btn.disabled = true;
                try {
                  const res = await fetch('/api/groq/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      messages: [{ role: 'user', content: prompt }],
                      apiKey: localStorage.getItem("kei_groq_key") || "",
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
