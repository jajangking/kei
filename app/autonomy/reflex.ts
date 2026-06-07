import type { BrainstemResult, EdgeResult, MotorCommand, WallResult } from "./types";

interface PathPoint {
  x: number;
  y: number;
  t: number;
}

export class ReflexSystem {
  private brightnessCanvas: HTMLCanvasElement | null = null;
  private wallPhase = 0;
  private wallTimer = 0;
  wallActive: { phase: number; timer: number } | null = null;
  private loopTimer = 0;
  private loopDetected = false;
  private edgeResult: EdgeResult = { left: 0, center: 0, right: 0 };
  private pathHistory: PathPoint[] = [];
  private frameCount = 0;

  get edges(): EdgeResult {
    return this.edgeResult;
  }

  get loopDetectedFlag(): boolean {
    return this.loopDetected;
  }

  tick(
    motorRunning: boolean,
    heading: number,
    pos: { x: number; y: number },
    source: "local" | "stream",
    video: HTMLVideoElement | null,
    streamImg: HTMLImageElement | null,
    canvas: HTMLCanvasElement | null,
    distance?: number,
  ): BrainstemResult | null {
    this.frameCount++;

    const p = pos;
    this.pathHistory.push({ x: p.x, y: p.y, t: Date.now() });
    if (this.pathHistory.length > 30) this.pathHistory.shift();

    // If already in wall avoidance, continue regardless of motorRunning
    if (this.wallActive) {
      const w = this.wallActive;
      this.edgeResult = this.detectEdges(source, video, streamImg, canvas);
      const wall = this.detectWall(source, video, streamImg, canvas);
      if (!wall.blocked) {
        this.wallActive = null;
        return null;
      }
      w.timer++;
      if (w.phase === 0) {
        if (w.timer > 5) { w.phase = 1; w.timer = 0; }
        return { override: true, command: { l: 0, r: 0 }, reason: "wall_stop" };
      } else if (w.phase === 1) {
        const steer = this.edgeResult.left > this.edgeResult.right ? 40 : -40;
        if (w.timer > 12) { w.phase = 2; w.timer = 0; }
        return { override: true, command: { l: -180 + steer, r: -180 - steer }, reason: "wall_back" };
      } else {
        const steer = this.edgeResult.right > this.edgeResult.left ? -200 : 200;
        if (w.timer > 15) {
          w.phase = 0;
          w.timer = 0;
          this.wallActive = null;
        }
        return { override: true, command: { l: -steer, r: steer }, reason: "wall_turn" };
      }
    }

    if (!motorRunning) return null;

    this.edgeResult = this.detectEdges(source, video, streamImg, canvas);

    // Loop detection — reactive (re-check each frame)
    if (this.loopDetected || this.checkLoop()) {
      if (!this.checkLoop()) {
        this.loopTimer = 0;
        this.loopDetected = false;
      } else {
        this.loopTimer++;
        if (this.loopTimer > 5) {
          this.loopDetected = true;
          this.loopTimer = 0;
          const dir = Math.random() > 0.5 ? -200 : 200;
          return { override: true, command: { l: -dir, r: dir }, reason: "loop" };
        }
      }
    }

    const wall = this.detectWall(source, video, streamImg, canvas);

    // VL53L0X — obstruksi jarak dekat
    if (distance != null && distance > 0 && distance < 300) {
      wall.blocked = true;
      wall.center = true;
    }

    // New wall detection
    if (wall.blocked) {
      this.wallActive = { phase: 0, timer: 0 };
      return { override: true, command: { l: 0, r: 0 }, reason: "wall_stop" };
    }

    return null;
  }

  reset() {
    this.wallActive = null;
    this.loopTimer = 0;
    this.loopDetected = false;
    this.pathHistory = [];
    this.edgeResult = { left: 0, center: 0, right: 0 };
  }

