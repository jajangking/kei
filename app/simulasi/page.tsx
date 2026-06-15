"use client";

import { useRef, useEffect, useCallback, useState } from "react";

const GRID_STEP = 50;
const TRAIL_LEN = 40;
const MAX_SENSE = 400;
const LIDAR_FOV = 7 * Math.PI / 180; // VL53L0X narrow beam ~14° total

// Robot chassis 2WD (mm → 1 unit = 1cm roughly)
const ROBOT_W = 22;
const ROBOT_H = 16;
const ROBOT_R = 13;
const WHEEL_BASE = 14;

const SECTORS = [
  { id: "S1",  min: 20,  max: 30,  cx: 25 },
  { id: "S2",  min: 31,  max: 40,  cx: 35 },
  { id: "S3",  min: 41,  max: 50,  cx: 45 },
  { id: "S4",  min: 51,  max: 60,  cx: 55 },
  { id: "S5",  min: 61,  max: 70,  cx: 65 },
  { id: "S6",  min: 71,  max: 80,  cx: 75 },
  { id: "S7",  min: 81,  max: 90,  cx: 85 },
  { id: "S8",  min: 91,  max: 100, cx: 95 },
  { id: "S9",  min: 101, max: 110, cx: 105 },
  { id: "S10", min: 111, max: 120, cx: 115 },
  { id: "S11", min: 121, max: 130, cx: 125 },
  { id: "S12", min: 131, max: 140, cx: 135 },
  { id: "S13", min: 141, max: 150, cx: 145 },
  { id: "S14", min: 151, max: 160, cx: 155 },
];

const PRESETS: Record<string, Obstacle[]> = {
  DINDING: [
    { x: -200, y: 250, w: 400, h: 50 },
    { x: -200, y: 100, w: 50, h: 150 },
    { x: 150, y: 100, w: 50, h: 150 },
  ],
  LABIRIN: [
    // Outer Border (800x700 arena)
    { x: -400, y: 0, w: 30, h: 700 },      // Left wall
    { x: 370, y: 0, w: 30, h: 700 },       // Right wall
    { x: -400, y: 0, w: 800, h: 30 },      // Bottom wall
    { x: -400, y: 670, w: 800, h: 30 },    // Top wall

    // Vertical corridors (width ~80-100 for robot passage)
    { x: -250, y: 100, w: 30, h: 200 },    // Left column
    { x: -100, y: 200, w: 30, h: 250 },    // Center-left column
    { x: 50, y: 100, w: 30, h: 200 },      // Center column
    { x: 200, y: 200, w: 30, h: 250 },     // Right column

    // Horizontal corridors
    { x: -300, y: 150, w: 200, h: 30 },    // Upper-left horizontal
    { x: -50, y: 150, w: 200, h: 30 },     // Upper-right horizontal
    { x: -350, y: 300, w: 250, h: 30 },    // Mid-left horizontal
    { x: 80, y: 350, w: 200, h: 30 },      // Mid-right horizontal
    { x: -250, y: 500, w: 200, h: 30 },    // Lower-left horizontal
    { x: 100, y: 550, w: 150, h: 30 },     // Lower-right horizontal

    // Dead-end chambers
    { x: -320, y: 400, w: 30, h: 150 },    // Left chamber wall
    { x: 280, y: 100, w: 30, h: 150 },     // Right chamber wall

    // Central obstacles (target areas)
    { x: -50, y: 400, w: 60, h: 60 },      // Central obstacle 1
    { x: 100, y: 480, w: 50, h: 50 },      // Central obstacle 2
  ],
  RINTANGAN: [
    { x: 100, y: 80, w: 60, h: 60 },
    { x: -120, y: 120, w: 50, h: 50 },
    { x: 50, y: 200, w: 50, h: 80 },
    { x: -80, y: 280, w: 80, h: 60 },
    { x: 160, y: 180, w: 40, h: 40 },
    { x: -180, y: 50, w: 50, h: 50 },
    { x: -40, y: -50, w: 60, h: 60 },
    { x: 30, y: 360, w: 100, h: 50 },
    { x: -200, y: 200, w: 50, h: 50 },
    { x: 150, y: 350, w: 50, h: 50 },
    { x: -50, y: 150, w: 40, h: 40 },
    { x: 200, y: 250, w: 50, h: 50 },
  ],
  BUNTU: [
    { x: -250, y: -50, w: 50, h: 450 },
    { x: 250, y: -50, w: 50, h: 450 },
    { x: -250, y: 350, w: 500, h: 50 },
    { x: -100, y: 150, w: 50, h: 200 },
    { x: 100, y: 200, w: 50, h: 150 },
  ],
  SLALOM: [
    { x: -50, y: 80, w: 300, h: 50 },
    { x: -280, y: 180, w: 300, h: 50 },
    { x: -50, y: 280, w: 320, h: 50 },
    { x: -300, y: 380, w: 300, h: 50 },
    { x: -50, y: 480, w: 350, h: 50 },
  ],
  HUTAN: Array.from({ length: 30 }, (_, i) => ({
    x: Math.round((Math.random() - 0.5) * 700),
    y: Math.round(Math.random() * 500 + 30),
    w: 30 + Math.round(Math.random() * 30),
    h: 30 + Math.round(Math.random() * 30),
  })),
};

type EditTool = "place" | "delete";

