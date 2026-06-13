"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { LearningDB, type SensorSnapshot, type MotorCmd } from "@/app/lib/learn";

const GRID_STEP = 50;
const TRAIL_LEN = 40;
const MAX_SENSE = 400;
const HCSR04_FOV = 15 * Math.PI / 180;

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  const obstaclesRef = useRef<Obstacle[]>([]);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawEndRef = useRef<{ x: number; y: number } | null>(null);
  const [obstacleCount, setObstacleCount] = useState(0);
  const distanceRef = useRef(-1);
  const [sensorDist, setSensorDist] = useState("---");

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

  const collides = (x: number, y: number, radius = 6) => {
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

  const castRayAngle = (angleOffset: number) => {
    const p = posRef.current;
    const h = headingRef.current + angleOffset;
    const rx = Math.sin(h);
    const ry = -Math.cos(h);
    let closest = -1;
    for (const o of obstaclesRef.current) {
      const d = rayIntersect(p.x, p.y, rx, ry, o);
      if (d > 0 && (closest < 0 || d < closest)) closest = d;
    }
    return closest > 0 ? Math.min(closest, MAX_SENSE) : -1;
  };

  const castHCSR04 = () => castRayAngle(0);

  // Physics tick
  const tick = useCallback(() => {
    const p = posRef.current;
    const h = headingRef.current;

    const d = castHCSR04();
    distanceRef.current = d;
    setSensorDist(d > 0 ? `${(d / 10).toFixed(0)}cm` : "---");

    const l = leftMotorRef.current;
    const r = rightMotorRef.current;
    if (l === 0 && r === 0) return;
    const diff = Math.abs(l - r);
    const sum = Math.abs(l + r);

    let newH = h;
    let dx = 0, dy = 0;
    if (diff > 30 && sum < 80) {
      newH += (l - r) / 510 * 0.06;
    } else if (sum > 30 && diff < 80) {
      const avg = (l + r) / 510;
      dx = Math.sin(h) * avg * 2;
      dy = -Math.cos(h) * avg * 2;
    } else if (diff > 30 && sum > 30) {
      newH += (l - r) / 510 * 0.03;
      const avg = (l + r) / 510;
      dx = Math.sin(h) * avg * 1.5;
      dy = -Math.cos(h) * avg * 1.5;
    }

    if (!collides(p.x + dx, p.y)) p.x += dx;
    if (!collides(p.x, p.y + dy)) p.y += dy;
    headingRef.current = newH;

    // Record experience when user drives in belajar mode
    if (belajarRef.current && joyActiveRef.current) {
      if (!learnDbRef.current) learnDbRef.current = new LearningDB();
      const front = castRayAngle(0);
      const left = castRayAngle(-0.5);
      const right = castRayAngle(0.5);
      const snap: SensorSnapshot = {
        front, left, right,
        wallLeft: left >= 0 && left < 50,
        wallRight: right >= 0 && right < 50,
      };
      learnDbRef.current.record(snap, { left: l, right: r }, 1);
      setExpInfo(`exp:${learnDbRef.current.size}`);
    }

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

    // ---- Obstacles ----
    for (const o of obstaclesRef.current) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.5)";
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
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
      const ax = p.x + Math.sin(h) * 35 * dir;
      const ay = p.y - Math.cos(h) * 35 * dir;
      ctx.strokeStyle = `rgba(34, 197, 94, ${Math.abs(avg) * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.fillStyle = `rgba(34, 197, 94, ${Math.abs(avg) * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - Math.sin(h + 0.5) * 8 * dir, ay + Math.cos(h + 0.5) * 8 * dir);
      ctx.lineTo(ax - Math.sin(h - 0.5) * 8 * dir, ay + Math.cos(h - 0.5) * 8 * dir);
      ctx.closePath();
      ctx.fill();
    }

    // ---- HC-SR04 sensor ray ----
    const distVal = distanceRef.current;
    if (distVal > 0) {
      const rayLen = Math.min(distVal, MAX_SENSE);
      const ex = p.x + Math.sin(h) * rayLen;
      const ey = p.y - Math.cos(h) * rayLen;
      ctx.fillStyle = "rgba(239, 68, 68, 0.04)";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, Math.min(rayLen, 120), h - HCSR04_FOV / 2 - Math.PI / 2, h + HCSR04_FOV / 2 - Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = "rgba(239, 68, 68, 0.8)";
      ctx.beginPath();
      ctx.arc(ex, ey, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(239, 68, 68, 0.7)";
      ctx.font = "bold 9px monospace";
      ctx.fillText(`${(distVal / 10).toFixed(0)}cm`, ex + 5, ey - 5);
    }

    // ---- Robot ----
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(h - Math.PI / 2);
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Heading line
    ctx.strokeStyle = "rgba(59,130,246,0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.sin(h) * 40, p.y - Math.cos(h) * 40);
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
    ctx.fillText(`HC-SR04: ${sensorDist}`, 8, vh - 28);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillText(`zoom:${s.toFixed(1)} obst:${obstacleCount}`, 8, vh - 38);
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
    const loop = () => {
      if (!running) return;
      if (belajarRef.current && !joyActiveRef.current && !editMode) {
        // Supervised learning prediction
        if (!learnDbRef.current) learnDbRef.current = new LearningDB();
        const front = castRayAngle(0);
        const left = castRayAngle(-0.5);
        const right = castRayAngle(0.5);
        const snap: SensorSnapshot = {
          front, left, right,
          wallLeft: left >= 0 && left < 50,
          wallRight: right >= 0 && right < 50,
        };
        const cmd = learnDbRef.current.predict(snap);
        if (cmd) {
          const [cl, cr] = applyGear(cmd.left, cmd.right);
          leftMotorRef.current = cl;
          rightMotorRef.current = cr;
          setLeftMotor(cl);
          setRightMotor(cr);
        }
      } else if (!joyActiveRef.current && !editMode) {
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
              onClick={() => { obstaclesRef.current = []; setObstacleCount(0); }}
              className="px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px] font-mono active:scale-90"
            >
              ALL
            </button>
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
            <div className="text-[7px] font-mono text-zinc-600 bg-zinc-900/40 px-2 py-0.5 rounded-full">
              {expInfo}
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
