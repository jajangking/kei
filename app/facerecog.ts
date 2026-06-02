export interface FaceRecord {
  id: string;
  name: string;
  landmarks: number[];
  timestamp: number;
}

const STORAGE_KEY = "kei_face_db";
const SIMILARITY_THRESHOLD = 0.15;

function normalize(pts: number[]): number[] {
  const n = pts.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    cx += pts[i * 2];
    cy += pts[i * 2 + 1];
  }
  cx /= n;
  cy /= n;

  let maxD = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 2] - cx;
    const dy = pts[i * 2 + 1] - cy;
    maxD = Math.max(maxD, Math.hypot(dx, dy));
  }
  if (maxD < 0.001) return pts;

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push((pts[i * 2] - cx) / maxD);
    out.push((pts[i * 2 + 1] - cy) / maxD);
  }
  return out;
}

export function compareLandmarks(a: number[], b: number[]): number {
  const an = normalize(a);
  const bn = normalize(b);
  const len = Math.min(an.length, bn.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += (an[i] - bn[i]) ** 2;
  }
  return Math.sqrt(sum / (len / 2));
}

export function loadDB(): FaceRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDB(db: FaceRecord[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {}
}

export function registerFace(
  db: FaceRecord[],
  name: string,
  landmarks: number[],
): FaceRecord[] {
  const rec: FaceRecord = {
    id: crypto.randomUUID?.() ?? `${Date.now()}_${Math.random()}`,
    name,
    landmarks: normalize(landmarks),
    timestamp: Date.now(),
  };
  const updated = [...db, rec];
  saveDB(updated);
  return updated;
}

export function deleteFace(db: FaceRecord[], id: string): FaceRecord[] {
  const updated = db.filter((r) => r.id !== id);
  saveDB(updated);
  return updated;
}

export function recognize(landmarks: number[], db: FaceRecord[]): FaceRecord | null {
  if (db.length === 0) return null;
  const n = normalize(landmarks);
  let best: FaceRecord | null = null;
  let bestScore = Infinity;
  for (const rec of db) {
    const score = compareLandmarks(n, rec.landmarks);
    if (score < bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  return best && bestScore < SIMILARITY_THRESHOLD ? best : null;
}
