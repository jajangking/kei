"use client";

import { useRef, useEffect, type RefObject } from "react";
import type { Detection } from "@mediapipe/tasks-vision";

const FOV = 70 * Math.PI / 180;
const MAX_SENSE = 250;
const TRAIL_LEN = 40;
const VH = 480;
const GRID_STEP = 50;

interface TeleEntry {
  label: string;
  x: number;
  y: number;
  score: number;
  lastSeen: number;
  area: number;
}

interface Props {
  headingRef: RefObject<number>;
  posRef: RefObject<{ x: number; y: number }>;
  telemetryMapRef: RefObject<TeleEntry[]>;
  trackLabelRef: RefObject<string | null>;
  trackTargetRef: RefObject<{ label: string; lastSeen: number } | null>;
  detectionsRef: RefObject<Detection[]>;
  trackingRef: RefObject<boolean>;
  leftMotor: number;
  rightMotor: number;
  distanceRef?: RefObject<number>;
}

export default function Simulasi({
  headingRef, posRef, telemetryMapRef,
  trackLabelRef, trackTargetRef,
  detectionsRef, trackingRef, leftMotor, rightMotor,
  distanceRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastSizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const cw = Math.round(rect.width * dpr);
      const ch = Math.round(rect.height * dpr);

      const sizeChanged = cw !== lastSizeRef.current.w || ch !== lastSizeRef.current.h;
      if (sizeChanged) {
        canvas.width = cw;
        canvas.height = ch;
        lastSizeRef.current = { w: cw, h: ch };
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const vw = rect.width;
      const vh = rect.height;
      const scale = Math.min(vw, vh) / 600;
      const cx = vw / 2;
      const cy = vh / 2;

      const p = posRef.current;
      const h = headingRef.current;
      const trackLabel = trackLabelRef.current;
      const trackTarget = trackTargetRef.current;
      const detections = detectionsRef.current;
      const isTracking = trackingRef.current;
      const teleMap = telemetryMapRef.current;
      const motorActive = leftMotor !== 0 || rightMotor !== 0;
      const now = Date.now();

      // Background
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, vw, vh);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-p.x, -p.y);

      // ---- Infinite grid ----
      const viewW = vw / scale;
      const viewH = vh / scale;
      const minX = Math.floor((p.x - viewW / 2) / GRID_STEP) * GRID_STEP;
      const maxX = Math.ceil((p.x + viewW / 2) / GRID_STEP) * GRID_STEP;
      const minY = Math.floor((p.y - viewH / 2) / GRID_STEP) * GRID_STEP;
      const maxY = Math.ceil((p.y + viewH / 2) / GRID_STEP) * GRID_STEP;

      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      for (let x = minX; x <= maxX; x += GRID_STEP) {
        ctx.beginPath(); ctx.moveTo(x, minY); ctx.lineTo(x, maxY); ctx.stroke();
      }
      for (let y = minY; y <= maxY; y += GRID_STEP) {
        ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke();
      }

      // ---- Persistent telemetry map ----
      ctx.font = '7px monospace';
      for (const entry of teleMap) {
        const age = (now - entry.lastSeen) / 1000;
        const alpha = Math.max(0.15, 1 - age / 30);
        const isTrackedTarget = isTracking && trackTarget && entry.label === trackTarget.label;
        const color = isTrackedTarget ? '#ef4444' : '#22c55e';

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(entry.x, entry.y, isTrackedTarget ? 7 : 4 + entry.score * 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.5})`;
        ctx.fillText(entry.label, entry.x - 10, entry.y - 10);
      }
      ctx.globalAlpha = 1;

      // ---- Trail ----
      if (motorActive) {
        const trail = trailRef.current;
        if (trail.length === 0 || Math.hypot(trail[trail.length - 1].x - p.x, trail[trail.length - 1].y - p.y) > 3) {
          trail.push({ x: p.x, y: p.y });
          if (trail.length > TRAIL_LEN) trail.shift();
        }
        if (trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(trail[0].x, trail[0].y);
          for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
          ctx.strokeStyle = 'rgba(96, 165, 250, 0.25)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // ---- Detections ----
      ctx.font = '7px monospace';
      for (const d of detections) {
        const box = d.boundingBox!;
        const nx = (box.originX + box.width / 2) / 640;
        const area = (box.width / 640) * (box.height / VH);
        const angle = (nx - 0.5) * Math.PI;
        const dist = (1 - Math.min(area * 8, 1)) * 180;
        const a = h + angle - Math.PI / 2;
        const px2 = p.x + Math.cos(a) * dist;
        const py2 = p.y + Math.sin(a) * dist;
        const isTarget = isTracking && trackTarget && d.categories[0].categoryName === trackTarget.label;
        ctx.fillStyle = isTarget ? '#ef4444' : '#22c55e';
        ctx.beginPath(); ctx.arc(px2, py2, 4 + (1 - d.categories[0].score) * 2, 0, Math.PI * 2); ctx.fill();
        if (d.categories[0].score > 0.6) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillText(d.categories[0].categoryName, px2 - 10, py2 - 8);
        }
      }

      // ---- Line to tracked target ----
      if (isTracking && trackTarget) {
        const td = detections.find(d => d.categories[0].categoryName === trackTarget.label);
        if (td) {
          const box = td.boundingBox!;
          const nx = (box.originX + box.width / 2) / 640;
          const area = (box.width / 640) * (box.height / VH);
          const ang = (nx - 0.5) * Math.PI;
          const dst = (1 - Math.min(area * 8, 1)) * 180;
          const aa = h + ang - Math.PI / 2;
          const tx = p.x + Math.cos(aa) * dst;
          const ty = p.y + Math.sin(aa) * dst;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // ---- FOV ----
      ctx.fillStyle = 'rgba(59, 130, 246, 0.06)';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, MAX_SENSE * 0.5, h - FOV / 2 - Math.PI / 2, h + FOV / 2 - Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.lineWidth = 1;
      for (const sign of [-1, 1]) {
        const a = h + sign * FOV / 2 - Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * MAX_SENSE * 0.5, p.y + Math.sin(a) * MAX_SENSE * 0.5); ctx.stroke();
      }

      // ---- Movement arrow ----
      if (motorActive && Math.abs(leftMotor + rightMotor) > 30) {
        const avg = (leftMotor + rightMotor) / 510;
        const dir = avg > 0 ? 1 : -1;
        const ax = p.x + Math.sin(h) * 35 * dir;
        const ay = p.y - Math.cos(h) * 35 * dir;
        ctx.strokeStyle = `rgba(34, 197, 94, ${Math.abs(avg) * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.fillStyle = `rgba(34, 197, 94, ${Math.abs(avg) * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - Math.sin(h + 0.5) * 8 * dir, ay + Math.cos(h + 0.5) * 8 * dir);
        ctx.lineTo(ax - Math.sin(h - 0.5) * 8 * dir, ay + Math.cos(h - 0.5) * 8 * dir);
        ctx.closePath(); ctx.fill();
      }

      // ---- VL53L0X laser ray ----
      if (distanceRef && distanceRef.current != null && distanceRef.current > 0) {
        const distCm = distanceRef.current / 10;
        const rayLen = Math.min(distCm, MAX_SENSE * 0.6);
        const rx = p.x + Math.sin(h) * rayLen;
        const ry = p.y - Math.cos(h) * rayLen;
        for (let i = teleMap.length - 1; i >= 0; i--) { if (teleMap[i].label === 'VL') teleMap.splice(i, 1); }
        teleMap.push({ label: 'VL', x: rx, y: ry, score: 0.8, lastSeen: now, area: 0 });
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(rx, ry); ctx.stroke();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.font = '8px monospace';
        ctx.fillText(`${distCm.toFixed(0)}cm`, rx + 4, ry);
      }

      // ---- Robot ----
      const rColor = isTracking ? '#ef4444' : '#3b82f6';
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(h - Math.PI / 2);
      ctx.fillStyle = rColor;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Heading line
      ctx.strokeStyle = 'rgba(59,130,246,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.sin(h) * 40, p.y - Math.cos(h) * 40); ctx.stroke();
      ctx.setLineDash([]);

      // State label
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(isTracking ? `LACAK ${trackLabel || ''}` : '-', p.x - 24, p.y - 28);

      if (isTracking) {
        ctx.fillStyle = 'rgba(239,68,68,0.1)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, Math.PI * 2); ctx.fill();
      }

      ctx.restore();

      // ---- HUD (viewport-space, not world-space) ----
      ctx.font = '8px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillText(`${leftMotor} ${rightMotor}`, 8, vh - 8);
      ctx.fillText(`obj:${teleMap.length}`, vw - 70, vh - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillText(`x:${p.x.toFixed(0)} y:${p.y.toFixed(0)}`, vw - 70, vh - 18);

      if (isTracking && trackTarget) {
        ctx.fillStyle = 'rgba(239,68,68,0.2)';
        ctx.fillText(`>> ${trackTarget.label}`, 8, 16);
      }
    };

    draw();
    const iv = setInterval(draw, 200);
    return () => { clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas ref={canvasRef} className="w-full h-full" />
  );
}
