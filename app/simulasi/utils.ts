import type { Obstacle } from "./types";
import { GRID_STEP, ROBOT_R, MAX_SENSE } from "./constants";

export function snap(v: number): number {
  return Math.round(v / GRID_STEP) * GRID_STEP;
}

export function collides(
  x: number,
  y: number,
  obstacles: Obstacle[],
  radius = ROBOT_R
): boolean {
  for (const o of obstacles) {
    if (
      x + radius > o.x &&
      x - radius < o.x + o.w &&
      y + radius > o.y &&
      y - radius < o.y + o.h
    )
      return true;
  }
  return false;
}

export function rayIntersect(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  rect: Obstacle
): number {
  const t1 = (rect.x - ox) / dx;
  const t2 = (rect.x + rect.w - ox) / dx;
  const t3 = (rect.y - oy) / dy;
  const t4 = (rect.y + rect.h - oy) / dy;
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  if (tmax < 0 || tmin > tmax) return -1;
  return tmin > 0 ? tmin : -1;
}

export function castRayAngle(
  angleOffset: number,
  p: { x: number; y: number },
  heading: number,
  obstacles: Obstacle[],
  scanDots: { x: number; y: number }[],
  markSeen = true
): number {
  const h = heading + angleOffset;
  const rx = Math.sin(h);
  const ry = -Math.cos(h);
  let closest = -1;
  let hitObs: Obstacle | null = null;
  for (const o of obstacles) {
    const d = rayIntersect(p.x, p.y, rx, ry, o);
    if (d > 0 && (closest < 0 || d < closest)) {
      closest = d;
      hitObs = o;
    }
  }
  if (markSeen && hitObs) {
    hitObs.seen = true;
    const hx = p.x + rx * closest;
    const hy = p.y + ry * closest;
    if (
      scanDots.length === 0 ||
      Math.hypot(scanDots[scanDots.length - 1].x - hx, scanDots[scanDots.length - 1].y - hy) > 8
    ) {
      scanDots.push({ x: hx, y: hy });
    }
  }
  return closest > 0 ? Math.min(closest, MAX_SENSE) : -1;
}

export function findSafeSpawn(obstacles: Obstacle[]): { x: number; y: number } {
  const candidates = [
    { x: 0, y: 350 },
    { x: -150, y: 250 },
    { x: 150, y: 450 },
    { x: -200, y: 450 },
    { x: 200, y: 150 },
    { x: 0, y: 100 },
    { x: 0, y: 600 },
  ];

  for (const pos of candidates) {
    if (!collides(pos.x, pos.y, obstacles)) {
      return pos;
    }
  }

  // Fallback: search grid
  for (let y = 50; y < 650; y += 50) {
    for (let x = -350; x < 350; x += 50) {
      if (!collides(x, y, obstacles)) {
        return { x, y };
      }
    }
  }

  return { x: 0, y: 350 }; // Ultimate fallback
}

// Occupancy Grid helpers
export function gridCellKey(x: number, y: number): string {
  return `${Math.round(x / GRID_STEP)},${Math.round(y / GRID_STEP)}`;
}

export function getGrid(occ: Map<string, number>, x: number, y: number): number {
  return occ.get(gridCellKey(x, y)) || 0;
}

export function setGrid(occ: Map<string, number>, x: number, y: number, v: number): void {
  occ.set(gridCellKey(x, y), v);
}

export function syncGridFromObstacles(
  occ: Map<string, number>,
  obstacles: Obstacle[]
): void {
  for (const o of obstacles) {
    for (let gy = Math.floor(o.y / GRID_STEP); gy <= Math.ceil((o.y + o.h) / GRID_STEP); gy++) {
      for (let gx = Math.floor(o.x / GRID_STEP); gx <= Math.ceil((o.x + o.w) / GRID_STEP); gx++) {
        const gcx = gx * GRID_STEP + GRID_STEP / 2;
        const gcy = gy * GRID_STEP + GRID_STEP / 2;
        if (gcx >= o.x && gcx <= o.x + o.w && gcy >= o.y && gcy <= o.y + o.h) {
          occ.set(`${gx},${gy}`, 2);
        }
      }
    }
  }
}
