import type { Obstacle, Sector } from "./types";

export const GRID_STEP = 25;
export const TRAIL_LEN = 40;
export const MAX_SENSE = 400;
export const LIDAR_FOV = 7 * Math.PI / 180; // VL53L0X narrow beam ~14° total

// Robot chassis 2WD (mm → 1 unit = 1cm roughly)
export const ROBOT_W = 15;
export const ROBOT_H = 30;
export const ROBOT_R = 15;
export const SERVO_SCALE = 3; // fisik servo cuma noleh 1/SERVO_SCALE dari slider
export const WHEEL_BASE = 14;

// Physical simulation constants
export const ACCEL = 0.08;
export const FRICTION = 0.80;
export const ANG_ACCEL = 0.04;
export const ANG_FRICTION = 0.7;

// Joystick
export const JOY_DEADZONE = 0.12;

// Monitor
export const MAX_LOG = 100;

export const SECTORS: Sector[] = [
  { id: "S1",  min: 20,  max: 30,  cx: 25 },
  { id: "S2",  min: 31,  max: 40,  cx: 35 },
  { id: "S3",  min: 41,  max: 50,  cx: 45 },
  { id: "S4",  min: 51,  max: 60,  cx: 55 },
  { id: "S5",  min: 61,  max: 70,  cx: 65 },
  { id: "S6",  min: 71,  max: 80,  cx: 75 },
  { id: "S7",  min: 81,  max: 90,  cx: 85 },
  { id: "S8",  min: 91,  max: 100, cx: 95 },
  { id: "S9",  min: 101, max: 110, cx: 105 },
  { id: "S10", min: 111, max: 120, cx: 115 },
  { id: "S11", min: 121, max: 130, cx: 125 },
  { id: "S12", min: 131, max: 140, cx: 135 },
  { id: "S13", min: 141, max: 150, cx: 145 },
  { id: "S14", min: 151, max: 160, cx: 155 },
];

export const PRESETS: Record<string, Obstacle[]> = {
  DINDING: [
    { x: -200, y: 250, w: 400, h: 50 },
    { x: -200, y: 100, w: 50, h: 150 },
    { x: 150, y: 100, w: 50, h: 150 },
  ],
  LABIRIN: [
    // Outer Border (800x700 arena)
    { x: -400, y: 0, w: 30, h: 700 },      // Left wall
    { x: 370, y: 0, w: 30, h: 700 },       // Right wall
    { x: -400, y: 0, w: 800, h: 30 },      // Bottom wall
    { x: -400, y: 670, w: 800, h: 30 },    // Top wall

    // Vertical corridors (width ~80-100 for robot passage)
    { x: -250, y: 100, w: 30, h: 200 },    // Left column
    { x: -100, y: 200, w: 30, h: 250 },    // Center-left column
    { x: 50, y: 100, w: 30, h: 200 },      // Center column
    { x: 200, y: 200, w: 30, h: 250 },     // Right column

    // Horizontal corridors
    { x: -300, y: 150, w: 200, h: 30 },    // Upper-left horizontal
    { x: -50, y: 150, w: 200, h: 30 },     // Upper-right horizontal
    { x: -350, y: 300, w: 250, h: 30 },    // Mid-left horizontal
    { x: 80, y: 350, w: 200, h: 30 },      // Mid-right horizontal
    { x: -250, y: 500, w: 200, h: 30 },    // Lower-left horizontal
    { x: 100, y: 550, w: 150, h: 30 },     // Lower-right horizontal

    // Dead-end chambers
    { x: -320, y: 400, w: 30, h: 150 },    // Left chamber wall
    { x: 280, y: 100, w: 30, h: 150 },     // Right chamber wall

    // Central obstacles (target areas)
    { x: -50, y: 400, w: 60, h: 60 },      // Central obstacle 1
    { x: 100, y: 480, w: 50, h: 50 },      // Central obstacle 2
  ],
  RINTANGAN: [
    { x: 100, y: 80, w: 60, h: 60 },
    { x: -120, y: 120, w: 50, h: 50 },
    { x: 50, y: 200, w: 50, h: 80 },
    { x: -80, y: 280, w: 80, h: 60 },
    { x: 160, y: 180, w: 40, h: 40 },
    { x: -180, y: 50, w: 50, h: 50 },
    { x: -40, y: -50, w: 60, h: 60 },
    { x: 30, y: 360, w: 100, h: 50 },
    { x: -200, y: 200, w: 50, h: 50 },
    { x: 150, y: 350, w: 50, h: 50 },
    { x: -50, y: 150, w: 40, h: 40 },
    { x: 200, y: 250, w: 50, h: 50 },
  ],
  BUNTU: [
    { x: -250, y: -50, w: 50, h: 450 },
    { x: 250, y: -50, w: 50, h: 450 },
    { x: -250, y: 350, w: 500, h: 50 },
    { x: -100, y: 150, w: 50, h: 200 },
    { x: 100, y: 200, w: 50, h: 150 },
  ],
  SLALOM: [
    { x: -50, y: 80, w: 300, h: 50 },
    { x: -280, y: 180, w: 300, h: 50 },
    { x: -50, y: 280, w: 320, h: 50 },
    { x: -300, y: 380, w: 300, h: 50 },
    { x: -50, y: 480, w: 350, h: 50 },
  ],
  HUTAN: Array.from({ length: 30 }, (_, i) => ({
    x: Math.round((Math.random() - 0.5) * 700),
    y: Math.round(Math.random() * 500 + 30),
    w: 30 + Math.round(Math.random() * 30),
    h: 30 + Math.round(Math.random() * 30),
  })),
};
