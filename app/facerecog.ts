export interface FaceRecord {
  id: string;
  name: string;
  features: number[];
  timestamp: number;
}

const STORAGE_KEY = "kei_face_db";
const SIMILARITY_THRESHOLD = 0.15;

function pairwiseDistances(pts: number[]): number[] {
  const n = pts.length / 2;
  const dists: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = pts[i * 2] - pts[j * 2];
      const dy = pts[i * 2 + 1] - pts[j * 2 + 1];
      dists.push(Math.hypot(dx, dy));
    }
  }
  const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
  if (mean < 0.001) return dists;
  return dists.map(d => d / mean);
}

export function compareFaces(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum / len);
}

export function loadDB(): FaceRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const db: FaceRecord[] = raw ? JSON.parse(raw) : [];
    const cleaned = db.filter(r => r.features && r.features.length > 0);
    if (cleaned.length !== db.length) saveDB(cleaned);
    return cleaned;
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
    features: pairwiseDistances(landmarks),
    timestamp: Date.now(),
  };
  const updated = [...db, rec];
  saveDB(updated);
  return updated;
}

export function renameFace(db: FaceRecord[], id: string, name: string): FaceRecord[] {
  const updated = db.map(r => r.id === id ? { ...r, name } : r);
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
  const feats = pairwiseDistances(landmarks);
  let best: FaceRecord | null = null;
  let bestScore = Infinity;
  for (const rec of db) {
    if (!rec.features) continue;
    const score = compareFaces(feats, rec.features);
    if (score < bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  return best && bestScore < SIMILARITY_THRESHOLD ? best : null;
}
