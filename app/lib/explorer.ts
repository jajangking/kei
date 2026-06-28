// Explorer — sensor fusion navigation module
// Menggabungkan: vision (camera deteksi), VL53L0X (jarak), MPU (heading/gyro)
// Pure TS, no React, no DOM

type Detection = {
  categories?: { categoryName: string; score: number }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
};

export type ExplorerState =
  | "FORWARD"
  | "AVOID_WALL"
  | "TRACK_OBJECT"
  | "STUCK"
  | "ESCAPE"
  | "SEARCH";

export interface ExplorerConfig {
  wallThreshold: number;
  emergencyBrake: number;
  baseSpeed: number;
  turnSpeed: number;
  slowTurnSpeed: number;
  stuckGyroThreshold: number;
  stuckTicks: number;
  objectAreaThreshold: number;
  trackMinScore: number;
  escapeDuration: number;
  searchTimeout: number;
  stopZone: number;
}

const DEFAULT_CONFIG: ExplorerConfig = {
  wallThreshold: 30,
  emergencyBrake: 10,
  baseSpeed: 45,
  turnSpeed: 80,
  slowTurnSpeed: 40,
  stuckGyroThreshold: 0.05,
  stuckTicks: 100,
  objectAreaThreshold: 0.15,
  trackMinScore: 0.4,
  escapeDuration: 50,
  searchTimeout: 200,
  stopZone: 0.22,
};

export interface ExplorerInput {
  sectors: readonly number[];
  frontDistance: number;
  heading: number;
  gyro: number;
  detections: readonly Detection[];
  face: { name: string } | null;
  tick: number;
}

export interface ExplorerDecision {
  state: ExplorerState;
  leftMotor: number;
  rightMotor: number;
  targetSector: number | null;
  targetLabel: string | null;
  suggestion: string;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function avg(arr: readonly number[]) {
  const valid = arr.filter(x => x > 0);
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : -1;
}

function sectorAngle(idx: number): number {
  // S1=25°, S2=35°, ..., S14=155°
  return (idx + 1) * 10 + 15;
}

export class Explorer {
  private cfg: ExplorerConfig;
  private state: ExplorerState = "FORWARD";
  private stuckCount = 0;
  private escapeCount = 0;
  private searchCount = 0;
  private wallTurnTick = 0;
  private lastHeading = 0;
  private lastDist = -1;
  private trackLabel: string | null = null;
  private lastMotors = { l: 0, r: 0 };
  private pidI = 0;
  private pidLastErr = 0;
  private suggestionText = "—";

  constructor(config?: Partial<ExplorerConfig>) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  getState() { return this.state; }
  getSuggestion() { return this.suggestionText; }
  getConfig() { return { ...this.cfg }; }

  setConfig(c: Partial<ExplorerConfig>) {
    Object.assign(this.cfg, c);
  }

  reset() {
    this.state = "FORWARD";
    this.stuckCount = 0;
    this.escapeCount = 0;
    this.searchCount = 0;
    this.trackLabel = null;
    this.pidI = 0;
    this.pidLastErr = 0;
    this.suggestionText = "reset";
  }

