import type { ScanState, ScanSector } from "./types";

const SECTORS = 8;
const SCAN_ANGLE = 359 * Math.PI / 180; // 359° in radians (full circle, slight margin)

interface Detection {
  categories: { categoryName: string; score: number }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
}

export class Scanner {
  state: ScanState = "idle";
  private startH = 0;
  private sectors: ScanSector[] = [];
  private frameCount = 0;
  private debugLog: string[] = [];

  start(heading: number) {
    this.state = "spinning";
    this.startH = heading;
    this.frameCount = 0;
    this.debugLog = [`[scan] mulai scan heading=${(heading * 180 / Math.PI).toFixed(0)}°`];
    this.sectors = Array.from({ length: SECTORS }, (_, i) => ({
      index: i,
      label: null,
      heading: 0,
      dist: 0,
    }));
    console.log(this.debugLog[0]);
  }

  tick(heading: number, detections: Detection[], vw: number, vh: number) {
    if (this.state !== "spinning") return;

    this.frameCount++;

    const totalSpin = Math.abs(heading - this.startH);
    const sector = Math.min(
      Math.floor((totalSpin / (Math.PI * 2)) * SECTORS),
      SECTORS - 1
    );

    for (const d of detections) {
      const label = d.categories[0].categoryName;
      const score = d.categories[0].score;
      const box = d.boundingBox!;
      const area = (box.width / vw) * (box.height / vh);
      const dist = (1 - Math.min(area * 8, 1)) * 180;

      const existing = this.sectors[sector];
      if (score > 0.5 && area > 0.01) {
        if (!existing.label || area > (box.width / vw) * (box.height / vh)) {
          this.sectors[sector] = { index: sector, label, heading: heading, dist };
        }
      }
    }

    if (totalSpin > SCAN_ANGLE || this.frameCount > 300) {
      this.state = "done";
      const found = this.sectors.filter(s => s.label);
      this.debugLog.push(`[scan] selesai, ${found.length} objek ditemukan`);
      console.log(this.debugLog[this.debugLog.length - 1]);
      console.table(found);
    }
  }

  stop() {
    if (this.state === "spinning") {
      this.state = "done";
      this.debugLog.push("[scan] dihentikan paksa");
      console.log("[scan] dihentikan paksa");
    }
  }

  reset() {
    this.state = "idle";
    this.sectors = [];
    this.frameCount = 0;
    this.debugLog = [];
  }

  getResults(): ScanSector[] {
    return this.sectors.filter(s => s.label);
  }

  getLog(): string[] {
    return this.debugLog;
  }
}
