import type { MutableRefObject } from "react";

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

export interface NavDebugData {
  posRef: MutableRefObject<{ x: number; y: number }>;
  headingRef: MutableRefObject<number>;
  sectorDataRef: MutableRefObject<number[]>;
  occupancyRef: MutableRefObject<Map<string, number>>;
}

export interface ModuleCtx {
  sectorDataRef: MutableRefObject<number[]>;
  distanceRef: MutableRefObject<number>;
  headingRef: MutableRefObject<number>;
  gyroRef: MutableRefObject<number>;
  posRef: MutableRefObject<{ x: number; y: number }>;
  servoRef: MutableRefObject<number>;
  leftMotorRef: MutableRefObject<number>;
  rightMotorRef: MutableRefObject<number>;
  trimRef: MutableRefObject<number>;
  sendServo: (deg: number) => void;
  setMotors: (l: number, r: number) => void;
  wsRef: MutableRefObject<WebSocket | null>;
  joyActiveRef: MutableRefObject<boolean>;
  keyActiveRef: MutableRefObject<boolean>;
  logEvent: (msg: string, type?: LogEntryType) => void;
}
