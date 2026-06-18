import type { Obstacle } from "./types";
import {
  GRID_STEP,
  MAX_SENSE,
  ROBOT_R,
  ROBOT_H,
  LIDAR_FOV,
  SECTORS,
} from "./constants";

// MediaPipe Detection type (from tasks-vision)
interface MediaPipeDetection {
  boundingBox?: { originX: number; originY: number; width: number; height: number };
  categories?: Array<{ categoryName?: string; score?: number }>;
  keypoints?: Array<{ x: number; y: number }>;
}

export interface DrawState {
  // Viewport
  vw: number;
  vh: number;

  // Robot
  pos: { x: number; y: number };
  heading: number;
  scale: number;

  // Motors
  leftMotor: number;
  rightMotor: number;

  // Sensor
  sensorDist: string;
  sensorDistance: number;
  servoAngle: number;

  // Scan / Sweep
  scanDots: { x: number; y: number }[];
  sweepPoints: { x: number; y: number }[];
  servoHistory: { angle: number; dist: number }[];

  // Mode
  mode: "LATIHAN" | "NYATA";

  // Modules
  modul1Active: boolean;
  modul1Braking: boolean;
  modul1Threshold: number;
  modul2Active: boolean;
  modul3Active: boolean;
  modul3Info: string;
  modul4Active: boolean;

  // Edit mode
  editMode: boolean;
  editTool: "place" | "delete";

  // Obstacles
  obstacles: Obstacle[];
  drawStart: { x: number; y: number } | null;
  drawEnd: { x: number; y: number } | null;

  // LEDs / Buzzer
  leds: number[];
  buzzerActive: boolean;

  // Camera
  camActive: boolean;
  detections: MediaPipeDetection[];
  recognizedFace: { name: string } | null;

  // Sector
  sectorDataRef: number[];

  // AI (M4)
  aiStatus: string;
  aiCallCount: number;
}

