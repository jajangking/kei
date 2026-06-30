import { MAX_SENSE, ROBOT_R, ROBOT_W, ROBOT_H, LIDAR_FOV, SERVO_SCALE } from "./constants";

export interface DrawState {
  vw: number;
  vh: number;
  pos: { x: number; y: number };
  heading: number;
  scale: number;
  sensorDistance: number;
  servoAngle: number;
  scanDots: { x: number; y: number }[];
  vel: { x: number; y: number };
}

export function drawScene(ctx: CanvasRenderingContext2D, st: DrawState): void {
  const { vw, vh, pos: p, heading: h, scale: s, sensorDistance, servoAngle, scanDots, vel } = st;

  ctx.fillStyle = "#18181b";
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(s, s);
  ctx.translate(-p.x, -p.y);

  // ---- Scan dots ----
  for (let i = 0; i < scanDots.length; i++) {
    const dot = scanDots[i];
    const recent = i > scanDots.length - 50;
    ctx.fillStyle = recent ? "rgba(250, 204, 21, 0.6)" : "rgba(250, 204, 21, 0.15)";
    ctx.fillRect(dot.x - 3, dot.y - 3, 6, 6);
    if (recent) {
      ctx.strokeStyle = "rgba(250, 204, 21, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(dot.x - 3, dot.y - 3, 6, 6);
    }
  }

  // ---- Robot ----
  {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(h);
    const hw = ROBOT_W / 2;
    const hh = ROBOT_H / 2;
    ctx.fillStyle = "#fff";
    ctx.fillRect(-hw, -hh, ROBOT_W, ROBOT_H);
    ctx.strokeStyle = "rgba(0,0,0,0.1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-hw, -hh, ROBOT_W, ROBOT_H);
    // Servo arm indicator
    const sRad = ((servoAngle - 90) / SERVO_SCALE) * (Math.PI / 180);
    ctx.strokeStyle = "rgba(34, 211, 238, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(Math.sin(sRad) * 12, -hh - Math.cos(sRad) * 12);
    ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(-1.5, -hh - 2, 3, 4);
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -hh);
    ctx.stroke();
    ctx.restore();
  }

  // ---- VL53L0X ray ----
  {
    const servoRad = ((servoAngle - 90) / SERVO_SCALE) * (Math.PI / 180);
    const rayAngle = h + servoRad;
    const sx = p.x + Math.sin(h) * (ROBOT_H / 2);
    const sy = p.y - Math.cos(h) * (ROBOT_H / 2);
    if (sensorDistance > 0) {
      const rayLen = sensorDistance + 1;
      const ex = sx + Math.sin(rayAngle) * rayLen;
      const ey = sy - Math.cos(rayAngle) * rayLen;
      ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
      ctx.beginPath();
      ctx.arc(sx, sy, rayLen, rayAngle - LIDAR_FOV / 2 - Math.PI / 2, rayAngle + LIDAR_FOV / 2 - Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = "rgba(239, 68, 68, 1)";
      ctx.beginPath();
      ctx.arc(ex, ey, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
      ctx.font = "bold 11px monospace";
      ctx.fillText(`${sensorDistance.toFixed(0)}cm`, ex + 7, ey - 7);
    } else {
      ctx.fillStyle = "rgba(239, 68, 68, 0.5)";
      ctx.font = "bold 9px monospace";
      ctx.fillText("menunggu ESP...", p.x + 10, p.y - 10);
    }
  }

  // ---- Odometry HUD ----
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.font = "10px monospace";
  ctx.fillText(`x:${p.x.toFixed(0)} y:${p.y.toFixed(0)}`, 8, 14);
  ctx.fillText(`h:${((h*180)/Math.PI).toFixed(0)}°  v:${Math.hypot(vel.x,vel.y).toFixed(1)}`, 8, 27);
  ctx.restore();
}