  decide(input: ExplorerInput): ExplorerDecision {
    const { sectors, frontDistance, heading, gyro, detections, face, tick } = input;
    const c = this.cfg;

    // Pre-check: face detected → stop
    if (face) {
      if (this.lastMotors.l !== 0 || this.lastMotors.r !== 0) {
        this.lastMotors = { l: 0, r: 0 };
        this.suggestionText = `halo ${face.name}, stop`;
      }
      return this.decision("FORWARD", 0, 0, null, face.name);
    }

    // Emergency brake
    if (frontDistance > 0 && frontDistance <= c.emergencyBrake) {
      this.lastMotors = { l: 0, r: 0 };
      this.suggestionText = "brake!";
      return this.decision("AVOID_WALL", 0, 0, null, null);
    }

    // ===== STATE MACHINE =====
    let newState = this.state;

    switch (this.state) {
      case "FORWARD":
        newState = this.transitionForward(input);
        break;
      case "AVOID_WALL":
        newState = this.transitionAvoidWall(input);
        break;
      case "TRACK_OBJECT":
        newState = this.transitionTrackObject(input);
        break;
      case "STUCK":
        newState = this.transitionStuck(input);
        break;
      case "ESCAPE":
        newState = this.transitionEscape(input);
        break;
      case "SEARCH":
        newState = this.transitionSearch(input);
        break;
    }

    this.state = newState;

    // === MOTOR GENERATION ===
    let l = 0, r = 0;
    let targetSector: number | null = null;
    let targetLabel: string | null = this.trackLabel;

    switch (this.state) {
      case "FORWARD": {
        const bestIdx = this.findFreestSector(sectors);
        targetSector = bestIdx;
        if (bestIdx >= 0) {
          const desiredDeg = sectorAngle(bestIdx);
          const errRad = (desiredDeg - 90) * Math.PI / 180;
          // If all sectors roughly equal, go straight
          const valid = sectors.filter(d => d > 0);
          const allSame = valid.length > 0 && valid.every(d => Math.abs(d - valid[0]) < 5);
          if (allSame || Math.abs(errRad) < 0.02) {
            l = c.baseSpeed;
            r = c.baseSpeed;
            this.suggestionText = "maju lurus";
          } else {
            const turn = clamp(errRad * 1.5 * (c.baseSpeed / 45), -30, 30);
            l = c.baseSpeed + turn;
            r = c.baseSpeed - turn;
            this.suggestionText = `maju → sector ${bestIdx + 1}`;
          }
        } else {
          l = c.baseSpeed;
          r = c.baseSpeed;
          this.suggestionText = "maju lurus";
        }
        break;
      }
      case "AVOID_WALL": {
        const leftAvg = avg(sectors.slice(0, 4));
        const rightAvg = avg(sectors.slice(10));
        const hasSectorData = leftAvg > 0 || rightAvg > 0;
        if (hasSectorData && leftAvg > rightAvg + 5) {
          l = -c.turnSpeed / 2;
          r = c.turnSpeed / 2;
          this.suggestionText = "halang kiri";
        } else if (hasSectorData && rightAvg > leftAvg + 5) {
          l = c.turnSpeed / 2;
          r = -c.turnSpeed / 2;
          this.suggestionText = "halang kanan";
        } else {
          // No sector data: phase — first reverse, then turn
          this.wallTurnTick++;
          const rev = Math.round(c.baseSpeed * 0.6);
          if (this.wallTurnTick < 10) {
            l = -rev; r = -rev;
            this.suggestionText = "mundur";
          } else {
            // Turn right
            l = c.slowTurnSpeed * 2; r = -c.slowTurnSpeed * 2;
            this.suggestionText = "putar";
          }
        }
        break;
      }
      case "TRACK_OBJECT": {
        // PID tracking (sama seperti di page.tsx)
        const vw = 640;
        const found = this.findTarget(detections, this.trackLabel);
        if (found) {
          const errorX = found.cx - 0.5;
          this.pidI = clamp(this.pidI + errorX, -50, 50);
          const deriv = errorX - this.pidLastErr;
          this.pidLastErr = errorX;
          const turn = errorX * 160 + this.pidI * 0.02 + deriv * 40;
          const baseSpeed = Math.max(150, Math.round((1 - found.area / c.stopZone) * 200));
          l = clamp(baseSpeed + Math.round(turn), -255, 255);
          r = clamp(baseSpeed - Math.round(turn), -255, 255);
          this.suggestionText = `track ${this.trackLabel}`;
        } else {
          l = 0; r = 0;
        }
        break;
      }
      case "STUCK":
        l = 0; r = 0;
        this.suggestionText = "stuck!";
        break;
      case "ESCAPE": {
        // Mundur + pivot
        const phase = this.escapeCount < 20 ? -c.baseSpeed : -c.baseSpeed * 0.5;
        l = phase;
        r = phase * (this.escapeCount % 2 === 0 ? 1.5 : 1);
        this.suggestionText = "mundur";
        break;
      }
      case "SEARCH": {
        const sweepDir = (tick % 120) < 60 ? 1 : -1;
        l = -c.slowTurnSpeed * sweepDir;
        r = c.slowTurnSpeed * sweepDir;
        this.suggestionText = "cari jalan";
        break;
      }
    }

    l = clamp(l, -255, 255);
    r = clamp(r, -255, 255);
    this.lastMotors = { l, r };

    return {
      state: this.state,
      leftMotor: l,
      rightMotor: r,
      targetSector,
      targetLabel,
      suggestion: this.suggestionText,
    };
  }

  // ===== TRANSITIONS =====

  private transitionForward(input: ExplorerInput): ExplorerState {
    const { frontDistance, detections, gyro, tick } = input;
    const c = this.cfg;

    // Wall ahead?
    if (frontDistance > 0 && frontDistance <= c.wallThreshold) {
      this.suggestionText = "tembok!";
      return "AVOID_WALL";
    }

    // Object to track?
    if (detections.length > 0) {
      const best = this.findBestObject(detections);
      if (best && best.area >= c.objectAreaThreshold) {
        this.trackLabel = best.label;
        this.pidI = 0;
        this.pidLastErr = 0;
        return "TRACK_OBJECT";
      }
    }

    // Stuck? Only check if close to something (frontDistance < 50cm)
    if ((this.lastMotors.l !== 0 || this.lastMotors.r !== 0) && input.frontDistance > 0 && input.frontDistance < 50) {
      const gyroMoving = Math.abs(gyro) > c.stuckGyroThreshold;
      const distChanging = input.frontDistance > 0 && this.lastDist > 0 &&
        Math.abs(input.frontDistance - this.lastDist) > 1;

      if (!gyroMoving && !distChanging) {
        this.stuckCount++;
        if (this.stuckCount > c.stuckTicks) {
          this.suggestionText = "stuck!";
          this.stuckCount = 0;
          return "STUCK";
        }
      } else {
        this.stuckCount = 0;
      }
    } else {
      this.stuckCount = 0;
    }

    this.lastDist = input.frontDistance;
    this.lastHeading = gyro;
    return "FORWARD";
  }