export function drawScene(ctx: CanvasRenderingContext2D, st: DrawState): void {
  const {
    vw,
    vh,
    pos: p,
    heading: h,
    scale: s,
    leftMotor: l,
    rightMotor: r,
    sensorDist,
    sensorDistance,
    servoAngle,
    scanDots,
    sweepPoints,
    servoHistory,
    mode,
    modul1Active,
    modul1Braking,
    modul1Threshold,
    modul2Active,
    modul3Active,
    modul3Info,
    modul4Active,
    editMode,
    editTool,
    obstacles,
    drawStart,
    drawEnd,
    leds,
    buzzerActive,
    camActive,
    detections,
    recognizedFace,
    sectorDataRef,
    aiStatus,
    aiCallCount,
  } = st;

  // Background
  ctx.fillStyle = "#18181b";
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(vw / 2, vh / 2);
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
  if (sweepPoints.length > 0 && modul2Active) {
    for (const pt of sweepPoints) {
      ctx.fillStyle = "rgba(34, 211, 238, 0.08)";
      ctx.fillRect(pt.x - 1, pt.y - 1, 2, 2);
    }
  }

  // ---- Scan dots ----
  for (let i = 0; i < scanDots.length; i++) {
    const dot = scanDots[i];
    if (mode === "NYATA") {
      const recent = i > scanDots.length - 50;
      ctx.fillStyle = recent
        ? "rgba(250, 204, 21, 0.6)"
        : "rgba(250, 204, 21, 0.15)";
      ctx.fillRect(dot.x - 3, dot.y - 3, 6, 6);
      if (recent) {
        ctx.strokeStyle = "rgba(250, 204, 21, 0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(dot.x - 3, dot.y - 3, 6, 6);
      }
    } else {
      ctx.fillStyle = "rgba(250, 204, 21, 0.35)";
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- Obstacles ----
  for (const o of obstacles) {
    if (!editMode && !o.seen && mode !== "NYATA") continue;
    const alpha =
      editMode || mode === "NYATA" ? (o.seen ? 0.6 : 0.15) : 0.6;
    ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = `rgba(239, 68, 68, ${alpha + 0.2})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    if (o.seen && !editMode) {
      ctx.fillStyle = "rgba(250, 204, 21, 0.04)";
      ctx.fillRect(o.x - 2, o.y - 2, o.w + 4, o.h + 4);
      ctx.fillStyle = "rgba(250, 204, 21, 0.7)";
      ctx.font = "bold 10px monospace";
      ctx.fillText("MAPPING", o.x + 3, o.y + 13);
    }
  }

  // ---- Obstacle preview (edit) ----
  if (editMode && editTool === "place" && drawStart && drawEnd) {
    const sx = drawStart.x,
      sy = drawStart.y;
    const ex = drawEnd.x,
      ey = drawEnd.y;
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

  // ---- Origin crosshair ----
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

  // ---- Servo mount indicator (NYATA) ----
  if (mode === "NYATA") {
    const servoOff = (servoAngle - 90) * (Math.PI / 180);
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

  // ---- VL53L0X sensor (NYATA) ----
  if (mode === "NYATA") {
    const servoRad = (servoAngle - 90) * (Math.PI / 180);
    const rayAngle = h + servoRad;
    if (sensorDistance > 0) {
      const rayLen = Math.min(sensorDistance, MAX_SENSE);
      const ex = p.x + Math.sin(rayAngle) * rayLen;
      const ey = p.y - Math.cos(rayAngle) * rayLen;
      ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        Math.min(rayLen, 100),
        rayAngle - LIDAR_FOV / 2 - Math.PI / 2,
        rayAngle + LIDAR_FOV / 2 - Math.PI / 2
      );
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
      ctx.fillText(`S:${servoAngle}° ${sensorDistance.toFixed(0)}cm`, ex + 6, ey - 6);
    } else {
      ctx.fillStyle = "rgba(239, 68, 68, 0.5)";
      ctx.font = "bold 9px monospace";
      ctx.fillText("menunggu ESP...", p.x + 10, p.y - 10);
    }
  }

  // ---- Modul 2: Servo sweep ----
  if (modul2Active && !editMode) {
    for (const past of servoHistory.slice(-12)) {
      const pa = (past.angle - 90) * (Math.PI / 180);
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
    const dNow = sensorDistance;
    if (dNow > 0) {
      const sweepRad = (servoAngle - 90) * (Math.PI / 180);
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
    for (let i = 0; i < SECTORS.length; i++) {
      const dVal = sectorDataRef[i];
      if (dVal <= 0) continue;
      const aRad = (SECTORS[i].cx - 90) * (Math.PI / 180);
      const lx = p.x + Math.sin(h + aRad) * Math.min(dVal, MAX_SENSE);
      const ly = p.y - Math.cos(h + aRad) * Math.min(dVal, MAX_SENSE);
      const hue = 140 - (dVal / MAX_SENSE) * 140;
      ctx.fillStyle = `hsla(${hue}, 80%, 55%, 0.2)`;
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${hue}, 80%, 65%, 0.9)`;
      ctx.font = "bold 7px monospace";
      ctx.fillText(`${SECTORS[i].id}${(dVal / 10).toFixed(0)}`, lx + 4, ly - 4);
    }
  }

  // ---- Laser ray (common) ----
  const servoRad = (servoAngle - 90) * (Math.PI / 180);
  const distVal = sensorDistance;
  if (distVal > 0) {
    const rayAngle = h + servoRad;
    const rayLen = Math.min(distVal, MAX_SENSE);
    const ex = p.x + Math.sin(rayAngle) * rayLen;
    const ey = p.y - Math.cos(rayAngle) * rayLen;

    ctx.fillStyle = "rgba(239, 68, 68, 0.03)";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(
      p.x,
      p.y,
      Math.min(rayLen, 100),
      rayAngle - LIDAR_FOV / 2 - Math.PI / 2,
      rayAngle + LIDAR_FOV / 2 - Math.PI / 2
    );
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

  // ---- Camera detections ----
  if (camActive && detections.length > 0) {
    const cx2 = vw / 2,
      cy2 = vh / 2;
    for (const d of detections) {
      const bb = d.boundingBox;
      if (!bb) continue;
      const isFace = d.categories?.[0]?.categoryName === "face";
      const label = d.categories?.[0]?.categoryName || "?";
      const fovCenter = (bb.originX + bb.width / 2) / 640 - 0.5;
      const estDist = Math.max(30, 150 - bb.height * 0.3);
      const angle = h + fovCenter * 0.8;
      const mx2 = p.x + Math.sin(angle) * estDist;
      const my2 = p.y - Math.cos(angle) * estDist;
      const sx2 = (mx2 - p.x) * s + cx2;
      const sy2 = (my2 - p.y) * s + cy2;
      ctx.fillStyle = isFace
        ? "rgba(217, 70, 239, 0.5)"
        : "rgba(59, 130, 246, 0.4)";
      ctx.beginPath();
      ctx.arc(sx2, sy2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = isFace ? "#d946ef" : "#60a5fa";
      ctx.font = "bold 7px monospace";
      ctx.fillText(
        isFace ? recognizedFace?.name || "wajah" : label,
        sx2 + 4,
        sy2 - 4
      );
    }
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

  // ---- Trail ----
  // (Trail rendering moved before robot so it's behind)

  // ---- Movement arrow ----
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
    ctx.lineTo(
      ax - Math.sin(h + 0.4) * 6 * dir,
      ay + Math.cos(h + 0.4) * 6 * dir
    );
    ctx.lineTo(
      ax - Math.sin(h - 0.4) * 6 * dir,
      ay + Math.cos(h - 0.4) * 6 * dir
    );
    ctx.closePath();
    ctx.fill();
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

  // LEDs (P1, P2, M1, M2)
  const ledColors = ["#3b82f6", "#3b82f6", "#ef4444", "#ef4444"];
  leds.forEach((on, i) => {
    if (!on) return;
    ctx.fillStyle = ledColors[i];
    const lx2 = (i % 2 === 0 ? -1 : 1) * 8;
    const ly2 = (i < 2 ? -1 : 1) * 12;
    ctx.beginPath();
    ctx.arc(lx2, ly2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = ledColors[i];
    ctx.beginPath();
    ctx.arc(lx2, ly2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Buzzer indicator
  if (buzzerActive) {
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    const waveOffset = (Date.now() / 100) % 5;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(
        0,
        0,
        ROBOT_R + 5 + i * 5 + waveOffset,
        -Math.PI / 4 - Math.PI / 2,
        Math.PI / 4 - Math.PI / 2
      );
      ctx.stroke();
    }
  }

  // Direction indicator
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
  ctx.lineTo(
    p.x + Math.sin(h) * (ROBOT_H + 15),
    p.y - Math.cos(h) * (ROBOT_H + 15)
  );
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();

  // ---- HUD ----
  ctx.font = "8px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillText(`L:${l} R:${r}`, 8, vh - 8);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillText(
    `x:${p.x.toFixed(0)} y:${p.y.toFixed(0)} h:${((h * 180) / Math.PI).toFixed(0)}°`,
    8,
    vh - 18
  );
  ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
  ctx.fillText(`VL53L0X: ${sensorDist}`, 8, vh - 28);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillText(
    `zoom:${s.toFixed(1)} servo:${servoAngle}° dots:${scanDots.length}`,
    8,
    vh - 38
  );
  if (modul2Active) {
    ctx.fillStyle = "rgba(34, 211, 238, 0.2)";
    ctx.font = "8px monospace";
    ctx.fillText(`SWEEP:${sweepPoints.length}pt`, 8, vh - 48);
  }
  if (modul1Active) {
    ctx.fillStyle = modul1Braking
      ? "rgba(255, 0, 0, 0.4)"
      : "rgba(34, 197, 94, 0.15)";
    ctx.font = "bold 8px monospace";
    ctx.fillText(
      modul1Braking
        ? `! HENTI ! <${(modul1Threshold / 10).toFixed(0)}cm`
        : `M1 <${(modul1Threshold / 10).toFixed(0)}cm`,
      8,
      vh - 58
    );
  }
  if (modul3Active) {
    ctx.fillStyle = "rgba(34, 211, 238, 0.2)";
    ctx.fillText(`M3:${modul3Info}`, 8, vh - 68);
  }
  if (modul4Active) {
    ctx.fillStyle = "rgba(139, 92, 246, 0.2)";
    ctx.fillText(`AI:${aiStatus} call#${aiCallCount}`, 8, vh - 78);
  }
}
