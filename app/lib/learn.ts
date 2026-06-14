export type SensorSnapshot = {
  farLeft: number;
  midLeft: number;
  nearLeft: number;
  front: number;
  nearRight: number;
  midRight: number;
  farRight: number;
  gyro: number;
  wallLeft: boolean;
  wallRight: boolean;
};

export type MotorCmd = {
  left: number;
  right: number;
};

export class LearningDB {
  private data: Array<{ snap: SensorSnapshot; cmd: MotorCmd; rating: -1 | 1 }> = [];

  get size(): number {
    return this.data.length;
  }

  record(snap: SensorSnapshot, cmd: MotorCmd, rating: -1 | 1): void {
    this.data.push({ snap, cmd, rating });
  }

  predict(snap: SensorSnapshot): MotorCmd | null {
    if (this.data.length === 0) return null;
    const last = this.data[this.data.length - 1];
    return last.cmd;
  }

  forget(): void {
    this.data = [];
  }
}
