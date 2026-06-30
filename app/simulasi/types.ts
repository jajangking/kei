export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  seen?: boolean;
}

export type LogEntryType = "info" | "warn" | "error" | "nav" | "sensor" | "motor";

export type LogEntry = {
  time: string;
  msg: string;
  type: LogEntryType;
};

export type ServoRead = {
  angle: number;
  dist: number;
};

export interface Sector {
  id: string;
  min: number;
  max: number;
  cx: number;
}

export type FacingMode = "user" | "environment";

export interface NavDebugData {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  headingRef: React.MutableRefObject<number>;
  sectorDataRef: React.MutableRefObject<number[]>;
  occupancyRef: React.MutableRefObject<Map<string, number>>;
  modul4Active: boolean;
  camActive: boolean;
  ttsActive: boolean;
}

export interface MotorRef {
  sendMotor: (l: number, r: number) => void;
  trackTarget: { label: string; lastSeen: number } | null;
  setTrackTarget: (t: { label: string; lastSeen: number } | null) => void;
  aiMotor: { l: number; r: number } | null;
}
