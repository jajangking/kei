"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { LearningDB, type SensorSnapshot, type MotorCmd } from "@/app/lib/learn";

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
    { x: -200, y: -150, w: 50, h: 500 },
    { x: 200, y: -150, w: 50, h: 200 },
    { x: 100, y: 50, w: 50, h: 300 },
    { x: -150, y: 250, w: 200, h: 50 },
    { x: -50, y: 350, w: 200, h: 50 },
    { x: -150, y: 400, w: 50, h: 100 },
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
  const lastSnapRef = useRef<SensorSnapshot | null>(null);
  const lastCmdRef = useRef<MotorCmd | null>(null);
  const didAutoPredictRef = useRef(false);

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

  // Gear system
  const GEAR_LIMITS = [0, 80, 170, 255];
  const [gear, setGear] = useState(3);
  const gearRef = useRef(3);

  const applyGear = useCallback((l: number, r: number): [number, number] => {
    const limit = GEAR_LIMITS[gearRef.current];
    if (limit === 0) {
      // N: only rotation allowed (motors opposite direction)
      if (l * r > 0) return [0, 0];
      return [
        Math.max(-80, Math.min(80, l)),
        Math.max(-80, Math.min(80, r)),
      ];
    }
    return [
      Math.max(-limit, Math.min(limit, l)),
      Math.max(-limit, Math.min(limit, r)),
    ];
  }, []);

  // Supervised learning (Belajar)
  const learnDbRef = useRef<LearningDB | null>(null);
  const [belajarMode, setBelajarMode] = useState(false);
  const belajarRef = useRef(false);
  const [expInfo, setExpInfo] = useState("");

  // State machine for autonomous mode
  type AutoState = "DRIVE" | "SCAN" | "TURN" | "BACKUP";
  const autoStateRef = useRef<AutoState>("DRIVE");
  const scanTimerRef = useRef(0);
  const scanDirRef = useRef(0); // clearest angle offset from scan
  const [stateLabel, setStateLabel] = useState("");
  const smoothRef = useRef({ left: 0, right: 0 });

  // Sector map: heading → distance
  type Sector = { heading: number; dist: number };
  const sectorMapRef = useRef<Sector[]>([]);
  const scanHeadingRef = useRef(0);
  const scanCompleteRef = useRef(false);
  const scanFrameCountRef = useRef(0);

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
    const [cl, cr] = applyGear(l, r);
    leftMotorRef.current = cl;
    rightMotorRef.current = cr;
    setLeftMotor(cl);
    setRightMotor(cr);
    if (modeRef.current === "NYATA" && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ leftMotor: cl, rightMotor: cr }));
    }
  }, [applyGear]);

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

  // ESP sensor snapshot for NYATA mode
  const getSensorSnapshot = useCallback((): SensorSnapshot => {
    if (modeRef.current === "NYATA") {
      const tele = telemetryRef.current;
      const front = tele?.distance != null && tele.distance >= 0
        ? Math.min(tele.distance / 10, MAX_SENSE)
        : -1;
      const gyro = (tele?.gyroZ ?? 0) * 0.002;
      const wall = front >= 0 && front < 50;
      return {
        farLeft: front, midLeft: front, nearLeft: front,
        front,
        nearRight: front, midRight: front, farRight: front,
        gyro,
        wallLeft: wall,
        wallRight: wall,
      };
    }
    const farL = castRayAngle(-0.75);
    const midL = castRayAngle(-0.5);
    const nearL = castRayAngle(-0.25);
    const front = castRayAngle(0);
    const nearR = castRayAngle(0.25);
    const midR = castRayAngle(0.5);
    const farR = castRayAngle(0.75);
    return {
      farLeft: farL, midLeft: midL, nearLeft: nearL,
      front,
      nearRight: nearR, midRight: midR, farRight: farR,
      gyro: gyroRef.current,
      wallLeft: nearL >= 0 && nearL < 50,
      wallRight: nearR >= 0 && nearR < 50,
    };
  }, []);

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

    const d = castLaser();
    distanceRef.current = d;
    setSensorDist(d > 0 ? `${(d / 10).toFixed(0)}cm` : "---");

    const l = leftMotorRef.current;
    const r = rightMotorRef.current;
    if (l === 0 && r === 0) { gyroRef.current *= 0.9; return; }

    // Differential drive
    const MAX_SPEED = 2;
    const vl = Math.max(-1, Math.min(1, l / 255));
    const vr = Math.max(-1, Math.min(1, r / 255));
    const V = (vl + vr) / 2 * MAX_SPEED;
    const w = (vl - vr) / WHEEL_BASE * MAX_SPEED;
    gyroRef.current = w;

    const dx = V * Math.sin(h);
    const dy = -V * Math.cos(h);
    const dh = w;

    // Collision check per axis
    if (!collides(p.x + dx, p.y)) p.x += dx;
    if (!collides(p.x, p.y + dy)) p.y += dy;
    headingRef.current = h + dh;

    // Record experience when user drives in belajar mode
    if (belajarRef.current && joyActiveRef.current) {
      if (!learnDbRef.current) learnDbRef.current = new LearningDB();
      const snap = getSensorSnapshot();
      const rating: -1 | 1 = (d < 0 || d > 50) ? 1 : -1;
      learnDbRef.current.record(snap, { left: l, right: r }, rating);
      setExpInfo(`exp:${learnDbRef.current.size}`);
    }

    const trail = trailRef.current;
    if (trail.length === 0 || Math.hypot(trail[trail.length - 1].x - p.x, trail[trail.length - 1].y - p.y) > 3) {
      trail.push({ x: p.x, y: p.y });
      if (trail.length > TRAIL_LEN) trail.shift();
    }
  }, [getSensorSnapshot]);

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
      const alpha = editMode || belajarRef.current || modeRef.current === "NYATA" ? (o.seen ? 0.6 : 0.15) : 0.6;
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

    // ---- Sector map (scan memory) for NYATA ----
    if (modeRef.current === "NYATA" && autoStateRef.current === "SCAN" && sectorMapRef.current.length > 0) {
      for (const sec of sectorMapRef.current) {
        const d = Math.min(Math.max(sec.dist, 0), MAX_SENSE);
        const ex = p.x + Math.sin(sec.heading) * d;
        const ey = p.y - Math.cos(sec.heading) * d;
        ctx.strokeStyle = "rgba(34, 211, 238, 0.2)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(34, 211, 238, 0.25)";
        ctx.beginPath();
        ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- VL53L0X sensor visualization ----
    if (modeRef.current === "NYATA") {
      // Real ESP mode: only 1 front sensor, draw clear real-time ray
      const distVal = distanceRef.current;
      if (distVal > 0) {
        const rayLen = Math.min(distVal, MAX_SENSE);
        const ex = p.x + Math.sin(h) * rayLen;
        const ey = p.y - Math.cos(h) * rayLen;
        ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.min(rayLen, 100), h - LIDAR_FOV / 2 - Math.PI / 2, h + LIDAR_FOV / 2 - Math.PI / 2);
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
        ctx.fillText(`ESP: ${distVal.toFixed(0)}cm`, ex + 6, ey - 6);
      } else {
        ctx.fillStyle = "rgba(239, 68, 68, 0.5)";
        ctx.font = "bold 9px monospace";
        ctx.fillText("menunggu ESP...", p.x + 10, p.y - 10);
      }
    } else {
      // ---- Simulated servo sweep rays ----
      if (!editMode) {
        const scanAngles = autoStateRef.current === "SCAN"
          ? [-1, -0.5, 0, 0.5, 1]
          : [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];
        for (const a of scanAngles) {
          const d = castRayAngle(a, false);
          if (d > 0) {
            const rayLen = Math.min(d, MAX_SENSE);
            const ex = p.x + Math.sin(h + a) * rayLen;
            const ey = p.y - Math.cos(h + a) * rayLen;
            const isCenter = Math.abs(a) < 0.01;
            ctx.strokeStyle = isCenter
              ? "rgba(239, 68, 68, 0.25)"
              : "rgba(250, 204, 21, 0.12)";
            ctx.lineWidth = isCenter ? 1.5 : 1;
            ctx.setLineDash(isCenter ? [] : [3, 4]);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(250, 204, 21, 0.2)";
            ctx.beginPath();
            ctx.arc(ex, ey, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // ---- VL53L0X laser ray (front) ----
      const distVal = distanceRef.current;
      if (distVal > 0) {
        const rayLen = Math.min(distVal, MAX_SENSE);
        const ex = p.x + Math.sin(h) * rayLen;
        const ey = p.y - Math.cos(h) * rayLen;
        ctx.fillStyle = "rgba(239, 68, 68, 0.03)";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, Math.min(rayLen, 100), h - LIDAR_FOV / 2 - Math.PI / 2, h + LIDAR_FOV / 2 - Math.PI / 2);
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

    // ---- Robot (2WD chassis) ----
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(h - Math.PI / 2);
    const hw = ROBOT_W / 2;
    const hh = ROBOT_H / 2;
    // Chassis body
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(-hw, -hh, ROBOT_W, ROBOT_H);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-hw, -hh, ROBOT_W, ROBOT_H);
    // Front direction indicator
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(-3, -hh - 3, 6, 4);
    // Left wheel
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(-hw - 2, -hh * 0.35, 2, hh * 0.7);
    // Right wheel
    ctx.fillRect(hw, -hh * 0.35, 2, hh * 0.7);
    // Castor ball (belakang)
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.arc(0, hh * 0.5, 2, 0, Math.PI * 2);
    ctx.fill();
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
    const gearLabel = gear === 0 ? "N" : String(gear);
    const gearHint = gear === 0 ? "PUTAR" : `${GEAR_LIMITS[gear]}`;
    ctx.fillStyle = gear === 0 ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)";
    ctx.font = "bold 14px monospace";
    ctx.fillText(gearLabel, vw / 2 - 5, 18);
    ctx.font = "6px monospace";
    ctx.fillText(gearHint, vw / 2 - 8, 26);
    ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
    ctx.fillText(`VL53L0X: ${sensorDist}`, 8, vh - 28);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    const dotCount = scanDotsRef.current.length;
    ctx.fillText(`zoom:${s.toFixed(1)} dots:${dotCount}`, 8, vh - 38);
    // Show sector map size when scanning
    if (autoStateRef.current === "SCAN" && sectorMapRef.current.length > 0) {
      ctx.fillStyle = "rgba(34, 211, 238, 0.12)";
      ctx.fillText(`sektor:${sectorMapRef.current.length}`, 8, vh - 48);
    }

    // State machine label
    if (belajarRef.current && !editMode) {
      ctx.fillStyle = autoStateRef.current === "DRIVE"
        ? "rgba(34,197,94,0.25)"
        : autoStateRef.current === "SCAN"
          ? "rgba(250,204,21,0.25)"
          : "rgba(239,68,68,0.25)";
      ctx.font = "bold 11px monospace";
      ctx.fillText(autoStateRef.current, vw - 80, 16);
    }
  }, [obstacleCount, sensorDist, editMode, editTool, gear]);

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
      // Gear shift: Q/E or number keys
      if (e.key === "q") { const g = Math.max(0, gearRef.current - 1); setGear(g); gearRef.current = g; }
      if (e.key === "e") { const g = Math.min(3, gearRef.current + 1); setGear(g); gearRef.current = g; }
      if (e.key === "1") { setGear(1); gearRef.current = 1; }
      if (e.key === "2") { setGear(2); gearRef.current = 2; }
      if (e.key === "3") { setGear(3); gearRef.current = 3; }
      if (e.key === "n") { setGear(0); gearRef.current = 0; }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      if (keys.size === 0 && !joyActiveRef.current) setMotors(0, 0);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Physics + render loop
    let running = true;
    const setAutoState = (s: AutoState) => {
      if (autoStateRef.current !== s) {
        autoStateRef.current = s;
        setStateLabel(s);
        scanTimerRef.current = 0;
      }
    };
    const scanSector = (angleOffset: number) => castRayAngle(angleOffset);

    const loop = () => {
      if (!running) return;

      if (belajarRef.current && !joyActiveRef.current && !editMode && !(modeRef.current === "NYATA" && !telemetryRef.current)) {
        if (!learnDbRef.current) learnDbRef.current = new LearningDB();

        const snap = getSensorSnapshot();
        const front = snap.front;

        switch (autoStateRef.current) {
          case "DRIVE": {
            // Proportional speed: slow down as we approach obstacle
            let speed = 200;
            if (front >= 0 && front < 100) {
              speed = Math.round(front * 2.5); // 250 at 100cm, 62 at 25cm
              speed = Math.max(60, Math.min(200, speed));
            }
            const targetL = speed;
            const targetR = speed;

            // Smooth motor command (EMA)
            const s = smoothRef.current;
            const alpha = 0.35;
            s.left = Math.round(s.left * (1 - alpha) + targetL * alpha);
            s.right = Math.round(s.right * (1 - alpha) + targetR * alpha);
            setMotors(s.left, s.right);

            didAutoPredictRef.current = true;
            lastSnapRef.current = snap;
            lastCmdRef.current = { left: s.left, right: s.right };

            if (front >= 0 && front < 25) {
              setAutoState("SCAN");
              setMotors(0, 0);
              s.left = 0; s.right = 0;
            }
            break;
          }

          case "SCAN": {
            setMotors(0, 0);
            didAutoPredictRef.current = false;
            smoothRef.current = { left: 0, right: 0 };
            scanTimerRef.current++;

            if (modeRef.current === "NYATA") {
              // NYATA: sweep by rotating and recording distances at each heading
              if (scanTimerRef.current === 1) {
                scanDotsRef.current = []; // fresh map setiap scan
                sectorMapRef.current = [];
                scanHeadingRef.current = headingRef.current;
                scanCompleteRef.current = false;
              }
              const tickInSweep = scanTimerRef.current;
              if (tickInSweep % 4 === 0 && !scanCompleteRef.current) {
                sectorMapRef.current.push({ heading: headingRef.current, dist: front });
              }
              // Small rotation step to sweep
              if (tickInSweep < 24) {
                setMotors(80, -80);
              } else {
                setMotors(0, 0);
                if (!scanCompleteRef.current) {
                  scanCompleteRef.current = true;
                  // Pick best sector from map
                  let bestH = headingRef.current;
                  let bestD = -1;
                  for (const s of sectorMapRef.current) {
                    if (s.dist > bestD) { bestD = s.dist; bestH = s.heading; }
                  }
                  scanDirRef.current = bestH;

                  if (bestD < 0 || bestD > 40) {
                    setAutoState("TURN");
                  } else {
                    setAutoState("BACKUP");
                  }
                }
              }
            } else {
              // LATIHAN: instant ray scan
              if (scanTimerRef.current === 1) {
                const angles = [-1, -0.5, 0, 0.5, 1];
                let bestAngle = 0;
                let bestDist = -1;
                for (const a of angles) {
                  const d = scanSector(a);
                  if (d > bestDist) { bestDist = d; bestAngle = a; }
                }
                scanDirRef.current = bestAngle;
              }
              if (scanTimerRef.current > 6) {
                const d = front;
                if (d < 0 || d > 40) {
                  setAutoState("TURN");
                } else {
                  setAutoState("BACKUP");
                }
              }
            }
            break;
          }

          case "TURN": {
            didAutoPredictRef.current = false;
            scanTimerRef.current++;

            // Use sector map to decide turn direction
            let targetH = scanDirRef.current;
            const currentH = headingRef.current;
            let diff = targetH - currentH;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;

            const turnSpeed = Math.min(150, Math.max(60, Math.round(Math.abs(diff) * 50)));
            if (Math.abs(diff) > 0.1) {
              const sign = diff > 0 ? 1 : -1;
              const s = smoothRef.current;
              const targetL = -turnSpeed * sign;
              const targetR = turnSpeed * sign;
              const alpha = 0.4;
              s.left = Math.round(s.left * (1 - alpha) + targetL * alpha);
              s.right = Math.round(s.right * (1 - alpha) + targetR * alpha);
              setMotors(s.left, s.right);
            } else {
              setMotors(0, 0);
              smoothRef.current = { left: 0, right: 0 };
            }

            const f = modeRef.current === "NYATA" ? getSensorSnapshot().front : castRayAngle(0);
            if ((f < 0 || f > 50) && (scanTimerRef.current > 5 || Math.abs(diff) < 0.15)) {
              setAutoState("DRIVE");
              smoothRef.current = { left: 0, right: 0 };
            }
            if (scanTimerRef.current > 50) {
              setAutoState("DRIVE");
              smoothRef.current = { left: 0, right: 0 };
            }
            break;
          }

          case "BACKUP": {
            const s = smoothRef.current;
            s.left = Math.round(s.left * 0.5 + -120 * 0.5);
            s.right = Math.round(s.right * 0.5 + -80 * 0.5);
            setMotors(s.left, s.right);
            didAutoPredictRef.current = false;
            scanTimerRef.current++;

            if (scanTimerRef.current > 16) {
              setAutoState("SCAN");
              smoothRef.current = { left: 0, right: 0 };
            }
            break;
          }
        }
      } else if (!joyActiveRef.current && !editMode) {
        let lm = 0, rm = 0;
        if (keys.has("w") || keys.has("arrowup")) { lm = 255; rm = 255; }
        if (keys.has("s") || keys.has("arrowdown")) { lm = -255; rm = -255; }
        if (keys.has("a") || keys.has("arrowleft")) { lm = -255; rm = 255; }
        if (keys.has("d") || keys.has("arrowright")) { lm = 255; rm = -255; }
        if (keys.has(" ")) { lm = 0; rm = 0; }
        setMotors(lm, rm);
        didAutoPredictRef.current = false;
      }
      tick();

      // Auto-rate the last autonomous DRIVE action
      if (didAutoPredictRef.current && lastSnapRef.current && lastCmdRef.current) {
        didAutoPredictRef.current = false;
        const dist = distanceRef.current;
        const rating: -1 | 1 = (dist < 0 || dist > 50) ? 1 : -1;
        learnDbRef.current?.record(lastSnapRef.current, lastCmdRef.current, rating);
        setExpInfo(`exp:${learnDbRef.current?.size ?? 0}`);
        lastSnapRef.current = null;
        lastCmdRef.current = null;
      }

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
  }, [tick, draw, setMotors, editMode, applyGear]);

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

      {/* AI toolbar */}
      {!editMode && (
        <div className="fixed top-3 right-3 flex flex-col gap-1.5 items-end">
          {/* Belajar (supervised learning) */}
          <button
            onClick={() => {
              const next = !belajarMode;
              setBelajarMode(next);
              belajarRef.current = next;
              if (!learnDbRef.current) learnDbRef.current = new LearningDB();
              setExpInfo(`exp:${learnDbRef.current.size}`);
              if (next) {
                autoStateRef.current = "DRIVE";
                setStateLabel("DRIVE");
                scanTimerRef.current = 0;
              }
            }}
            className={`px-2 py-1 rounded-full text-[9px] font-mono font-bold border active:scale-90 ${
              belajarMode
                ? "bg-purple-600 border-purple-500 text-white"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
            }`}
          >
            BELAJAR {belajarMode ? "ON" : "OFF"}
          </button>

          {belajarMode && (
            <>
              <div className="text-[7px] font-mono text-zinc-600 bg-zinc-900/40 px-2 py-0.5 rounded-full">
                {expInfo}
              </div>
              <div className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full ${
                stateLabel === "DRIVE" ? "text-emerald-400 bg-emerald-900/40" :
                stateLabel === "SCAN" ? "text-yellow-400 bg-yellow-900/40" :
                stateLabel === "TURN" ? "text-orange-400 bg-orange-900/40" :
                "text-red-400 bg-red-900/40"
              }`}>
                {stateLabel || "—"}
              </div>
              <button
                onClick={() => {
                  learnDbRef.current?.forget();
                  setExpInfo("lupa!");
                  scanDotsRef.current = [];
                  obstaclesRef.current.forEach(o => { o.seen = false; });
                }}
                className="px-2 py-0.5 rounded-full bg-red-900/40 border border-red-800/50 text-red-400 text-[7px] font-mono active:scale-90"
              >
                LUPA
              </button>
              <button
                onClick={() => { scanDotsRef.current = []; }}
                className="px-2 py-0.5 rounded-full bg-yellow-900/40 border border-yellow-800/50 text-yellow-400 text-[7px] font-mono active:scale-90"
              >
                HAPUS DOT
              </button>
            </>
          )}
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
                        <span>servo: {t.servo ?? "—"}°</span>
                        <span>baterai: {t.battery ?? "—"}</span>
                        <span>RSSI: {t.rssi ?? "—"}dBm</span>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Gear controls */}
      {!editMode && (
        <div className="fixed bottom-48 left-1/2 -translate-x-1/2 flex gap-2">
          {[0, 1, 2, 3].map(g => (
            <button
              key={g}
              onClick={() => { setGear(g); gearRef.current = g; }}
              className={`size-8 rounded-full text-[11px] font-mono font-bold border active:scale-90 transition-colors ${
                gear === g
                  ? g === 0
                    ? "bg-red-600 border-red-500 text-white"
                    : "bg-emerald-600 border-emerald-500 text-white"
                  : "bg-zinc-800 border-zinc-700 text-zinc-500"
              }`}
            >
              {g === 0 ? "N" : g}
            </button>
          ))}
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
