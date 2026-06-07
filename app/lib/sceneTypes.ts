export interface SceneDetection {
  label: string
  score: number
  x: number
  y: number
  width: number
  height: number
  distance?: number
}

export interface SceneFace {
  name: string
}

export interface SceneMessage {
  detections: SceneDetection[]
  faces: SceneFace[]
  heading: number
  position: { x: number; y: number }
  freeSectors: boolean[]
  pathClear: boolean
  tracking: { active: boolean; target?: string; distance?: number }
  mode: string
  battery?: number
  timestamp: number
}