  private getCanvas(
    source: "local" | "stream",
    video: HTMLVideoElement | null,
    streamImg: HTMLImageElement | null,
    canvas: HTMLCanvasElement | null,
  ): { ctx: CanvasRenderingContext2D | null; w: number; h: number } {
    if (!canvas) {
      canvas = document.createElement("canvas");
      this.brightnessCanvas = canvas;
    }
    let w = 640, h = 480;
    if (source === "local" && video && video.videoWidth) {
      w = video.videoWidth;
      h = video.videoHeight;
    } else if (streamImg && streamImg.complete && streamImg.naturalWidth) {
      w = streamImg.naturalWidth;
      h = streamImg.naturalHeight;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { ctx: null, w, h };
    if (source === "local" && video) ctx.drawImage(video, 0, 0);
    else if (streamImg && streamImg.complete) ctx.drawImage(streamImg, 0, 0);
    else return { ctx: null, w, h };
    return { ctx, w, h };
  }

  detectWall(
    source: "local" | "stream",
    video: HTMLVideoElement | null,
    streamImg: HTMLImageElement | null,
    canvas: HTMLCanvasElement | null,
  ): WallResult {
    const { ctx, w, h } = this.getCanvas(source, video, streamImg, canvas);
    if (!ctx) return { blocked: false, left: false, center: false, right: false };
    const data = ctx.getImageData(0, 0, w, h).data;
    const GRID = 6;
    const cellW = Math.floor(w / GRID);
    const cellH = Math.floor(h / GRID);
    let wallCells = 0;
    const sideCount = { left: 0, center: 0, right: 0 };
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        let sum = 0, sumDiff = 0, count = 0, lastVal = 0;
        const step = 4;
        for (let py = 0; py < cellH; py += step) {
          for (let px = 0; px < cellW; px += step) {
            const idx = ((gy * cellH + py) * w + (gx * cellW + px)) * 4;
            const val = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            sum += val;
            if (count > 0) sumDiff += Math.abs(val - lastVal);
            lastVal = val;
            count++;
          }
        }
        const avg = sum / count;
        const varian = sumDiff / count;
        if (varian < 5 && avg > 30 && avg < 230) {
          wallCells++;
          if (gx < 2) sideCount.left++;
          else if (gx >= 4) sideCount.right++;
          else sideCount.center++;
        }
      }
    }
    const total = GRID * GRID;
    return {
      blocked: wallCells > total * 0.50,
      left: sideCount.left > 4,
      center: sideCount.center > 4,
      right: sideCount.right > 4,
    };
  }

  detectEdges(
    source: "local" | "stream",
    video: HTMLVideoElement | null,
    streamImg: HTMLImageElement | null,
    canvas: HTMLCanvasElement | null,
  ): EdgeResult {
    const { ctx, w, h } = this.getCanvas(source, video, streamImg, canvas);
    if (!ctx) return { left: 0, center: 0, right: 0 };
    const data = ctx.getImageData(0, 0, w, h).data;
    const GRID = 6;
    const cellW = Math.floor(w / GRID);
    const cellH = Math.floor(h / GRID);
    let leftEdge = 0, centerEdge = 0, rightEdge = 0;
    let leftN = 0, centerN = 0, rightN = 0;
    const step = 8;
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        let gradSum = 0, count = 0;
        for (let py = cellH / 2 - 8; py < cellH / 2 + 8; py += step) {
          for (let px = 4; px < cellW - 4; px += step) {
            const idx = ((gy * cellH + py) * w + (gx * cellW + px)) * 4;
            const val = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            const idxR = idx + 4 * step;
            const valR = (data[idxR] + data[idxR + 1] + data[idxR + 2]) / 3;
            gradSum += Math.abs(valR - val);
            count++;
          }
        }
        const avgGrad = count > 0 ? gradSum / count : 0;
        if (gx < 2) { leftEdge += avgGrad; leftN++; }
        else if (gx >= 4) { rightEdge += avgGrad; rightN++; }
        else { centerEdge += avgGrad; centerN++; }
      }
    }
    return {
      left: leftN > 0 ? leftEdge / leftN : 0,
      center: centerN > 0 ? centerEdge / centerN : 0,
      right: rightN > 0 ? rightEdge / rightN : 0,
    };
  }

  checkLoop(): boolean {
    const path = this.pathHistory;
    if (path.length < 8) return false;
    const cur = path[path.length - 1];
    let closeCount = 0;
    for (let i = path.length - 3; i >= 0; i--) {
      const p = path[i];
      const dist = Math.hypot(cur.x - p.x, cur.y - p.y);
      if (dist < 20) closeCount++;
    }
    return closeCount >= 3;
  }
}
