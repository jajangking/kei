"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ObjectDetector, FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision";
import { loadDB, saveDB, registerFace, renameFace, deleteFace, recognize, type FaceRecord } from "../facerecog";
import VoiceGroq from "../voicegroq";

import type { Obstacle, EditTool, LogEntry, SimulasiMode, ServoRead, FacingMode, MotorRef } from "./types";
import { GRID_STEP, TRAIL_LEN, MAX_SENSE, LIDAR_FOV, ROBOT_R, ROBOT_H, WHEEL_BASE, ACCEL, FRICTION, ANG_ACCEL, ANG_FRICTION, JOY_DEADZONE, MAX_LOG, SECTORS, PRESETS } from "./constants";
import { snap, collides, rayIntersect, castRayAngle, gridCellKey, getGrid, setGrid, syncGridFromObstacles, findSafeSpawn } from "./utils";
import { drawScene, type DrawState } from "./renderer";
import MonitorPanel from "./monitor-panel";

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

  // Virtual Hardware State
  const [buzzerActive, setBuzzerActive] = useState(false);
  const [leds, setLeds] = useState([0, 0, 0, 0]);
  const lastBuzzerRef = useRef(0);
  const [modul1Active, setModul1Active] = useState(true);
  const modul1ActiveRef = useRef(true);
  const [modul1Braking, setModul1Braking] = useState(false);
  const [modul1Threshold, setModul1Threshold] = useState(30);
  const modul1ThresholdRef = useRef(30);
  const modul1BrakingRef = useRef(false);
  const [modul2Active, setModul2Active] = useState(false);
  const modul2ActiveRef = useRef(false);
  const [modul3Active, setModul3Active] = useState(false);
  const modul3ActiveRef = useRef(false);
  const m3SectorsReadyRef = useRef(false);
  const m3LockAngleRef = useRef(-1);
  const m3BestAngleRef = useRef(-1);
  const m3BestDistRef = useRef(0);
  const m3BestHeadingRef = useRef(0);
  const m3LockedRef = useRef(false);
  const m3RotatingRef = useRef(false);
  const m3TargetHeadingRef = useRef(0);
  const m3SectorAngleRef = useRef<number[]>(SECTORS.map(() => -1));
  const m3MovingForwardRef = useRef(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const sectorDataRef = useRef<number[]>(SECTORS.map(() => -1));
  const [sectorData, setSectorData] = useState<number[]>(SECTORS.map(() => -1));

  // M4: Groq AI Hybrid
  const [modul4Active, setModul4Active] = useState(false);
  const modul4ActiveRef = useRef(false);
  const aiSuggestionRef = useRef(-1);
  const aiSuggestionWeightRef = useRef(0);
  const aiLastCallRef = useRef(0);
  const aiCallCountRef = useRef(0);
  const [aiStatus, setAiStatus] = useState("—");
  const [groqApiKey, setGroqApiKey] = useState("");
  const groqApiKeyRef = useRef("");

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
  const [logTick, setLogTick] = useState(0);
  const logEvent = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    const now = new Date();
    const time = now.toLocaleTimeString("id-ID", { hour12: false });
    logEntriesRef.current.push({ time, msg, type });
    if (logEntriesRef.current.length > MAX_LOG) logEntriesRef.current = logEntriesRef.current.slice(-MAX_LOG);
    setLogTick(t => t + 1);
  }, []);

  // Physical State
  const velRef = useRef({ x: 0, y: 0 });
  const angVelRef = useRef(0);

  // Mode
  const [mode, setMode] = useState<SimulasiMode>("LATIHAN");
  const modeRef = useRef<SimulasiMode>("LATIHAN");
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
  const servoHistoryRef = useRef<ServoRead[]>([]);

  const motorLogThrottleRef = useRef(0);
  const setMotors = useCallback((l: number, r: number) => {
    const prevL = leftMotorRef.current;
    const prevR = rightMotorRef.current;
    if (modeRef.current === "NYATA") {
      const clampMin = (v: number) => v === 0 ? 0 : Math.round(v > 0 ? Math.max(80, v) : Math.min(-80, v));
      l = clampMin(l);
      r = clampMin(r);
    }
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

  // Physics tick
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

      const y = tele?.yaw;
      if (y != null) headingRef.current = y * Math.PI / 180;

      const dots = scanDotsRef.current;
      const gyroMag = Math.abs(tele?.gyroZ ?? 0);
      const scanFrameCount = scanFrameCountRef.current;
      scanFrameCountRef.current = scanFrameCount + 1;
      if (dots.length > 10) {
        const far = dots.filter(dot => Math.hypot(dot.x - p.x, dot.y - p.y) < 600);
        if (far.length < dots.length) scanDotsRef.current = far.length > 10 ? far : dots.slice(-50);
      }
      if (d > 0 && gyroMag < 30 && scanFrameCount % 4 === 0) {
        const hdg = headingRef.current;
        const gridSize = 25;
        const hitX = Math.round((p.x + Math.sin(hdg) * d) / gridSize) * gridSize;
        const hitY = Math.round((p.y - Math.cos(hdg) * d) / gridSize) * gridSize;
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

      const l = leftMotorRef.current;
      const r = rightMotorRef.current;
      if (l !== 0 || r !== 0) {
        const vl = Math.max(-1, Math.min(1, l / 255));
        const vr = Math.max(-1, Math.min(1, r / 255));
        const V = (vl + vr) / 2 * 0.4;
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

      if (modul2ActiveRef.current && dots.length > 20) {
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
    }

    // M3: Navigasi — lock ke angle terjauh (after full sweep, pake real angle bukan cx)
    let m3LockCx = -1;
    if (modul3ActiveRef.current && modul2ActiveRef.current && m3LockedRef.current && m3LockAngleRef.current >= 0) {
      m3LockCx = m3LockAngleRef.current;
    }

    // M3 rotation (both lock-rotate and turn-around)
    if (modul3ActiveRef.current && m3RotatingRef.current) {
      // Servo tracking pas lock-rotate: servo nunjuk ke arah target di world
      if (m3LockCx >= 0) {
        const relDeg = (m3TargetHeadingRef.current - headingRef.current) * 180 / Math.PI;
        const servoSet = Math.max(0, Math.min(180, Math.round(90 + relDeg)));
        if (modeRef.current === "NYATA") { if (Math.abs(servoSet - servoRef.current) >= 3) sendServo(servoSet); }
        else servoRef.current = servoSet;
      }
      let err = m3TargetHeadingRef.current - headingRef.current;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      if (Math.abs(err) < 0.087) { // ~5°
        m3RotatingRef.current = false;
        if (m3LockCx >= 0) {
          // Rotation done — reset angular velocity zero biar ga drift
          angVelRef.current = 0;
          velRef.current = { x: 0, y: 0 };
          // servo ke 90, maju ke arah sector
          if (modeRef.current === "NYATA") sendServo(90);
          else servoRef.current = 90;
          m3MovingForwardRef.current = true;
          setMotors(180, 180);
        } else {
          setMotors(0, 0);
        }
      } else {
        const power = Math.min(255, Math.max(80, Math.abs(err) * 300));
        if (err > 0) setMotors(Math.round(power), -Math.round(power));
        else setMotors(-Math.round(power), Math.round(power));
      }
    }
    // M3 forward — maju lurus ke arah sector setelah rotation done
    if (modul3ActiveRef.current && m3MovingForwardRef.current) {
      const dNow = distanceRef.current;
      if (dNow > 0 && dNow <= modul1ThresholdRef.current) {
        // Nyampe tembok → stop, rescan dari awal
        m3MovingForwardRef.current = false;
        m3LockedRef.current = false;
        m3LockAngleRef.current = -1;
        m3SectorsReadyRef.current = false;
        m3SectorAngleRef.current = SECTORS.map(() => -1);
        sectorDataRef.current = SECTORS.map(() => -1);
        m3BestDistRef.current = 0;
        m3BestAngleRef.current = -1;
        setMotors(0, 0);
        logEvent("M3 sampai tembok → rescan", "nav");
      } else {
        // Maju lurus
        setMotors(180, 180);
      }
    }
    // Servo sweep (tetep jalan selama turn-around, mati cuma pas lock-rotate)
    if (modul2ActiveRef.current) {
      if (m3LockCx >= 0 && m3RotatingRef.current) {
        // lock-rotate: servo tracking ke target heading
        const relDeg = (m3TargetHeadingRef.current - headingRef.current) * 180 / Math.PI;
        const servoSet = Math.max(0, Math.min(180, Math.round(90 + relDeg)));
        if (modeRef.current === "NYATA") { if (Math.abs(servoSet - servoRef.current) >= 3) sendServo(servoSet); }
        else servoRef.current = servoSet;
      } else if (m3LockCx < 0) {
        // sweep normal (termasuk pas turn-around)
        let newAngle = Math.round(90 + Math.sin(Date.now() / 1000 * 0.7) * 70);
        if (modeRef.current === "NYATA") {
          if (Math.abs(newAngle - servoRef.current) >= 3) sendServo(newAngle);
        } else {
          servoRef.current = newAngle;
        }
      }
    }

    // LATIHAN: cast laser
    if (modeRef.current !== "NYATA") {
      const servoRad = (servoRef.current - 90) * Math.PI / 180;
      const d = castRayAngle(servoRad, posRef.current, headingRef.current, obstaclesRef.current, scanDotsRef.current, true);
      distanceRef.current = d;
      setSensorDist(d > 0 ? `${(d / 10).toFixed(0)}cm` : "---");

      if (modul2ActiveRef.current && d > 0) {
        const angleDiff = Math.abs(servoRef.current - lastSweepAngleRef.current);
        if (lastSweepAngleRef.current < 0 || angleDiff >= 3) {
          lastSweepAngleRef.current = servoRef.current;
          const sx = p.x + Math.sin(h + servoRad) * d;
          const sy = p.y - Math.cos(h + servoRad) * d;
          sweepPointsRef.current.push({ x: sx, y: sy });
          if (sweepPointsRef.current.length > 2000) sweepPointsRef.current = sweepPointsRef.current.slice(-1500);
        }
      }
      if (d > 0) {
        servoHistoryRef.current.push({ angle: servoRef.current, dist: d });
        if (servoHistoryRef.current.length > 100) servoHistoryRef.current.shift();
      }
      if (modul2ActiveRef.current && d > 0) {
        const sr = servoRad;
        const rayAngle = headingRef.current + sr;
        const rx = Math.sin(rayAngle);
        const ry = -Math.cos(rayAngle);
        const step = GRID_STEP;
        const steps = Math.floor(d / step);
        for (let i = 0; i < steps; i++) {
          const sx = p.x + rx * step * i;
          const sy = p.y + ry * step * i;
          if (getGrid(occupancyRef.current, sx, sy) === 0) setGrid(occupancyRef.current, sx, sy, 1);
        }
        const hitX = p.x + rx * d;
        const hitY = p.y + ry * d;
        if (getGrid(occupancyRef.current, hitX, hitY) === 0) setGrid(occupancyRef.current, hitX, hitY, 2);
      }
      {
        if (getGrid(occupancyRef.current, posRef.current.x, posRef.current.y) === 0)
          setGrid(occupancyRef.current, posRef.current.x, posRef.current.y, 1);
      }
      if (modul2ActiveRef.current) {
        for (let i = 0; i < SECTORS.length; i++) {
          const sd = sectorDataRef.current[i];
          if (sd <= 0 || sd >= MAX_SENSE) continue;
          const aRad = (SECTORS[i].cx - 90) * Math.PI / 180;
          const rh = headingRef.current;
          const hx = p.x + Math.sin(rh + aRad) * sd;
          const hy = p.y - Math.cos(rh + aRad) * sd;
          if (getGrid(occupancyRef.current, hx, hy) === 0) setGrid(occupancyRef.current, hx, hy, 2);
        }
      }
    }

    if (modeRef.current === "NYATA" && distanceRef.current > 0) {
      setSensorDist(`${(distanceRef.current / 10).toFixed(0)}cm`);
    }

    // M3: track best angle + evaluate lock (after cast, distance fresh)
    if (modul3ActiveRef.current && modul2ActiveRef.current && !m3LockedRef.current) {
      const d = distanceRef.current;
      if (d > 0 && d > m3BestDistRef.current) {
        m3BestDistRef.current = d;
        m3BestAngleRef.current = servoRef.current;
        m3BestHeadingRef.current = headingRef.current;
      }
      if (!m3SectorsReadyRef.current) {
        m3SectorsReadyRef.current = sectorDataRef.current.every(v => v > 0);
      }
      if (m3SectorsReadyRef.current && !m3LockedRef.current) {
        const sd = sectorDataRef.current;
        // Cari longest contiguous run of sectors distance > 120
        let bestRunStart = -1, bestRunLen = 0;
        let curStart = -1, curLen = 0;
        for (let i = 0; i < SECTORS.length; i++) {
          if (sd[i] > 200) {
            if (curStart < 0) curStart = i;
            curLen++;
            if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; }
          } else { curStart = -1; curLen = 0; }
        }
        if (bestRunLen >= 2) {
          // Weighted average of real angle per sector (by distance)
          let sumW = 0, sumA = 0;
          for (let i = bestRunStart; i < bestRunStart + bestRunLen; i++) {
            const w = sd[i];
            const ang = m3SectorAngleRef.current[i];
            if (ang < 0) continue;
            sumW += w; sumA += w * ang;
          }
          const centerAngle = sumW > 0 ? sumA / sumW : SECTORS[bestRunStart + Math.floor(bestRunLen / 2)].cx;
          m3LockAngleRef.current = centerAngle;
          m3LockedRef.current = true;
          m3RotatingRef.current = true;
          const lockedRad = (centerAngle - 90) * Math.PI / 180;
          let t = headingRef.current + lockedRad;
          while (t > Math.PI) t -= 2 * Math.PI;
          while (t < -Math.PI) t += 2 * Math.PI;
          m3TargetHeadingRef.current = t;
          logEvent(`M3 lock → ${centerAngle.toFixed(1)}° run=${bestRunLen}`, "nav");
        } else {
          // Ga dapet run — muter balik, scan ulang
          m3RotatingRef.current = true;
          let t = headingRef.current + Math.PI; // 180°
          while (t > Math.PI) t -= 2 * Math.PI;
          while (t < -Math.PI) t += 2 * Math.PI;
          m3TargetHeadingRef.current = t;
          m3SectorsReadyRef.current = false;
          sectorDataRef.current = SECTORS.map(() => -1);
          m3SectorAngleRef.current = SECTORS.map(() => -1);
          m3BestDistRef.current = 0;
          m3BestAngleRef.current = -1;
          logEvent("M3: ga dapet run → balik 180°", "nav");
        }
      }
    }

    // Sector data (jangan timpa pas M3 lock)
    if (modul2ActiveRef.current && !m3LockedRef.current) {
      const s = servoRef.current;
      const currentDist = distanceRef.current;
      for (let i = 0; i < SECTORS.length; i++) {
        const sec = SECTORS[i];
        if (s >= sec.min && s <= sec.max) {
          const dist = currentDist > 0 ? currentDist : MAX_SENSE;
          // Record MAX distance per sector (jangan timpa dgn yg lebih pendek)
          if (dist > sectorDataRef.current[i]) {
            sectorDataRef.current[i] = dist;
            m3SectorAngleRef.current[i] = s;
            setSectorData([...sectorDataRef.current]);
          }
          if (currentDist > 0) {
            const qDist = Math.round(currentDist / 50) * 50;
            const logKey = `${sec.id}_${qDist}`;
            if (logKey !== (window as any).__lastSensorLog) {
              (window as any).__lastSensorLog = logKey;
              logEvent(`${sec.id} ${s}° → ${(currentDist/10).toFixed(0)}cm`, "sensor");
            }
          }
          break;
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

    // Modul 1: Collision
    const movingForward = l > 30 && r > 30;
    if (modul1ActiveRef.current && d_now > 0 && d_now <= modul1ThresholdRef.current && movingForward) {
      l = 0; r = 0;
      setMotors(0, 0);
      leftMotorRef.current = 0;
      rightMotorRef.current = 0;
      if (!modul1BrakingRef.current) {
        setModul1Braking(true);
        modul1BrakingRef.current = true;
        logEvent(`M1 BRAKE! jarak=${(d_now/10).toFixed(0)}cm threshold=${(modul1ThresholdRef.current/10).toFixed(0)}cm`, "warn");
      }
    } else {
      setModul1Braking(false);
      modul1BrakingRef.current = false;
    }

    // Physical simulation (LATIHAN only)
    if (modeRef.current !== "NYATA") {
      const vl_target = Math.max(-1, Math.min(1, l / 255));
      const vr_target = Math.max(-1, Math.min(1, r / 255));
      const V_target = (vl_target + vr_target) / 2 * 1.5;
      const w_target = (vl_target - vr_target) / WHEEL_BASE * 1.2;
      const targetVx = V_target * Math.sin(h);
      const targetVy = -V_target * Math.cos(h);

      velRef.current.x += (targetVx - velRef.current.x) * ACCEL;
      velRef.current.y += (targetVy - velRef.current.y) * ACCEL;
      angVelRef.current += (w_target - angVelRef.current) * ANG_ACCEL;

      if (l === 0 && r === 0) {
        velRef.current.x *= FRICTION;
        velRef.current.y *= FRICTION;
        angVelRef.current *= ANG_FRICTION;
      }

      const dx = velRef.current.x;
      const dy = velRef.current.y;
      const dh = angVelRef.current;
      gyroRef.current = dh;

      if (!collides(p.x + dx, p.y, obstaclesRef.current)) p.x += dx;
      else velRef.current.x *= -0.2;

      if (!collides(p.x, p.y + dy, obstaclesRef.current)) p.y += dy;
      else velRef.current.y *= -0.2;

      headingRef.current = h + dh;
    }

    const trail = trailRef.current;
    if (trail.length === 0 || Math.hypot(trail[trail.length - 1].x - p.x, trail[trail.length - 1].y - p.y) > 3) {
      trail.push({ x: p.x, y: p.y });
      if (trail.length > TRAIL_LEN) trail.shift();
    }
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
      leftMotor: leftMotorRef.current,
      rightMotor: rightMotorRef.current,
      sensorDist,
      sensorDistance: distanceRef.current,
      servoAngle: servoRef.current,
      mode: modeRef.current,
      editMode,
      editTool,
      obstacles: obstaclesRef.current,
      drawStart: drawStartRef.current,
      drawEnd: drawEndRef.current,
      scanDots: scanDotsRef.current,
      sweepPoints: sweepPointsRef.current,
      servoHistory: servoHistoryRef.current,
      modul1Active,
      modul1Braking,
      modul1Threshold,
      modul2Active,
      modul4Active,
      leds,
      buzzerActive,
      camActive,
      detections: detectionsRef.current,
      recognizedFace: recognizedFaceRef.current,
      sectorDataRef: sectorDataRef.current,
      aiStatus,
      aiCallCount: aiCallCountRef.current,
    };
    drawScene(ctx, st);
  }, [
    sensorDist, editMode, editTool,
    modul1Active, modul1Braking, modul1Threshold,
    modul2Active, modul4Active,
    leds, buzzerActive, camActive, aiStatus,
  ]);

  // Pointer handlers
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
    }
  }, [editMode, editTool]);

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
  }, [tick, draw, setMotors, editMode, sendServo]);

  // Load LABIRIN preset on mount
  useEffect(() => {
    if (modeRef.current !== "NYATA") {
      obstaclesRef.current = PRESETS.LABIRIN.map(o => ({ ...o }));
      setObstacleCount(obstaclesRef.current.length);
      occupancyRef.current = new Map();
      syncGridFromObstacles(occupancyRef.current, obstaclesRef.current);
    }
    const safePos = findSafeSpawn(obstaclesRef.current);
    posRef.current = safePos;
    headingRef.current = 0;
    trailRef.current = [];
    sweepPointsRef.current = [];
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
  useEffect(() => { modul1ActiveRef.current = modul1Active; }, [modul1Active]);
  useEffect(() => { modul1ThresholdRef.current = modul1Threshold; }, [modul1Threshold]);
  useEffect(() => { modul1BrakingRef.current = modul1Braking; }, [modul1Braking]);
  useEffect(() => { modul2ActiveRef.current = modul2Active; }, [modul2Active]);
  useEffect(() => { modul3ActiveRef.current = modul3Active; const _r = () => { m3SectorsReadyRef.current = false; m3LockAngleRef.current = -1; m3BestAngleRef.current = -1; m3BestDistRef.current = 0; m3LockedRef.current = false; m3RotatingRef.current = false; sectorDataRef.current = SECTORS.map(() => -1); m3SectorAngleRef.current = SECTORS.map(() => -1); }; if (!modul3Active) _r(); else _r(); }, [modul3Active]);
  useEffect(() => { modul4ActiveRef.current = modul4Active; }, [modul4Active]);
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
                onClick={() => setModul3Active(p => !p)}
                className={`px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border transition-colors active:scale-90 ${
                  modul3Active
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-zinc-800 border-zinc-700 text-zinc-500"
                }`}
              >
                {modul3Active ? "ON" : "OFF"}
              </button>
            </div>
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
              modul1Active,
              modul2Active,
              modul3Active,
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
                      occupancyRef.current = new Map();
                      syncGridFromObstacles(occupancyRef.current, obstaclesRef.current);
                      const safePos = findSafeSpawn(obstaclesRef.current);
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

      {/* Edit hint */}
      {editMode && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 text-[8px] font-mono text-zinc-500 bg-zinc-900/80 px-3 py-1 rounded-full backdrop-blur-sm border border-white/5 whitespace-nowrap">
          {editTool === "place" ? "Tap & drag buat gambar halangan" : "Tap halangan buat hapus"}
        </div>
      )}

      {/* Mode + ESP */}
      {!editMode && (
        <div className="fixed top-3 left-3 flex flex-col gap-1.5 items-start">
          <button
            onClick={() => {
              const next: SimulasiMode = mode === "NYATA" ? "LATIHAN" : "NYATA";
              setMode(next);
              modeRef.current = next;
              if (next === "NYATA") {
                obstaclesRef.current = [];
                setObstacleCount(0);
              } else {
                obstaclesRef.current = PRESETS.LABIRIN.map(o => ({ ...o }));
                setObstacleCount(obstaclesRef.current.length);
                syncGridFromObstacles(occupancyRef.current, obstaclesRef.current);
              }
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
