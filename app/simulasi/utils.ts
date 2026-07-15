import { GRID_STEP } from "./constants";

export function gridCellKey(x: number, y: number): string {
  return `${Math.round(x / GRID_STEP)},${Math.round(y / GRID_STEP)}`;
}
