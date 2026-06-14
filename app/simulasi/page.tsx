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

type Obstacle = { x: number; y: number; w: number; h: number; seen?: boolean };

const PRESETS: Record<string, Obstacle[]> = {
  DINDING: [
    { x: -200, y: 250, w: 400, h: 50 },
    { x: -200, y: 100, w: 50, h: 150 },
    { x: 150, y: 100, w: 50, h: 150 },
  ],
  LABIRIN: [
    // Outer Border
    { x: -300, y: -50, w: 50, h: 650 }, // Left
    { x: 250, y: -50, w: 50, h: 650 }, // Right
    { x: -300, y: 600, w: 600, h: 50 }, // Top
    { x: -300, y: -50, w: 250, h: 50 }, // Bottom Left
    { x: 50, y: -50, w: 250, h: 50 },   // Bottom Right (Entry at 0,0)

    // Inner Walls - complex path
    { x: -150, y: 50, w: 300, h: 50 },
    { x: -150, y: 100, w: 50, h: 100 },
    { x: 50, y: 150, w: 100, h: 50 },
    { x: 50, y: 200, w: 50, h: 100 },
    { x: -250, y: 250, w: 200, h: 50 },
    { x: -50, y: 250, w: 50, h: 150 },
    { x: 50, y: 350, w: 200, h: 50 },
    { x: -200, y: 400, w: 50, h: 100 },
    { x: -100, y: 450, w: 250, h: 50 },
    { x: 100, y: 500, w: 50, h: 100 },
    { x: -250, y: 520, w: 250, h: 30 },
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
  const posRef = useRef({ x: 0, y: 0 });
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
  const [telemetryTick, setTelemetryTick] = useState(0); // trigger UI re-render
  const [servoAngle, setServoAngle] = useState(90);
  const servoRef = useRef(90);
  const sendServo = useCallback((deg: number) => {
    const a = Math.round(Math.max(0, Math.min(180, deg)));
    setServoAngle(a);
    servoRef.current = a;
    if (modeRef.current === "NYATA" && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ servo: a }));
    }
  }, []);

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

  const setMotors = useCallback((l: number, r: number) => {
    leftMotorRef.current = l;
    rightMotorRef.current = r;
    setLeftMotor(l);
    setRightMotor(r);
    if (modeRef.current === "NYATA" && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ leftMotor: l, rightMotor: r }));
    }
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
    
    let nx = dx / maxR;
    let ny = -dy / maxR;
    
    // Deadzone (titik 0) 10% agar lebih stabil saat inisiasi
    if (Math.hypot(nx, ny) < 0.1) {
      nx = 0;
      ny = 0;
      setJoyPos({ x: 0, y: 0 });
    } else {
      setJoyPos({ x: dx, y: dy });
    }

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

  // WebSocket connection to ESP32
  const connectESP = useCallback((ip: string) => {
    if (!ip) return;
    wsRef.current?.close();
    const ws = new WebSocket(`ws://${ip}:81/`);
    ws.onopen = () => setEspConnected(true);
    ws.onclose = () => setEspConnected(false);
    ws.onerror = () => setEspConnected(false);
    ws.onmessage = (e: MessageEvent) => {
      try {
        telemetryRef.current = JSON.parse(e.data as string);
        setTelemetryTick(t => t + 1);
      } catch {}
    };
    wsRef.current = ws;
  }, []);

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

    // LATIHAN: record animated servo sweep into history
    const sweepAngle = 90 + Math.sin(Date.now() / 1000 * 0.6) * 70;
    const servoRad = (sweepAngle - 90) * Math.PI / 180;
    const d = castRayAngle(servoRad, false); // Sensor follows servo

    distanceRef.current = d;
    setSensorDist(d > 0 ? `${(d / 10).toFixed(0)}cm` : "---");

    // Update sweep history for visualization
    if (d > 0) {
      servoHistoryRef.current.push({ angle: sweepAngle, dist: d });
      if (servoHistoryRef.current.length > 100) servoHistoryRef.current.shift();
    }

    const l = leftMotorRef.current;
    const r = rightMotorRef.current;

    // Virtual Buzzer Logic (Matching real robot: beep if <= 5cm in CURRENT sensor direction)
    if (d > 0 && d <= 50) {
      const now = Date.now();
      if (now - lastBuzzerRef.current > 200) {
        setBuzzerActive(p => !p);
        lastBuzzerRef.current = now;
      }
    } else {
      setBuzzerActive(false);
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
    } else {
      // ---- Servo sweep history (LATIHAN) ----
      if (!editMode) {
        // Animated servo: sweep back and forth
        const sweepT = Date.now() / 1000;
        const sweepAngle = 90 + Math.sin(sweepT * 0.6) * 70; // 20°–160°
        const servoRad = (sweepAngle - 90) * Math.PI / 180;
        const distAtServo = castRayAngle(servoRad, false);

        // Draw servo sweep cone (ghost arcs at past positions)
        for (const past of servoHistoryRef.current.slice(-8)) {
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

        // Draw current servo ray
        if (distAtServo > 0) {
          const rayLen = Math.min(distAtServo, MAX_SENSE);
          const ex = p.x + Math.sin(h + servoRad) * rayLen;
          const ey = p.y - Math.cos(h + servoRad) * rayLen;
          ctx.strokeStyle = "rgba(34, 211, 238, 0.4)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.fillStyle = "rgba(34, 211, 238, 0.5)";
          ctx.beginPath();
          ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- VL53L0X laser ray (sweeping with servo) ----
      const sweepT = Date.now() / 1000;
      const sweepAngle = 90 + Math.sin(sweepT * 0.6) * 70;
      const servoRad = (sweepAngle - 90) * Math.PI / 180;
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
    ctx.fillText(`zoom:${s.toFixed(1)} dots:${dotCount}`, 8, vh - 38);
  }, [obstacleCount, sensorDist, editMode, editTool]);

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
                      setObstacleCount(obstaclesRef.current.length);
                      setShowPresets(false);
                      posRef.current = { x: 0, y: 0 };
                      headingRef.current = 0;
                      trailRef.current = [];
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