export default function SimulasiPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef({ x: 0, y: 350 });
  const headingRef = useRef(0);
  const scaleRef = useRef(1);

  const leftMotorRef = useRef(0);
  const rightMotorRef = useRef(0);
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const joyActiveRef = useRef(false);
  const joystickRef = useRef<HTMLDivElement>(null);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const [leftMotor, setLeftMotor] = useState(0);
  const [rightMotor, setRightMotor] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editTool, setEditTool] = useState<EditTool>("place");
  const [showPresets, setShowPresets] = useState(false);
  const scanDotsRef = useRef<Array<{ x: number; y: number }>>([]);
  const sweepPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastSweepAngleRef = useRef(-1);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawEndRef = useRef<{ x: number; y: number } | null>(null);
  const [obstacleCount, setObstacleCount] = useState(0);
  const distanceRef = useRef(-1);
  const [sensorDist, setSensorDist] = useState("---");
  const gyroRef = useRef(0);
  const scanFrameCountRef = useRef(0);

  // Virtual Hardware State (matching real robot)
  const [buzzerActive, setBuzzerActive] = useState(false);
  const [leds, setLeds] = useState([0, 0, 0, 0]); // P1, P2, M1, M2
  const lastBuzzerRef = useRef(0);
  const [modul1Active, setModul1Active] = useState(true);
  const modul1ActiveRef = useRef(true);
  const [modul1Braking, setModul1Braking] = useState(false);
  const [modul1Threshold, setModul1Threshold] = useState(30); // 3cm default
  const modul1ThresholdRef = useRef(30);
  const modul1BrakingRef = useRef(false);
  const [modul2Active, setModul2Active] = useState(false);
  const modul2ActiveRef = useRef(false);
  const [modul3Active, setModul3Active] = useState(false);
  const modul3ActiveRef = useRef(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const sectorDataRef = useRef<number[]>(SECTORS.map(() => -1));
  const [sectorData, setSectorData] = useState<number[]>(SECTORS.map(() => -1));
  const [navTarget, setNavTarget] = useState("—");
  const navTargetSectorRef = useRef(-1);
  const navTargetHeadingRef = useRef(0);
  const navTurnHeadingRef = useRef(0);
  const navPhaseRef = useRef<"scan"|"turn"|"drive"|"reverse"|"turnaround">("scan");
  const navTickRef = useRef(0);
  const navScanResetRef = useRef(false);
  const navDriveStartPosRef = useRef({ x: 0, y: 0 });
  const navStuckCountRef = useRef(0);
  const navTurnaroundHeadingRef = useRef(0);
  const navStallTicksRef = useRef(0);

  // Monitor Log System
  const MAX_LOG = 100;
  type LogEntry = { time: string; msg: string; type: "info" | "warn" | "error" | "nav" | "sensor" | "motor" };
  const logEntriesRef = useRef<LogEntry[]>([
    { time: new Date().toLocaleTimeString("id-ID", { hour12: false }), msg: "Monitor log aktif", type: "info" }
  ]);
  const [showLog, setShowLog] = useState(false);
  const [logTick, setLogTick] = useState(0);
  const logEvent = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    const now = new Date();
    const time = now.toLocaleTimeString("id-ID", { hour12: false });
    logEntriesRef.current.push({ time, msg, type });
    if (logEntriesRef.current.length > MAX_LOG) logEntriesRef.current = logEntriesRef.current.slice(-MAX_LOG);
    setLogTick(t => t + 1);
  }, []);

  // Physical State for smoother movement
  const velRef = useRef({ x: 0, y: 0 });
  const angVelRef = useRef(0);
  const ACCEL = 0.08;       // Slower acceleration (was 0.15)
  const FRICTION = 0.80;    // Stronger braking (was 0.85)
  const ANG_ACCEL = 0.04;   // Smoother turning
  const ANG_FRICTION = 0.7; // Stronger turn braking (was 0.8)

  // ESP32 NYATA mode
  const [mode, setMode] = useState<"LATIHAN" | "NYATA">("LATIHAN");
  const modeRef = useRef<"LATIHAN" | "NYATA">("LATIHAN");
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
  const sendServo = useCallback((deg: number) => {
    const prev = servoRef.current;
    const a = Math.round(Math.max(0, Math.min(180, deg)));
    setServoAngle(a);
    servoRef.current = a;
    if (a !== prev) logEvent(`Servo ${prev}° → ${a}°`, "sensor");
    if (modeRef.current === "NYATA" && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ servo: a }));
    }
  }, [logEvent]);

  // Servo sweep history
  type ServoRead = { angle: number; dist: number };
  const servoHistoryRef = useRef<ServoRead[]>([]);

  const snap = (v: number) => Math.round(v / GRID_STEP) * GRID_STEP;

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
    const mx = (clientX - rect.left - cx) / s + p.x;
    const my = (clientY - rect.top - cy) / s + p.y;
    return { x: mx, y: my };
  }, []);

  const motorLogThrottleRef = useRef(0);
  const setMotors = useCallback((l: number, r: number) => {
    const prevL = leftMotorRef.current;
    const prevR = rightMotorRef.current;
    leftMotorRef.current = l;
    rightMotorRef.current = r;
    setLeftMotor(l);
    setRightMotor(r);
    const now = Date.now();
    if ((l !== prevL || r !== prevR) && now - motorLogThrottleRef.current > 500) {
      motorLogThrottleRef.current = now;
      logEvent(`Motor L=${l} R=${r}`, "motor");
    }
    if (modeRef.current === "NYATA" && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ leftMotor: l, rightMotor: r }));
    }
  }, [logEvent]);

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

    // Per-axis deadzone 12% with smooth ramp
    const DEADZONE = 0.12;
    const applyDeadzone = (v: number) => {
      const abs = Math.abs(v);
      if (abs < DEADZONE) return 0;
      return (abs - DEADZONE) / (1 - DEADZONE) * (v > 0 ? 1 : -1);
    };
    const nx = applyDeadzone(nxRaw);
    const ny = applyDeadzone(nyRaw);

    const anyInput = Math.abs(nx) > 0.01 || Math.abs(ny) > 0.01;
    if (anyInput) {
      setJoyPos({ x: dx, y: dy });
    } else {
      setJoyPos({ x: 0, y: 0 });
    }

    // Differential drive with anti-clamp scaling
    let rawL = (ny + nx) * 255;
    let rawR = (ny - nx) * 255;
    const maxAbs = Math.max(Math.abs(rawL), Math.abs(rawR), 255);
    const scale = maxAbs > 255 ? 255 / maxAbs : 1;
    const l = Math.round(rawL * scale);
    const r = Math.round(rawR * scale);
    setMotors(l, r);
  }, [setMotors]);

  const handleJoyEnd = useCallback(() => {
    joyActiveRef.current = false;
    setMotors(0, 0);
    setJoyPos({ x: 0, y: 0 });
  }, [setMotors]);

  const collides = (x: number, y: number, radius = ROBOT_R) => {
    for (const o of obstaclesRef.current) {
      if (x + radius > o.x && x - radius < o.x + o.w && y + radius > o.y && y - radius < o.y + o.h) return true;
    }
    return false;
  };

  const rayIntersect = (ox: number, oy: number, dx: number, dy: number, rect: Obstacle) => {
    const t1 = (rect.x - ox) / dx;
    const t2 = (rect.x + rect.w - ox) / dx;
    const t3 = (rect.y - oy) / dy;
    const t4 = (rect.y + rect.h - oy) / dy;
    const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
    const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
    if (tmax < 0 || tmin > tmax) return -1;
    return tmin > 0 ? tmin : -1;
  };

  const castRayAngle = (angleOffset: number, markSeen = true) => {
    const p = posRef.current;
    const h = headingRef.current + angleOffset;
    const rx = Math.sin(h);
    const ry = -Math.cos(h);
    let closest = -1;
    let hitObs: Obstacle | null = null;
    for (const o of obstaclesRef.current) {
      const d = rayIntersect(p.x, p.y, rx, ry, o);
      if (d > 0 && (closest < 0 || d < closest)) { closest = d; hitObs = o; }
    }
    if (markSeen && hitObs) {
      hitObs.seen = true;
      const hx = p.x + rx * closest;
      const hy = p.y + ry * closest;
      const dots = scanDotsRef.current;
      if (dots.length === 0 || Math.hypot(dots[dots.length - 1].x - hx, dots[dots.length - 1].y - hy) > 8) {
        dots.push({ x: hx, y: hy });
      }
    }
    return closest > 0 ? Math.min(closest, MAX_SENSE) : -1;
  };

  const castLaser = () => castRayAngle(0);

  // Find safe spawn point (not inside obstacles)
  const findSafeSpawn = useCallback(() => {
    const candidates = [
      { x: 0, y: 350 },    // Center of new labyrinth
      { x: -150, y: 250 }, // Left corridor
      { x: 150, y: 450 },  // Right corridor
      { x: -200, y: 450 }, // Upper left area
      { x: 200, y: 150 },  // Upper right area
      { x: 0, y: 100 },    // Lower center
      { x: 0, y: 600 },    // Top center
    ];
    
    for (const pos of candidates) {
      if (!collides(pos.x, pos.y)) {
        return pos;
      }
    }
    
    // Fallback: search grid
    for (let y = 50; y < 650; y += 50) {
      for (let x = -350; x < 350; x += 50) {
        if (!collides(x, y)) {
          return { x, y };
        }
      }
    }
    
    return { x: 0, y: 350 }; // Ultimate fallback - center
  }, []);

  // WebSocket connection to ESP32
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

  // Physics tick (differential drive kinematics)
  const tick = useCallback(() => {
    const p = posRef.current;
    const h = headingRef.current;

    if (modeRef.current === "NYATA") {
      const tele = telemetryRef.current;
      const d = (tele?.distance != null && tele.distance >= 0)
        ? Math.min(tele.distance / 10, MAX_SENSE)
        : -1;
      distanceRef.current = d;
      setSensorDist(d > 0 ? `${d.toFixed(0)}cm` : "---");
      gyroRef.current = (tele?.gyroZ ?? 0) * 0.002;

      // Update heading from ESP MPU yaw
      const y = tele?.yaw;
      if (y != null) headingRef.current = y * Math.PI / 180;

      // Persistent obstacle hit points from VL53L0X (grid-quantized, filtered)
      const dots = scanDotsRef.current;
      const gyroMag = Math.abs(tele?.gyroZ ?? 0);
      const scanFrameCount = scanFrameCountRef.current;
      scanFrameCountRef.current = scanFrameCount + 1;
      // Auto-purge dots too far from robot (position estimate drifted)
      if (dots.length > 10) {
        const far = dots.filter(dot => Math.hypot(dot.x - p.x, dot.y - p.y) < 600);
        if (far.length < dots.length) {
          scanDotsRef.current = far.length > 10 ? far : dots.slice(-50);
        }
      }
      if (d > 0 && gyroMag < 30 && scanFrameCount % 4 === 0) {
        const hdg = headingRef.current;
        const gridSize = 25;
        const hitX = Math.round((p.x + Math.sin(hdg) * d) / gridSize) * gridSize;
        const hitY = Math.round((p.y - Math.cos(hdg) * d) / gridSize) * gridSize;
        // Only add if not a duplicate of recent dots
        let dup = false;
        const cur = scanDotsRef.current;
        for (let i = Math.max(0, cur.length - 20); i < cur.length; i++) {
          if (cur[i].x === hitX && cur[i].y === hitY) { dup = true; break; }
        }
        if (!dup) {
          cur.push({ x: hitX, y: hitY });
          if (cur.length > 300) cur.splice(0, cur.length - 300);
        }
      }

      // Dead reckoning from motor commands (visualization only)
      const l = leftMotorRef.current;
      const r = rightMotorRef.current;
      if (l !== 0 || r !== 0) {
        const vl = Math.max(-1, Math.min(1, l / 255));
        const vr = Math.max(-1, Math.min(1, r / 255));
        const V = (vl + vr) / 2 * 0.4; // scale for real robot visual
        const dx = V * Math.sin(headingRef.current);
        const dy = -V * Math.cos(headingRef.current);
        p.x += dx;
        p.y += dy;

        const trail = trailRef.current;
        if (trail.length === 0 || Math.hypot(trail[trail.length - 1].x - p.x, trail[trail.length - 1].y - p.y) > 3) {
          trail.push({ x: p.x, y: p.y });
          if (trail.length > TRAIL_LEN) trail.shift();
        }
      }
      return;
    }

    // LATIHAN: cast laser at current servo angle
    // Modul 2: auto-sweep servo when active (unless M3 overrides)
    if (modul2ActiveRef.current) {
      if (modul3ActiveRef.current) {
        const phase = navPhaseRef.current;
        if (phase === "drive") {
          servoRef.current = 90;
        } else if (phase === "turn" && navTargetSectorRef.current >= 0) {
          const cx = SECTORS[navTargetSectorRef.current].cx;
          const hdgDeg = h * 180 / Math.PI;
          const hdgAtTurn = navTurnHeadingRef.current;
          const ang = Math.round(Math.max(20, Math.min(160, cx - (hdgDeg - hdgAtTurn))));
          servoRef.current = ang;
        } else {
          servoRef.current = Math.round(90 + Math.sin(Date.now() / 1000 * 0.35) * 70);
        }
      } else {
        servoRef.current = Math.round(90 + Math.sin(Date.now() / 1000 * 0.35) * 70);
      }
    }
    const servoRad = (servoRef.current - 90) * Math.PI / 180;
    const d = castRayAngle(servoRad, true); // Enable mapping (markSeen = true)

    distanceRef.current = d;
    setSensorDist(d > 0 ? `${(d / 10).toFixed(0)}cm` : "---");

    // Capture sector data during sweep
    if (modul2ActiveRef.current) {
      const s = servoRef.current;
      for (let i = 0; i < SECTORS.length; i++) {
        const sec = SECTORS[i];
        if (s >= sec.min && s <= sec.max) {
          const dist = d > 0 ? d : MAX_SENSE;
          sectorDataRef.current[i] = dist;
          setSectorData([...sectorDataRef.current]);
          if (d > 0) logEvent(`${sec.id} ${s}° → ${(d/10).toFixed(0)}cm`, "sensor");
          break;
        }
      }
    }

    // Collect sweep point cloud data
    if (modul2ActiveRef.current && d > 0) {
      const angleDiff = Math.abs(servoRef.current - lastSweepAngleRef.current);
      if (lastSweepAngleRef.current < 0 || angleDiff >= 3) {
        lastSweepAngleRef.current = servoRef.current;
        const p = posRef.current;
        const h = headingRef.current;
        const sr = (servoRef.current - 90) * Math.PI / 180;
        const sx = p.x + Math.sin(h + sr) * d;
        const sy = p.y - Math.cos(h + sr) * d;
        sweepPointsRef.current.push({ x: sx, y: sy });
        if (sweepPointsRef.current.length > 2000) {
          sweepPointsRef.current = sweepPointsRef.current.slice(-1500);
        }
      }
    }

    // Update sweep history for visualization
    if (d > 0) {
      servoHistoryRef.current.push({ angle: servoRef.current, dist: d });
      if (servoHistoryRef.current.length > 100) servoHistoryRef.current.shift();
    }

    const d_now = distanceRef.current;

    let l = leftMotorRef.current;
    let r = rightMotorRef.current;

    // Virtual Buzzer Logic (Matching real robot: beep if <= 5cm in CURRENT sensor direction)
    if (d_now > 0 && d_now <= 50) {
      const now = Date.now();
      if (now - lastBuzzerRef.current > 200) {
        setBuzzerActive(p => !p);
        lastBuzzerRef.current = now;
      }
    } else {
      setBuzzerActive(false);
    }

    // Modul 1: Collision Detection - Auto stop before wall
    const movingForward = l > 30 && r > 30;
    const m3Driving = modul3ActiveRef.current && navPhaseRef.current === "drive";
    if (modul1ActiveRef.current && !m3Driving && d_now > 0 && d_now <= modul1ThresholdRef.current && movingForward) {
      l = 0;
      r = 0;
      leftMotorRef.current = 0;
      rightMotorRef.current = 0;
      setLeftMotor(0);
      setRightMotor(0);
      setModul1Braking(true);
      modul1BrakingRef.current = true;
      logEvent(`M1 BRAKING! jarak=${(d_now/10).toFixed(0)}cm`, "warn");
    } else {
      setModul1Braking(false);
      modul1BrakingRef.current = false;
    }

    // --- Modul 3: Navigasi step-by-step ---
    if (modul3ActiveRef.current) {
      const sd = sectorDataRef.current;
      const NAV_THRESH = 80;
      const HEADING_TOL = 15;
      const CENTER_IDX = 6; // S7 (81-90°) — lurus depan
      const headingDeg = h * 180 / Math.PI;

      if (navPhaseRef.current === "scan") {
        if (!navScanResetRef.current) {
          navScanResetRef.current = true;
          for (let i = 0; i < sectorDataRef.current.length; i++) sectorDataRef.current[i] = -1;
          setSectorData([...sectorDataRef.current]);
          sweepPointsRef.current = [];
          lastSweepAngleRef.current = -1;
        }
        const filled = sd.filter(v => v > 0).length;
        setNavTarget(`SCAN ${filled}/${SECTORS.length}`);
        l = 0; r = 0;
        if (filled >= SECTORS.length) {
          let bestIdx = -1;
          let bestDist = -1;
          for (let i = 0; i < sd.length; i++) {
            if (sd[i] > bestDist) { bestDist = sd[i]; bestIdx = i; }
          }
          if (bestIdx >= 0 && bestDist >= NAV_THRESH) {
            navTargetSectorRef.current = bestIdx;
            const cx = SECTORS[bestIdx].cx;
            navTargetHeadingRef.current = headingDeg + (cx - 90);
            navTurnHeadingRef.current = headingDeg;
            navScanResetRef.current = false;
            velRef.current = { x: 0, y: 0 };
            angVelRef.current = 0;
            navPhaseRef.current = "turn";
            logEvent(`M3→${SECTORS[bestIdx].id} ${(bestDist/10).toFixed(0)}cm`, "nav");
          }
        }
      }

      else if (navPhaseRef.current === "turn") {
        let err = navTargetHeadingRef.current - headingDeg;
        if (err > 180) err -= 360;
        if (err < -180) err += 360;
        setNavTarget(`→ ${err.toFixed(0)}°`);
        if (Math.abs(err) <= HEADING_TOL) {
          navPhaseRef.current = "drive";
          navTickRef.current = 0;
          navTargetSectorRef.current = -1;
          navScanResetRef.current = false;
          navDriveStartPosRef.current = { x: posRef.current.x, y: posRef.current.y };
          navStallTicksRef.current = 0;
          velRef.current = { x: 0, y: 0 };
          angVelRef.current = 0;
          sweepPointsRef.current = [];
          lastSweepAngleRef.current = -1;
          for (let i = 0; i < sectorDataRef.current.length; i++) sectorDataRef.current[i] = -1;
          setSectorData([...sectorDataRef.current]);
          logEvent("M3 MAJU", "nav");
        } else {
          const speed = 60;
          if (err > 0) { l = speed; r = -speed; }
          else { l = -speed; r = speed; }
        }
      }

      else if (navPhaseRef.current === "drive") {
        const centerDist = sd[CENTER_IDX] || 0;
        const hdg = headingRef.current;
        const px = posRef.current.x;
        const py = posRef.current.y;
        const lx = px + Math.sin(hdg - Math.PI/2) * ROBOT_R;
        const ly = py - Math.cos(hdg - Math.PI/2) * ROBOT_R;
        const rx = px + Math.sin(hdg + Math.PI/2) * ROBOT_R;
        const ry = py - Math.cos(hdg + Math.PI/2) * ROBOT_R;
        const bodyHit = collides(lx, ly, 2) || collides(rx, ry, 2);
        const wallAhead = centerDist > 0 && centerDist < 30;
        const speed = Math.abs(velRef.current.x) + Math.abs(velRef.current.y);
        const stalled = speed < 0.3;
        if (stalled) navStallTicksRef.current++;
        else navStallTicksRef.current = 0;
        if (bodyHit || wallAhead || navStallTicksRef.current >= 30) {
          const dx = px - navDriveStartPosRef.current.x;
          const dy = py - navDriveStartPosRef.current.y;
          const distTraveled = Math.hypot(dx, dy);
          if (distTraveled < 10) {
            navPhaseRef.current = "reverse";
            navTickRef.current = 0;
            navScanResetRef.current = false;
            velRef.current = { x: 0, y: 0 };
            angVelRef.current = 0;
            logEvent("M3 STUCK mundur", "warn");
          } else {
            navStuckCountRef.current = 0;
            navPhaseRef.current = "scan";
            navScanResetRef.current = false;
            sweepPointsRef.current = [];
            lastSweepAngleRef.current = -1;
            logEvent("M3 STOP", "nav");
          }
        } else {
          l = 120; r = 120;
        }
      }

      else if (navPhaseRef.current === "reverse") {
        navTickRef.current++;
        if (navTickRef.current > 30) {
          navStuckCountRef.current++;
          if (navStuckCountRef.current >= 2) {
            navPhaseRef.current = "turnaround";
            navTurnaroundHeadingRef.current = headingDeg;
            navTickRef.current = 0;
            logEvent("M3 TURNAROUND 180°", "nav");
          } else {
            navPhaseRef.current = "scan";
            navScanResetRef.current = false;
            sweepPointsRef.current = [];
            lastSweepAngleRef.current = -1;
            logEvent("M3 REVERSE selesai", "nav");
          }
        } else {
          l = -80; r = -60;
        }
      }

      else if (navPhaseRef.current === "turnaround") {
        let turned = headingDeg - navTurnaroundHeadingRef.current;
        if (turned > 180) turned -= 360;
        if (turned < -180) turned += 360;
        setNavTarget(`PUTAR ${Math.abs(turned).toFixed(0)}°`);
        if (Math.abs(turned) >= 160) {
          navStuckCountRef.current = 0;
          navPhaseRef.current = "scan";
          navScanResetRef.current = false;
          sweepPointsRef.current = [];
          lastSweepAngleRef.current = -1;
          logEvent("M3 TURNAROUND selesai", "nav");
        } else {
          l = 80; r = -80;
        }
      }

      leftMotorRef.current = l;
      rightMotorRef.current = r;
      setLeftMotor(l);
      setRightMotor(r);
    }

    // Physical simulation
    const vl_target = Math.max(-1, Math.min(1, l / 255));
    const vr_target = Math.max(-1, Math.min(1, r / 255));
    
    const V_target = (vl_target + vr_target) / 2 * 1.5; // Slightly lower top speed (was 2.0)
    const w_target = (vl_target - vr_target) / WHEEL_BASE * 1.2; // Calibrated turn speed

    // Apply acceleration/momentum
    const targetVx = V_target * Math.sin(h);
    const targetVy = -V_target * Math.cos(h);

    velRef.current.x += (targetVx - velRef.current.x) * ACCEL;
    velRef.current.y += (targetVy - velRef.current.y) * ACCEL;
    angVelRef.current += (w_target - angVelRef.current) * ANG_ACCEL;

    // Apply friction
    if (l === 0 && r === 0) {
      velRef.current.x *= FRICTION;
      velRef.current.y *= FRICTION;
      angVelRef.current *= ANG_FRICTION;
    }

    const dx = velRef.current.x;
    const dy = velRef.current.y;
    const dh = angVelRef.current;
    gyroRef.current = dh;

    // Collision check per axis
    if (!collides(p.x + dx, p.y)) p.x += dx;
    else velRef.current.x *= -0.2; // Bounce slightly

    if (!collides(p.x, p.y + dy)) p.y += dy;
    else velRef.current.y *= -0.2; // Bounce slightly

    headingRef.current = h + dh;

    const trail = trailRef.current;
    if (trail.length === 0 || Math.hypot(trail[trail.length - 1].x - p.x, trail[trail.length - 1].y - p.y) > 3) {
      trail.push({ x: p.x, y: p.y });
      if (trail.length > TRAIL_LEN) trail.shift();
    }
  }, []);

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
    const vw = rect.width;
    const vh = rect.height;
    const _cx = vw / 2;
    const _cy = vh / 2;
    const p = posRef.current;
    const h = headingRef.current;
    const s = scaleRef.current;

    // Background
    ctx.fillStyle = "#18181b";
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(_cx, _cy);
    ctx.scale(s, s);
    ctx.translate(-p.x, -p.y);

    // ---- Grid ----
    const viewW = vw / s;
    const viewH = vh / s;
    const minX = Math.floor((p.x - viewW / 2) / GRID_STEP) * GRID_STEP;
    const maxX = Math.ceil((p.x + viewW / 2) / GRID_STEP) * GRID_STEP;
    const minY = Math.floor((p.y - viewH / 2) / GRID_STEP) * GRID_STEP;
    const maxY = Math.ceil((p.y + viewH / 2) / GRID_STEP) * GRID_STEP;

    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = minX; x <= maxX; x += GRID_STEP) {
      ctx.beginPath();
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
      ctx.stroke();
    }
    for (let y = minY; y <= maxY; y += GRID_STEP) {
      ctx.beginPath();
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
      ctx.stroke();
    }

    // ---- Sweep point cloud ----
    const swpts = sweepPointsRef.current;
    if (swpts.length > 0 && modul2Active) {
      for (const pt of swpts) {
        ctx.fillStyle = "rgba(34, 211, 238, 0.08)";
        ctx.fillRect(pt.x - 1, pt.y - 1, 2, 2);
      }
    }

    // ---- Scan dots (sensor hit points) ----
    const dots = scanDotsRef.current;
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      if (modeRef.current === "NYATA") {
        // NYATA: small squares dengan fade (lebih baru = lebih terang)
        const recent = i > dots.length - 50;
        ctx.fillStyle = recent ? "rgba(250, 204, 21, 0.6)" : "rgba(250, 204, 21, 0.15)";
        ctx.fillRect(dot.x - 3, dot.y - 3, 6, 6);
        if (recent) {
          ctx.strokeStyle = "rgba(250, 204, 21, 0.3)";
          ctx.lineWidth = 1;
          ctx.strokeRect(dot.x - 3, dot.y - 3, 6, 6);
        }
      } else {
        // LATIHAN: small circles
        ctx.fillStyle = "rgba(250, 204, 21, 0.35)";
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- Obstacles (only seen in drive mode; all visible in edit mode or NYATA) ----
    for (const o of obstaclesRef.current) {
      if (!editMode && !o.seen && modeRef.current !== "NYATA") continue;
      const alpha = editMode || modeRef.current === "NYATA" ? (o.seen ? 0.6 : 0.15) : 0.6;
      ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = `rgba(239, 68, 68, ${alpha + 0.2})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      if (o.seen && !editMode) {
        // Subtle glow on seen obstacles
        ctx.fillStyle = "rgba(250, 204, 21, 0.04)";
        ctx.fillRect(o.x - 2, o.y - 2, o.w + 4, o.h + 4);
        // Mapping label
        ctx.fillStyle = "rgba(250, 204, 21, 0.7)";
        ctx.font = "bold 10px monospace";
        ctx.fillText("MAPPING", o.x + 3, o.y + 13);
      }
    }

    // Draw preview while placing obstacle
    if (editMode && editTool === "place" && drawStartRef.current && drawEndRef.current) {
      const sx = drawStartRef.current.x;
      const sy = drawStartRef.current.y;
      const ex = drawEndRef.current.x;
      const ey = drawEndRef.current.y;
      const rx = Math.min(sx, ex);
      const ry = Math.min(sy, ey);
      const rw = Math.max(sx, ex) - rx;
      const rh = Math.max(sy, ey) - ry;
      if (rw > 1 && rh > 1) {
        ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
      }
    }

    // Origin crosshair
    ctx.strokeStyle = "rgba(59,130,246,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(20, 0);
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 20);
    ctx.stroke();
    ctx.fillStyle = "rgba(59,130,246,0.4)";
    ctx.font = "8px monospace";
    ctx.fillText("0,0", 4, 10);

    // ---- Trail ----
    const trail = trailRef.current;
    if (trail.length > 1) {
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
      ctx.strokeStyle = "rgba(96, 165, 250, 0.2)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ---- Movement arrow ----
    const l = leftMotorRef.current;
    const r = rightMotorRef.current;
    const motorActive = l !== 0 || r !== 0;
    if (motorActive && Math.abs(l + r) > 30) {
      const avg = (l + r) / 510;
      const dir = avg > 0 ? 1 : -1;
      const alen = ROBOT_H + 12;
      const ax = p.x + Math.sin(h) * alen * dir;
      const ay = p.y - Math.cos(h) * alen * dir;
      ctx.strokeStyle = `rgba(34, 197, 94, ${Math.abs(avg) * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.fillStyle = `rgba(34, 197, 94, ${Math.abs(avg) * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - Math.sin(h + 0.4) * 6 * dir, ay + Math.cos(h + 0.4) * 6 * dir);
      ctx.lineTo(ax - Math.sin(h - 0.4) * 6 * dir, ay + Math.cos(h - 0.4) * 6 * dir);
      ctx.closePath();
      ctx.fill();
    }


    // ---- Servo mount indicator ----
    if (modeRef.current === "NYATA") {
      const servoOff = (servoRef.current - 90) * Math.PI / 180;
      const mountX = p.x + Math.sin(h + servoOff * 0.3) * 4;
      const mountY = p.y - Math.cos(h + servoOff * 0.3) * 4;
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(mountX, mountY);
      ctx.stroke();
    }

    // ---- VL53L0X sensor visualization ----
    if (modeRef.current === "NYATA") {
      const servoRad = (servoRef.current - 90) * Math.PI / 180;
      const rayAngle = h + servoRad;
      const distVal = distanceRef.current;
      if (distVal > 0) {
        const rayLen = Math.min(distVal, MAX_SENSE);
        const ex = p.x + Math.sin(rayAngle) * rayLen;
        const ey = p.y - Math.cos(rayAngle) * rayLen;
        ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.min(rayLen, 100), rayAngle - LIDAR_FOV / 2 - Math.PI / 2, rayAngle + LIDAR_FOV / 2 - Math.PI / 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = "rgba(239, 68, 68, 1)";
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
        ctx.font = "bold 10px monospace";
        ctx.fillText(`S:${servoRef.current}° ${distVal.toFixed(0)}cm`, ex + 6, ey - 6);
      } else {
        ctx.fillStyle = "rgba(239, 68, 68, 0.5)";
        ctx.font = "bold 9px monospace";
        ctx.fillText("menunggu ESP...", p.x + 10, p.y - 10);
      }
    }

    // ---- Modul 2: Servo sweep visualization ----
    if (modul2Active && !editMode) {
      const sweepRad = (servoRef.current - 90) * Math.PI / 180;
      // Ghost dots from history
      for (const past of servoHistoryRef.current.slice(-12)) {
        const pa = (past.angle - 90) * Math.PI / 180;
        if (past.dist > 0) {
          const plen = Math.min(past.dist, MAX_SENSE);
          const pex = p.x + Math.sin(h + pa) * plen;
          const pey = p.y - Math.cos(h + pa) * plen;
          ctx.fillStyle = "rgba(34, 211, 238, 0.04)";
          ctx.beginPath();
          ctx.arc(pex, pey, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Current servo ray
      const dNow = distanceRef.current;
      if (dNow > 0) {
        const rayLen = Math.min(dNow, MAX_SENSE);
        const ex = p.x + Math.sin(h + sweepRad) * rayLen;
        const ey = p.y - Math.cos(h + sweepRad) * rayLen;
        ctx.strokeStyle = "rgba(34, 211, 238, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(34, 211, 238, 0.4)";
        ctx.beginPath();
        ctx.arc(ex, ey, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Sector markers
      if (modul2Active) {
        for (let i = 0; i < SECTORS.length; i++) {
          const dVal = sectorDataRef.current[i];
          if (dVal <= 0) continue;
          const aRad = (SECTORS[i].cx - 90) * Math.PI / 180;
          const lx = p.x + Math.sin(h + aRad) * Math.min(dVal, MAX_SENSE);
          const ly = p.y - Math.cos(h + aRad) * Math.min(dVal, MAX_SENSE);
          const hue = 140 - (dVal / MAX_SENSE) * 140;
          ctx.fillStyle = `hsla(${hue}, 80%, 55%, 0.2)`;
          ctx.beginPath();
          ctx.arc(lx, ly, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `hsla(${hue}, 80%, 65%, 0.9)`;
          ctx.font = "bold 7px monospace";
          ctx.fillText(`${SECTORS[i].id}${(dVal/10).toFixed(0)}`, lx + 4, ly - 4);
        }
      }
    }

    // ---- VL53L0X laser ray ----
    const servoRad = (servoRef.current - 90) * Math.PI / 180;
    const distVal = distanceRef.current;

    if (distVal > 0) {
      const rayAngle = h + servoRad;
      const rayLen = Math.min(distVal, MAX_SENSE);
      const ex = p.x + Math.sin(rayAngle) * rayLen;
      const ey = p.y - Math.cos(rayAngle) * rayLen;

      ctx.fillStyle = "rgba(239, 68, 68, 0.03)";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, Math.min(rayLen, 100), rayAngle - LIDAR_FOV / 2 - Math.PI / 2, rayAngle + LIDAR_FOV / 2 - Math.PI / 2);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(239, 68, 68, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
      ctx.beginPath();
      ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(239, 68, 68, 0.7)";
      ctx.font = "bold 9px monospace";
      ctx.fillText(`${(distVal / 10).toFixed(1)}cm`, ex + 5, ey - 5);
    }

    // ---- Modul 1: Collision Ring ----
    if (modul1Braking) {
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, ROBOT_R + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- Robot (Physical-Sync Representation) ----
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(h);

    // Chassis body
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, 0, ROBOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // LEDs (P1, P2, M1, M2) - matching physical robot layout
    const ledColors = ["#3b82f6", "#3b82f6", "#ef4444", "#ef4444"];
    leds.forEach((on, i) => {
      if (!on) return;
      ctx.fillStyle = ledColors[i];
      // P1/P2 at front (negative y), M1/M2 at back (positive y)
      const lx = (i % 2 === 0 ? -1 : 1) * 8;
      const ly = (i < 2 ? -1 : 1) * 12;
      ctx.beginPath();
      ctx.arc(lx, ly, 3, 0, Math.PI * 2);
      ctx.fill();
      // Glow
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = ledColors[i];
      ctx.beginPath();
      ctx.arc(lx, ly, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Buzzer indicator (Visual waves when active)
    if (buzzerActive) {
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2;
      const waveOffset = (Date.now() / 100) % 5;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, ROBOT_R + 5 + i * 5 + waveOffset, -Math.PI / 4 - Math.PI / 2, Math.PI / 4 - Math.PI / 2);
        ctx.stroke();
      }
    }

    // Direction indicator (Center line)
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -ROBOT_R);
    ctx.stroke();

    ctx.restore();

    // Heading line
    ctx.strokeStyle = "rgba(59,130,246,0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.sin(h) * (ROBOT_H + 15), p.y - Math.cos(h) * (ROBOT_H + 15));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();

    // ---- HUD ----
    ctx.font = "8px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillText(`L:${l} R:${r}`, 8, vh - 8);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillText(`x:${p.x.toFixed(0)} y:${p.y.toFixed(0)} h:${(h * 180 / Math.PI).toFixed(0)}°`, 8, vh - 18);
    ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
    ctx.fillText(`VL53L0X: ${sensorDist}`, 8, vh - 28);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    const dotCount = scanDotsRef.current.length;
    ctx.fillText(`zoom:${s.toFixed(1)} servo:${servoRef.current}° dots:${dotCount}`, 8, vh - 38);
    if (modul2Active) {
      ctx.fillStyle = "rgba(34, 211, 238, 0.2)";
      ctx.font = "8px monospace";
      ctx.fillText(`SWEEP:${sweepPointsRef.current.length}pt`, 8, vh - 48);
    }
    if (modul1Active) {
      ctx.fillStyle = modul1Braking ? "rgba(255, 0, 0, 0.4)" : "rgba(34, 197, 94, 0.15)";
      ctx.font = "bold 8px monospace";
      ctx.fillText(modul1Braking ? `! HENTI ! <${(modul1Threshold / 10).toFixed(0)}cm` : `M1 <${(modul1Threshold / 10).toFixed(0)}cm`, 8, vh - 58);
    }
    if (modul3Active) {
      ctx.fillStyle = "rgba(251, 191, 36, 0.25)";
      ctx.font = "bold 8px monospace";
      ctx.fillText(`NAV:${navTarget}`, 8, vh - 68);
    }
  }, [obstacleCount, sensorDist, editMode, editTool, modul1Active, modul1Braking, modul1Threshold, modul2Active, sectorData, modul3Active, navTarget]);

  // Pointer handlers for canvas
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (joyActiveRef.current) return;
    if (editMode) {
      if (editTool === "delete") {
        const w = screenToWorld(e.clientX, e.clientY);
        const obst = obstaclesRef.current;
        for (let i = obst.length - 1; i >= 0; i--) {
          const o = obst[i];
          if (w.x >= o.x && w.x <= o.x + o.w && w.y >= o.y && w.y <= o.y + o.h) {
            obst.splice(i, 1);
            setObstacleCount(obst.length);
            break;
          }
        }
        return;
      }
      const w = screenToWorld(e.clientX, e.clientY);
      drawStartRef.current = { x: w.x, y: w.y };
      drawEndRef.current = { x: w.x, y: w.y };
      return;
    }
  }, [editMode, editTool, screenToWorld]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (editMode && editTool === "place") {
      if (drawStartRef.current) {
        const w = screenToWorld(e.clientX, e.clientY);
        drawEndRef.current = { x: w.x, y: w.y };
      }
      return;
    }
  }, [editMode, editTool, screenToWorld]);

  const handlePointerUp = useCallback(() => {
    if (editMode && editTool === "place" && drawStartRef.current && drawEndRef.current) {
      const sx = drawStartRef.current.x;
      const sy = drawStartRef.current.y;
      const ex = drawEndRef.current.x;
      const ey = drawEndRef.current.y;
      const rx = snap(Math.min(sx, ex));
      const ry = snap(Math.min(sy, ey));
      const rw = Math.max(snap(ex), snap(sx)) - rx;
      const rh = Math.max(snap(ey), snap(sy)) - ry;
      if (rw >= GRID_STEP && rh >= GRID_STEP) {
        obstaclesRef.current.push({ x: rx, y: ry, w: rw, h: rh });
        setObstacleCount(obstaclesRef.current.length);
      }
      drawStartRef.current = null;
      drawEndRef.current = null;
      return;
    }
  }, [editMode, editTool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = scaleRef.current;
      scaleRef.current = Math.max(0.1, Math.min(10, s * (e.deltaY > 0 ? 0.9 : 1.1)));
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });

    // Keyboard
    const keys = new Set<string>();
    const handleKeyDown = (e: KeyboardEvent) => {
      keys.add(e.key.toLowerCase());
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) e.preventDefault();
      if (e.key === "Tab") { e.preventDefault(); setEditMode(p => !p); }
      if (e.key.toLowerCase() === "q") sendServo(servoRef.current - 5);
      if (e.key.toLowerCase() === "e") sendServo(servoRef.current + 5);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      if (keys.size === 0 && !joyActiveRef.current) setMotors(0, 0);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Physics + render loop
    let running = true;

    const loop = () => {
      if (!running) return;

      if (!joyActiveRef.current && !editMode && !(modeRef.current === "NYATA" && !telemetryRef.current)) {
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
  }, [tick, draw, setMotors, editMode]);

  // Load LABIRIN preset on mount
  useEffect(() => {
    obstaclesRef.current = PRESETS.LABIRIN.map(o => ({ ...o }));
    setObstacleCount(obstaclesRef.current.length);
    const safePos = findSafeSpawn();
    posRef.current = safePos;
    headingRef.current = 0;
    trailRef.current = [];
    sweepPointsRef.current = [];
    lastSweepAngleRef.current = -1;
  }, [findSafeSpawn]);

  // Sync joystick visual knob with keyboard/motor state
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

  // Sync module refs for tick (stale closure fix)
  useEffect(() => { modul1ActiveRef.current = modul1Active; }, [modul1Active]);
  useEffect(() => { modul1ThresholdRef.current = modul1Threshold; }, [modul1Threshold]);
  useEffect(() => { modul1BrakingRef.current = modul1Braking; }, [modul1Braking]);
  useEffect(() => { modul2ActiveRef.current = modul2Active; }, [modul2Active]);
  useEffect(() => {
    modul3ActiveRef.current = modul3Active;
    if (modul3Active) {
      navPhaseRef.current = "scan";
      navScanResetRef.current = false;
      navTargetSectorRef.current = -1;
      navTickRef.current = 0;
      sweepPointsRef.current = [];
      lastSweepAngleRef.current = -1;
    }
  }, [modul3Active]);

  return (
    <main className="fixed inset-0 bg-black select-none touch-none">
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${editMode ? (editTool === "delete" ? "cursor-cell" : "cursor-crosshair") : "cursor-default"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Toolbar */}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 flex gap-1.5">
        <button
          onClick={() => setEditMode(p => !p)}
          className={`px-3 py-1 rounded-full text-[10px] font-mono font-bold border transition-colors active:scale-90 ${
            editMode
              ? "bg-red-600 border-red-500 text-white"
              : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
          }`}
        >
          {editMode ? "EDIT" : "DRIVE"}
        </button>
        <button
          onClick={() => setModulesOpen(p => !p)}
          className={`px-2 py-1 rounded-full text-[10px] font-mono border active:scale-90 transition-colors ${
            modulesOpen || modul1Braking
              ? "bg-cyan-600 border-cyan-500 text-white"
              : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
          }`}
        >
          MODUL{modul1Braking ? "!" : ""}
        </button>
        {modulesOpen && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 flex flex-col gap-1.5 min-w-[220px] bg-zinc-900/80 backdrop-blur-md px-3 py-2.5 rounded-xl border border-white/10 z-50">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M1</span>
                <span className="text-[10px] font-mono text-zinc-300">COLLISION</span>
              </div>
              <button
                onClick={() => { setModul1Active(p => !p); modul1ActiveRef.current = !modul1Active; }}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  modul1Active
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {modul1Active ? "ON" : "OFF"}
              </button>
            </div>
            {modul1Active && (
              <div className="flex items-center gap-2 pl-4">
                <span className="text-[8px] font-mono text-zinc-500">JARAK</span>
                <input
                  type="range"
                  min="30"
                  max="500"
                  step="10"
                  value={modul1Threshold}
                  onChange={e => { setModul1Threshold(Number(e.target.value)); modul1ThresholdRef.current = Number(e.target.value); }}
                  className="flex-1 h-1 accent-cyan-500 cursor-pointer"
                />
                <span className="text-[9px] font-mono text-cyan-400 w-9 text-right">{(modul1Threshold / 10).toFixed(0)}cm</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M2</span>
                <span className="text-[10px] font-mono text-zinc-300">SERVO LASER</span>
              </div>
              <button
                onClick={() => setModul2Active(p => !p)}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  modul2Active
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {modul2Active ? "ON" : "OFF"}
              </button>
            </div>
            {modul2Active && (
              <div className="flex items-center gap-1 pl-4 text-[8px] font-mono">
                {SECTORS.map((sec, i) => {
                  const d = sectorData[i];
                  const pct = d > 0 ? Math.min(d / MAX_SENSE, 1) * 100 : 0;
                  return (
                    <div key={sec.id} className="flex flex-col items-center gap-0.5">
                      <span className="text-zinc-500">{sec.id}</span>
                      <div className="w-5 h-12 bg-zinc-900 rounded-sm border border-zinc-800 relative overflow-hidden">
                        <div
                          className="absolute bottom-0 left-0 w-full transition-all duration-150"
                          style={{
                            height: `${pct}%`,
                            background: d <= 0 ? "transparent" : d < 200 ? "rgba(239,68,68,0.5)" : "rgba(34,211,238,0.3)",
                          }}
                        />
                      </div>
                      <span className={d > 0 && d < 200 ? "text-rose-400" : "text-zinc-600"}>
                        {d > 0 ? `${(d/10).toFixed(0)}` : "-"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-zinc-500">M3</span>
                <span className="text-[10px] font-mono text-zinc-300">NAVIGASI</span>
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
              <div className="pl-4 text-[9px] font-mono">
                <span className="text-amber-400">{navTarget}</span>
                <span className="text-zinc-600 ml-1">{navPhaseRef.current.toUpperCase()}</span>
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
          />
        )}
        {editMode && (
          <>
            <button
              onClick={() => setEditTool("place")}
              className={`px-2 py-1 rounded-full text-[10px] font-mono border active:scale-90 ${
                editTool === "place"
                  ? "bg-emerald-600 border-emerald-500 text-white"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              GAMBAR
            </button>
            <button
              onClick={() => setEditTool("delete")}
              className={`px-2 py-1 rounded-full text-[10px] font-mono border active:scale-90 ${
                editTool === "delete"
                  ? "bg-red-600 border-red-500 text-white"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              HAPUS
            </button>
            <button
              onClick={() => {
                obstaclesRef.current = [];
                scanDotsRef.current = [];
                sweepPointsRef.current = [];
                lastSweepAngleRef.current = -1;
                setObstacleCount(0);
              }}
              className="px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px] font-mono active:scale-90"
            >
              ALL
            </button>
            <button
              onClick={() => setShowPresets(p => !p)}
              className={`px-2 py-1 rounded-full text-[10px] font-mono border active:scale-90 ${
                showPresets
                  ? "bg-cyan-600 border-cyan-500 text-white"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}
            >
              PRESET
            </button>
            {showPresets && (
              <div className="fixed top-20 left-1/2 -translate-x-1/2 flex flex-wrap justify-center gap-1.5 max-w-[90vw] bg-zinc-900/60 backdrop-blur-sm px-3 py-2 rounded-xl border border-white/5">
                {Object.keys(PRESETS).map(name => (
                  <button
                    key={name}
                    onClick={() => {
                      obstaclesRef.current = PRESETS[name].map(o => ({ ...o }));
                      scanDotsRef.current = [];
                      sweepPointsRef.current = [];
                      lastSweepAngleRef.current = -1;
                      setObstacleCount(obstaclesRef.current.length);
                      setShowPresets(false);
                      setModul1Braking(false);
                      const safePos = findSafeSpawn();
                      posRef.current = safePos;
                      headingRef.current = 0;
                      trailRef.current = [];
                      logEvent(`Preset ${name} dimuat`, "info");
                    }}
                    className="px-2.5 py-1 rounded-full bg-zinc-800/90 border border-zinc-700 text-zinc-300 hover:text-white hover:border-cyan-500 text-[9px] font-mono active:scale-90 backdrop-blur-sm"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Edit mode hint */}
      {editMode && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 text-[8px] font-mono text-zinc-500 bg-zinc-900/80 px-3 py-1 rounded-full backdrop-blur-sm border border-white/5 whitespace-nowrap">
          {editTool === "place" ? "Tap & drag buat gambar halangan" : "Tap halangan buat hapus"}
        </div>
      )}

      {/* Mode + ESP toolbar */}
      {!editMode && (
        <div className="fixed top-3 left-3 flex flex-col gap-1.5 items-start">
          <button
            onClick={() => {
              const next = mode === "NYATA" ? "LATIHAN" : "NYATA";
              setMode(next);
              modeRef.current = next;
              if (next === "LATIHAN") disconnectESP();
              logEvent(`Mode ${next}`, "info");
            }}
            className={`px-2 py-1 rounded-full text-[9px] font-mono font-bold border active:scale-90 ${
              mode === "NYATA"
                ? "bg-cyan-600 border-cyan-500 text-white"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
            }`}
          >
            {mode}
          </button>
          {mode === "NYATA" && (
            <div className="flex flex-col gap-1.5 bg-zinc-900/60 backdrop-blur-sm p-2 rounded-xl border border-white/10">
              <div className="flex gap-1">
                <input
                  value={espIp}
                  onChange={e => saveEspIp(e.target.value)}
                  placeholder="192.168.1.x"
                  className="w-24 px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-[9px] font-mono text-zinc-300 outline-none"
                />
                <button
                  onClick={() => espConnected ? disconnectESP() : connectESP(espIp)}
                  className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border active:scale-90 ${
                    espConnected
                      ? "bg-emerald-600 border-emerald-500 text-white"
                      : "bg-zinc-800 border-zinc-700 text-zinc-400"
                  }`}
                >
                  {espConnected ? "ON" : "HUBUNG"}
                </button>
              </div>
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
                  {/* Servo control */}
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
                    <span className="text-cyan-400 w-5 text-center">{servoAngle}°</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Joystick */}
      <div
        ref={joystickRef}
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 size-36 rounded-full bg-zinc-900/80 backdrop-blur-md border border-white/10 touch-none select-none transition-opacity ${editMode ? "opacity-30 pointer-events-none" : ""}`}
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

// ─── Monitor Panel ──────────────────────────────────────────────
type MonitorProps = {
  logEntriesRef: React.MutableRefObject<Array<{ time: string; msg: string; type: string }>>;
  logTick: number;
  setShowLog: (v: boolean) => void;
};

function MonitorPanel({ logEntriesRef, logTick, setShowLog }: MonitorProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logTick]);

  const copyLog = () => {
    const text = logEntriesRef.current.map(e => `[${e.time}] ${e.msg}`).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const clearLog = () => {
    logEntriesRef.current = [];
  };

  const typeColor = (t: string) => {
    switch (t) {
      case "warn": return "text-yellow-400";
      case "error": return "text-red-400";
      case "nav": return "text-cyan-400";
      case "sensor": return "text-emerald-400";
      case "motor": return "text-orange-400";
      default: return "text-zinc-400";
    }
  };

  const entries = logEntriesRef.current;

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 w-[480px] max-h-[70vh] bg-zinc-900/95 backdrop-blur-md rounded-xl border border-white/10 text-[10px] font-mono shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0">
        <span className="text-violet-400 font-bold text-[11px] tracking-wider">LOG</span>
        <div className="flex gap-1 items-center">
          <span className="text-zinc-600 text-[8px]">#{logTick}</span>
          <button onClick={clearLog} className="px-1.5 py-0.5 rounded text-[8px] bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 active:scale-90">HAPUS</button>
          <button onClick={copyLog} className="px-1.5 py-0.5 rounded text-[8px] bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 active:scale-90">COPY</button>
        </div>
      </div>

      {/* Log entries */}
      <div className="overflow-y-auto p-2 space-y-0.5 flex-1" style={{ maxHeight: "calc(70vh - 36px)" }}>
        {entries.length === 0 && (
          <div className="text-zinc-600 italic py-4 text-center">Belum ada log</div>
        )}
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-2 leading-snug hover:bg-white/5 px-1 rounded">
            <span className="text-zinc-600 shrink-0 w-[60px]">{entry.time}</span>
            <span className={`${typeColor(entry.type)} break-all`}>{entry.msg}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
