export type ScanState = "idle" | "spinning" | "done";

export interface ScanSector {
  index: number;
  label: string | null;
  heading: number;
  dist: number;
}

export interface MotorCommand {
  l: number;
  r: number;
}

export interface WallResult {
  blocked: boolean;
  left: boolean;
  center: boolean;
  right: boolean;
}

export interface EdgeResult {
  left: number;
  center: number;
  right: number;
}

export interface BrainstemResult {
  override: boolean;
  command: MotorCommand;
  reason?: string;
}

export interface SeenObject {
  label: string;
  score: number;
  sector: number;
  cx: number;
  cy: number;
  area: number;
  dist: number;
}