  private transitionAvoidWall(input: ExplorerInput): ExplorerState {
    const { frontDistance } = input;
    const c = this.cfg;

    this.stuckCount = 0;

    // Clear → back to forward
    if (frontDistance > 0 && frontDistance > c.wallThreshold + 10) {
      this.wallTurnTick = 0;
      return "FORWARD";
    }
    // No sector data and been reversing/turning a while → search
    if (this.wallTurnTick > 30) {
      this.wallTurnTick = 0;
      this.searchCount = 0;
      return "SEARCH";
    }
    // No data yet → stay avoid
    if (frontDistance <= 0) return "AVOID_WALL";

    return "AVOID_WALL";
  }

  private transitionTrackObject(input: ExplorerInput): ExplorerState {
    const { frontDistance, detections } = input;
    const c = this.cfg;

    // Wall while tracking? → avoid
    if (frontDistance > 0 && frontDistance <= c.wallThreshold) {
      return "AVOID_WALL";
    }

    // Target still visible?
    const found = this.findTarget(detections, this.trackLabel);
    if (found) {
      if (found.area > c.stopZone) {
        // Udah deket, stop
        this.suggestionText = `sampai ${this.trackLabel}`;
      }
      return "TRACK_OBJECT";
    }

    // Lost → search briefly
    this.searchCount = 0;
    return "SEARCH";
  }

  private transitionStuck(_input: ExplorerInput): ExplorerState {
    this.escapeCount = 0;
    return "ESCAPE";
  }

  private transitionEscape(_input: ExplorerInput): ExplorerState {
    this.escapeCount++;
    if (this.escapeCount > this.cfg.escapeDuration) {
      this.searchCount = 0;
      return "SEARCH";
    }
    return "ESCAPE";
  }

  private transitionSearch(_input: ExplorerInput): ExplorerState {
    this.searchCount++;
    // Check if something appears
    if (_input.detections.length > 0) {
      const best = this.findBestObject(_input.detections);
      if (best && best.area >= this.cfg.objectAreaThreshold) {
        this.trackLabel = best.label;
        this.pidI = 0;
        this.pidLastErr = 0;
        return "TRACK_OBJECT";
      }
    }
    // Wall cleared?
    if (_input.frontDistance > 0 && _input.frontDistance > this.cfg.wallThreshold + 10) {
      return "FORWARD";
    }
    if (this.searchCount > this.cfg.searchTimeout) {
      return "FORWARD";
    }
    return "SEARCH";
  }

  // ===== HELPERS =====

  private findFreestSector(sectors: readonly number[]): number {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < sectors.length; i++) {
      const d = sectors[i];
      if (d > 0 && d > bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private findBestObject(detections: readonly Detection[]): { label: string; area: number } | null {
    const vw = 640, vh = 480;
    let best: { label: string; area: number } | null = null;
    for (const d of detections) {
      const box = d.boundingBox;
      if (!box) continue;
      const cat = d.categories?.[0];
      if (!cat || cat.score < this.cfg.trackMinScore) continue;
      if (cat.categoryName === "face") continue;
      const area = (box.width / vw) * (box.height / vh);
      if (!best || area > best.area) {
        best = { label: cat.categoryName, area };
      }
    }
    return best;
  }

  private findTarget(detections: readonly Detection[], label: string | null) {
    if (!label) return null;
    const vw = 640;
    for (const d of detections) {
      const cat = d.categories?.[0];
      if (!cat || cat.categoryName !== label) continue;
      const box = d.boundingBox;
      if (!box) continue;
      const cx = (box.originX + box.width / 2) / vw;
      const area = (box.width / vw) * (box.height / 480);
      return { cx, area };
    }
    return null;
  }

  private decision(
    state: ExplorerState, l: number, r: number,
    sector: number | null, label: string | null,
  ): ExplorerDecision {
    return {
      state,
      leftMotor: l, rightMotor: r,
      targetSector: sector,
      targetLabel: label,
      suggestion: this.suggestionText,
    };
  }
}
