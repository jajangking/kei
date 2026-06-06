import type { MotorCommand } from "./types";

export class MotorSystem {
  private sendRaw: (l: number, r: number) => void;
  private smoothRef = { l: 0, r: 0 };
  private pidIntegral = 0;
  private pidLastError = 0;
  private smoothing = 0.3;

  constructor(sendRaw: (l: number, r: number) => void) {
    this.sendRaw = sendRaw;
  }

  setSmoothing(alpha: number) {
    this.smoothing = alpha;
  }

  cmd(l: number, r: number) {
    l = Math.max(-255, Math.min(255, Math.round(l)));
    r = Math.max(-255, Math.min(255, Math.round(r)));
    const s = this.smoothRef;
    l = Math.round(s.l + (l - s.l) * this.smoothing);
    r = Math.round(s.r + (r - s.r) * this.smoothing);
    s.l = l;
    s.r = r;
    this.sendRaw(l, r);
  }

  stop() {
    this.cmd(0, 0);
  }

  drive(speed: number) {
    this.cmd(speed, speed);
  }

  spin(dir: number) {
    this.cmd(-dir, dir);
  }

  pidTrack(found: { cx: number; cy: number; area: number }, bias = 0) {
    const stopZone = 0.22;
    if (found.area > stopZone) {
      this.smoothRef = { l: 0, r: 0 };
      this.pidIntegral = 0;
      this.pidLastError = 0;
      this.stop();
      return true;
    }
    const errorX = found.cx - 0.5;
    const kp = 160;
    const ki = 0.02;
    const kd = 40;
    this.pidIntegral = Math.max(-50, Math.min(50, this.pidIntegral + errorX));
    const deriv = errorX - this.pidLastError;
    this.pidLastError = errorX;
    const turn = errorX * kp + this.pidIntegral * ki + deriv * kd;
    const speedT = found.area / stopZone;
    const baseSpeed = Math.max(150, Math.round((1 - speedT) * 200));
    let l = baseSpeed + Math.round(turn) + bias;
    let r = baseSpeed - Math.round(turn) - bias;
    this.cmd(l, r);
    return false;
  }

  resetPID() {
    this.pidIntegral = 0;
    this.pidLastError = 0;
  }

  resetSmooth() {
    this.smoothRef = { l: 0, r: 0 };
  }
}
