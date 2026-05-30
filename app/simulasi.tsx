"use client";

import { useRef, useEffect, type RefObject } from "react";
import type { Detection } from "@mediapipe/tasks-vision";

const SECTOR_COUNT = 16;
const FOV = 70 * Math.PI / 180;
const MAX_SENSE = 250;
const ROOM_W = 600;
const ROOM_H = 600;
const TRAIL_LEN = 40;
const VH = 480;

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
  scanStateRef: RefObject<'idle' | 'scanning' | 'waiting' | 'moving'>;
  scanMapRef: RefObject<Array<{ label: string; area: number }[]>>;
  scanBestSecRef: RefObject<number>;
  scanTargetSeeRef: RefObject<boolean>;
  trackLabelRef: RefObject<string | null>;
  trackTargetRef: RefObject<{ label: string; lastSeen: number } | null>;
  detectionsRef: RefObject<Detection[]>;
  trackingRef: RefObject<boolean>;
  leftMotor: number;
  rightMotor: number;
}

export default function Simulasi({
  headingRef, posRef, telemetryMapRef,
  scanStateRef, scanMapRef, scanBestSecRef, scanTargetSeeRef,
  trackLabelRef, trackTargetRef,
  detectionsRef, trackingRef, leftMotor, rightMotor,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const gridCacheRef = useRef<HTMLCanvasElement | null>(null);
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

      if (cw !== lastSizeRef.current.w || ch !== lastSizeRef.current.h) {
        canvas.width = cw;
        canvas.height = ch;
        lastSizeRef.current = { w: cw, h: ch };
        gridCacheRef.current = null;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = Math.min(rect.width / ROOM_W, rect.height / ROOM_H);
      const ox = (rect.width - ROOM_W * s) / 2;
      const oy = (rect.height - ROOM_H * s) / 2;

      // Background + cached grid
      {
        const grid = gridCacheRef.current;
        if (grid) {
          ctx.drawImage(grid, ox, oy, ROOM_W * s, ROOM_H * s);
        } else {
          const gc = document.createElement('canvas');
          gc.width = Math.round(ROOM_W * s * dpr);
          gc.height = Math.round(ROOM_H * s * dpr);
          const gctx = gc.getContext('2d')!;
          gctx.scale(s * dpr, s * dpr);
          gctx.fillStyle = '#18181b';
          gctx.fillRect(0, 0, ROOM_W, ROOM_H);
          gctx.strokeStyle = 'rgba(255,255,255,0.03)';
          gctx.lineWidth = 1;
          for (let i = 0; i <= ROOM_W; i += 50) {
            gctx.beginPath(); gctx.moveTo(i, 0); gctx.lineTo(i, ROOM_H); gctx.stroke();
            gctx.beginPath(); gctx.moveTo(0, i); gctx.lineTo(ROOM_W, i); gctx.stroke();
          }
          gctx.strokeStyle = 'rgba(255,255,255,0.15)';
          gctx.lineWidth = 2;
          gctx.strokeRect(0, 0, ROOM_W, ROOM_H);
          gridCacheRef.current = gc;
          ctx.drawImage(gc, ox, oy, ROOM_W * s, ROOM_H * s);
        }
      }

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);

      const h = headingRef.current;
      const p = posRef.current;
      const state = scanStateRef.current;
      const scanMap = scanMapRef.current;
      const bestSec = scanBestSecRef.current;
      const targetSee = scanTargetSeeRef.current;
      const trackLabel = trackLabelRef.current;
      const trackTarget = trackTargetRef.current;
      const detections = detectionsRef.current;
      const isTracking = trackingRef.current;
      const teleMap = telemetryMapRef.current;
      const motorActive = leftMotor !== 0 || rightMotor !== 0;
      const now = Date.now();
      const vw = 640;

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

      // ---- Scan sectors ----
      if (scanMap.length === SECTOR_COUNT) {
        for (let i = 0; i < SECTOR_COUNT; i++) {
          const a0 = (i / SECTOR_COUNT) * Math.PI * 2 - Math.PI / 2;
          const a1 = ((i + 1) / SECTOR_COUNT) * Math.PI * 2 - Math.PI / 2;
          const data = scanMap[i] || [];
          if (data.length > 0) {
            ctx.fillStyle = `rgba(239, 68, 68, ${Math.min(data.length / 5, 1) * 0.35})`;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, MAX_SENSE * 0.8, a0, a1); ctx.closePath(); ctx.fill();
          }
          if (i === bestSec) {
            ctx.fillStyle = targetSee ? 'rgba(239, 68, 68, 0.35)' : 'rgba(34, 197, 94, 0.2)';
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, MAX_SENSE * 0.8, a0, a1); ctx.closePath(); ctx.fill();
          }
        }
      }

      // ---- Current detections ----
      ctx.font = '7px monospace';
      for (const d of detections) {
        const box = d.boundingBox!;
        const nx = (box.originX + box.width / 2) / vw;
        const area = (box.width / vw) * (box.height / VH);
        const angle = (nx - 0.5) * Math.PI;
        const dist = (1 - Math.min(area * 8, 1)) * 180;
        const a = h + angle - Math.PI / 2;
        const px = p.x + Math.cos(a) * dist;
        const py = p.y + Math.sin(a) * dist;
        const isTarget = isTracking && trackTarget && d.categories[0].categoryName === trackTarget.label;
        ctx.fillStyle = isTarget ? '#ef4444' : '#22c55e';
        ctx.beginPath(); ctx.arc(px, py, 4 + (1 - d.categories[0].score) * 2, 0, Math.PI * 2); ctx.fill();
        if (d.categories[0].score > 0.6) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillText(d.categories[0].categoryName, px - 10, py - 8);
        }
      }

      // ---- Line to tracked target ----
      if (isTracking && trackTarget) {
        const td = detections.find(d => d.categories[0].categoryName === trackTarget.label);
        if (td) {
          const box = td.boundingBox!;
          const nx = (box.originX + box.width / 2) / vw;
          const area = (box.width / vw) * (box.height / VH);
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

      // ---- Robot ----
      const rColor = isTracking ? '#ef4444' : state === 'moving' ? '#22c55e' : '#3b82f6';
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

      // State
      ctx.font = 'bold 9px monospace';
      const labels: Record<string, string> = { scanning: 'SCAN', waiting: 'ANALISIS', moving: 'MAJU', idle: '-' };
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(isTracking ? `LACAK ${trackLabel || ''}` : (labels[state] || state), p.x - 24, p.y - 28);

      if (isTracking) {
        ctx.fillStyle = 'rgba(239,68,68,0.1)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, Math.PI * 2); ctx.fill();
      }

      // Bottom info
      ctx.font = '8px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillText(`${leftMotor} ${rightMotor}`, 8, ROOM_H - 8);
      ctx.fillText(`obj:${teleMap.length}`, ROOM_W - 70, ROOM_H - 8);

      if (isTracking && trackTarget) {
        ctx.fillStyle = 'rgba(239,68,68,0.2)';
        ctx.fillText(`>> ${trackTarget.label}`, 8, 16);
      }

      ctx.restore();
    };

    // Use setInterval instead of requestAnimationFrame to avoid competing
    // with the detection + keyboard RAF loops on the main thread.
    draw();
    const iv = setInterval(draw, 200);
    return () => { clearInterval(iv); gridCacheRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas ref={canvasRef} className="w-full h-full" />
  );
}
