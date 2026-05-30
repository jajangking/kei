"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ObjectDetector, FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision";
import Simulasi from "./simulasi";
import { loadDB, saveDB, registerFace, recognize, type FaceRecord } from "./facerecog";

interface Telemetry {
  battery?: number;
  speed?: number;
  mode?: string;
  temp?: number;
}

export default function VisionPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const [active, setActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [source, setSource] = useState<"local" | "stream">("local");
  const [streamUrl, setStreamUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");

  const [espIp, setEspIp] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [showEspInput, setShowEspInput] = useState(false);
  const [leftMotor, setLeftMotor] = useState(0);
  const [rightMotor, setRightMotor] = useState(0);
  const [telemetry, setTelemetry] = useState<Telemetry>({});

  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [detectionCount, setDetectionCount] = useState(0);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const detectionsRef = useRef<Detection[]>([]);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const faceTickRef = useRef(0);
  const faceDBRef = useRef<FaceRecord[]>([]);
  const faceLandmarksRef = useRef<number[]>([]);
  const recognizedFaceRef = useRef<FaceRecord | null>(null);
  const [registering, setRegistering] = useState(false);
  const [regName, setRegName] = useState("");

  interface SmoothBox {
    key: string;
    x: number; y: number; w: number; h: number;
    score: number;
    label: string;
  }
  const smoothRef = useRef<SmoothBox[]>([]);

  const [straightAssist, setStraightAssist] = useState(false);
  const straightAssistRef = useRef(false);

  const [tracking, setTracking] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(true);
  const trackingRef = useRef(false);
  const [trackInfo, setTrackInfo] = useState("");
  const trackTargetRef = useRef<{ label: string; lastSeen: number } | null>(null);
  const trackLabelRef = useRef<string | null>(null);
  const trackLostRef = useRef(0);
  const persistenceRef = useRef<Map<string, number[]>>(new Map());
  const HYST_ACQUIRE = 0.35;
  const HYST_RELEASE = 0.25;
  const PERSIST_FRAMES = 5;
  const PERSIST_MIN = 2;
  const searchPhaseRef = useRef(0);
  const searchTimerRef = useRef(0);
  const [pickerTargets, setPickerTargets] = useState<string[]>([]);
  const scanStateRef = useRef<'idle'|'scanning'|'waiting'|'moving'>('idle');
  const scanFrameRef = useRef(0);
  const scanMapRef = useRef<Array<{label: string; area: number}[]>>([]);
  const scanTargetSeeRef = useRef(false);
  const scanBestSecRef = useRef(0);
  const headingRef = useRef(0);
  const posRef = useRef({ x: 300, y: 300 });
  interface TeleEntry { label: string; x: number; y: number; score: number; lastSeen: number; area: number; }
  const telemetryMapRef = useRef<TeleEntry[]>([]);
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brightnessRef = useRef(255);
  const darkFramesRef = useRef(0);
  const darkAvoidRef = useRef(false);
  const darkPhaseRef = useRef(0);
  const darkTimerRef = useRef(0);

  const [debug, setDebug] = useState(false);
  const debugRef = useRef(false);
  const detectTimeRef = useRef(0);

  const sendMotor = useCallback((l: number, r: number) => {
    const h = headingRef.current;
    const p = posRef.current;
    const diff = Math.abs(l - r);
    const sum = Math.abs(l + r);
    if (diff > 30 && sum < 80) {
      headingRef.current += (r - l) / 510 * 0.06;
    } else if (sum > 30 && diff < 80) {
      const avg = (l + r) / 510;
      p.x += Math.sin(h) * avg * 2;
      p.y -= Math.cos(h) * avg * 2;
    } else if (diff > 30 && sum > 30) {
      headingRef.current += (r - l) / 510 * 0.03;
      const avg = (l + r) / 510;
      p.x += Math.sin(h) * avg * 1.5;
      p.y -= Math.cos(h) * avg * 1.5;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ leftMotor: l, rightMotor: r }));
    }
  }, []);

  // Keyboard
  const keysRef = useRef(new Set<string>());
  const rafRef = useRef(0);
  const lastMotorRef = useRef({ l: 0, r: 0 });
  useEffect(() => {
    const loop = () => {
      if (joyActiveRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const k = keysRef.current;
      let l = 0, r = 0;
      if (k.has("w") || k.has("arrowup")) { l = 255; r = 255; }
      if (k.has("s") || k.has("arrowdown")) { l = -255; r = -255; }
      if (k.has("a") || k.has("arrowleft")) { l = -255; r = 255; }
      if (k.has("d") || k.has("arrowright")) { l = 255; r = -255; }
      const last = lastMotorRef.current;
      if (l !== last.l || r !== last.r) {
        lastMotorRef.current = { l, r };
        setLeftMotor(l); setRightMotor(r);
        sendMotor(l, r);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    const down = (e: KeyboardEvent) => {
      if (joyActiveRef.current) return;
      keysRef.current.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => {
      if (joyActiveRef.current) return;
      keysRef.current.delete(e.key.toLowerCase());
      if (keysRef.current.size === 0) { setLeftMotor(0); setRightMotor(0); sendMotor(0, 0); }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [sendMotor, setLeftMotor, setRightMotor]);

  // Joystick
  const joystickRef = useRef<HTMLDivElement>(null);
  const joyActiveRef = useRef(false);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const maxRRef = useRef(60);

  const handleJoyMove = useCallback((clientX: number, clientY: number) => {
    const el = joystickRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width / 2 - 10;
    maxRRef.current = maxR;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    setJoyPos({ x: dx, y: dy });
    const nx = dx / maxR;
    const ny = -dy / maxR;
    let l = (ny + nx) * 255;
    let r = (ny - nx) * 255;
    l = Math.max(-255, Math.min(255, Math.round(l)));
    r = Math.max(-255, Math.min(255, Math.round(r)));

    if (straightAssistRef.current && l * r > 0 && l !== 0) {
      const results = detectionsRef.current;
      const video = videoRef.current;
      const vw = video?.videoWidth || 640;
      let bestCx = 0;
      let bestDist = Infinity;
      for (const d of results) {
        const box = d.boundingBox!;
        const cx = (box.originX + box.width / 2) / vw - 0.5;
        const ad = Math.abs(cx);
        if (ad < bestDist) { bestDist = ad; bestCx = cx; }
      }
      if (bestDist < 0.4) {
        const corr = Math.round(bestCx * 0.3 * Math.abs(l));
        l -= corr;
        r += corr;
      }
    }

    setLeftMotor(l); setRightMotor(r);
    sendMotor(l, r);
  }, [sendMotor, setLeftMotor, setRightMotor]);

  const handleJoyEnd = useCallback(() => {
    joyActiveRef.current = false;
    setLeftMotor(0); setRightMotor(0);
    setJoyPos({ x: 0, y: 0 });
    sendMotor(0, 0);
  }, [sendMotor, setLeftMotor, setRightMotor]);

  // Sync joystick visual from motor values
  useEffect(() => {
    if (joyActiveRef.current) return;
    const maxR = maxRRef.current;
    if (maxR <= 0) return;
    const ny = (leftMotor + rightMotor) / 510;
    const nx = (leftMotor - rightMotor) / 510;
    setJoyPos({ x: nx * maxR, y: -ny * maxR });
  }, [leftMotor, rightMotor]);

  // ESP
  const connectESP = useCallback(() => {
    if (!espIp) return;
    wsRef.current?.close();
    const ws = new WebSocket(`ws://${espIp}:81`);
    ws.onopen = () => setWsConnected(true);
    ws.onmessage = (e) => {
      try { setTelemetry(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => { setWsConnected(false); setTelemetry({}); wsRef.current = null; };
    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [espIp]);

  // Camera
  useEffect(() => {
    if (!active || source !== "local") return;
    let cancelled = false;
    (async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch { setActive(false); }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [active, facingMode, source]);

  // MediaPipe models
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setModelLoading(true);
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks("/wasm");
        if (cancelled) return;
        const [det, faceDet] = await Promise.all([
          ObjectDetector.createFromOptions(vision, {
            baseOptions: { modelAssetPath: "/efficientdet_lite0.tflite" },
            scoreThreshold: 0.3,
            maxResults: 5,
            runningMode: "VIDEO",
          }),
          FaceDetector.createFromOptions(vision, {
            baseOptions: { modelAssetPath: "/blaze_face_short_range.tflite" },
            runningMode: "VIDEO",
          }),
        ]);
        if (cancelled) { det.close(); faceDet.close(); return; }
        detectorRef.current = det;
        faceDetectorRef.current = faceDet;
        setModelReady(true);
        setModelLoading(false);
      } catch {
        setModelReady(false);
        setModelLoading(false);
      }
    })();
    return () => { cancelled = true; detectorRef.current?.close(); detectorRef.current = null; faceDetectorRef.current?.close(); faceDetectorRef.current = null; setModelReady(false); setModelLoading(false); };
  }, [active]);

  // Detection + render loop
  const detectingRef = useRef(false);
  useEffect(() => {
    if (!active || !modelReady) { detectingRef.current = false; return; }

    const video = videoRef.current;
    if (!video) return;

    detectingRef.current = true;

    const detectAndDraw = () => {
      if (!detectingRef.current) return;
      const det = detectorRef.current;
      if (!det || !video || video.readyState < 2 || !video.videoWidth) return;

      // Skip heavy inference while user is manually driving via joystick
      if (!joyActiveRef.current) {
        const t0 = performance.now();
        try {
          const results = det.detectForVideo(video, performance.now());
          detectTimeRef.current = Math.round(performance.now() - t0);
          let all: Detection[] = results.detections;
          setDetectionCount(results.detections.length);

          // Run face detection every other tick
          faceTickRef.current++;
          if (faceTickRef.current % 2 === 0) {
            const faceDet = faceDetectorRef.current;
            if (faceDet) {
              const faceResults = faceDet.detectForVideo(video, performance.now());
              for (const d of faceResults.detections) {
                if (d.categories[0]) d.categories[0].categoryName = 'face';
                all.push(d);
              }
              // Recognize face from keypoints
              if (faceResults.detections.length > 0) {
                const fd = faceResults.detections[0];
                if (fd.keypoints && fd.keypoints.length >= 4) {
                  const kp: number[] = [];
                  for (const k of fd.keypoints) { kp.push(k.x * (video?.videoWidth || 640), k.y * (video?.videoHeight || 480)); }
                  faceLandmarksRef.current = kp;
                  const rec = recognize(kp, faceDBRef.current);
                  recognizedFaceRef.current = rec;
                }
              } else {
                recognizedFaceRef.current = null;
              }
            }
          }

          detectionsRef.current = all;
          updateSmooth(all);
        } catch (err) {
          console.error("detect error:", err);
        }
      }

      drawOverlay();
      processTracking(detectionsRef.current);
    };

    const detectIv = setInterval(detectAndDraw, 250);
    return () => { detectingRef.current = false; clearInterval(detectIv); };
  }, [active, modelReady]);

  function updateSmooth(raw: Detection[]) {
    const existing = smoothRef.current;
    const matched = new Set<number>();

    const next: SmoothBox[] = [];

    for (const d of raw) {
      const box = d.boundingBox!;
      const cat = d.categories[0];
      const key = cat.categoryName;
      const cx = box.originX + box.width / 2;
      const cy = box.originY + box.height / 2;

      let best = -1;
      let bestDist = 80;
      for (let i = 0; i < existing.length; i++) {
        if (matched.has(i)) continue;
        if (existing[i].key !== key) continue;
        const dx = existing[i].x + existing[i].w / 2 - cx;
        const dy = existing[i].y + existing[i].h / 2 - cy;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }

      const alpha = 0.5;
      if (best >= 0) {
        matched.add(best);
        const e = existing[best];
        next.push({
          key,
          x: e.x + (box.originX - e.x) * alpha,
          y: e.y + (box.originY - e.y) * alpha,
          w: e.w + (box.width - e.w) * alpha,
          h: e.h + (box.height - e.h) * alpha,
          score: cat.score,
          label: `${cat.categoryName} ${(cat.score * 100).toFixed(0)}%`,
        });
      } else {
        next.push({
          key, x: box.originX, y: box.originY, w: box.width, h: box.height,
          score: cat.score,
          label: `${cat.categoryName} ${(cat.score * 100).toFixed(0)}%`,
        });
      }
    }

    smoothRef.current = next;
  }

  function drawOverlay() {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const rect = canvas.parentElement!.getBoundingClientRect();
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const ox = (rect.width - vw * scale) / 2;
    const oy = (rect.height - vh * scale) / 2;

    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.clearRect(0, 0, rect.width, rect.height);

    for (const s of smoothRef.current) {
      const x = ox + s.x * scale;
      const y = oy + s.y * scale;
      const w = s.w * scale;
      const h = s.h * scale;
      const len = Math.max(10, Math.min(24, Math.min(w, h) * 0.2));
      const isLocked = tracking && s.key === trackLabelRef.current;
      const isFace = s.key === 'face';
      const color = isLocked ? "#ef4444" : isFace ? "#d946ef" : "#3b82f6";

      ctx.save();

      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = color;
      ctx.lineWidth = isLocked ? 2.5 : 2;
      ctx.beginPath();
      ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
      ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
      ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
      ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // For face detections, only show label if recognized
      const displayLabel = isFace
        ? (recognizedFaceRef.current ? recognizedFaceRef.current.name : null)
        : s.label;

      if (displayLabel) {
        ctx.font = "10px monospace";
        const tw = ctx.measureText(displayLabel).width;
        const labelAbove = y > 22;
        const lx = x;
        const ly = labelAbove ? y - 20 : y + h + 2;

        ctx.beginPath();
        ctx.roundRect(lx, ly, tw + 10, 18, 3);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#fff";
        ctx.fillText(displayLabel, lx + 5, ly + 13);
      }

      ctx.restore();
    }
  }

  function sampleBrightness(): number {
    let canvas = brightnessCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      brightnessCanvasRef.current = canvas;
    }
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return 255;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 255;
    ctx.drawImage(video, 0, 0);
    const data = ctx.getImageData(0, 0, video.videoWidth, video.videoHeight).data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 32) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      count++;
    }
    return sum / count;
  }

  function filterDetections(raw: Detection[]): Detection[] {
    const persist = persistenceRef.current;
    const seen = new Set<string>();

    for (const d of raw) {
      const label = d.categories[0].categoryName;
      const score = d.categories[0].score;
      const target = trackTargetRef.current;
      const thresh = target && target.label === label ? HYST_RELEASE : HYST_ACQUIRE;
      if (score >= thresh) {
        seen.add(label);
      }
    }

    // Update persistence buffer
    for (const [label, buf] of persist) {
      buf.push(seen.has(label) ? 1 : 0);
      if (buf.length > PERSIST_FRAMES) buf.shift();
    }
    for (const label of seen) {
      if (!persist.has(label)) {
        persist.set(label, [1]);
      }
    }

    const stable = new Set<string>();
    for (const [label, buf] of persist) {
      if (buf.length >= PERSIST_MIN) {
        const count = buf.reduce((a, b) => a + b, 0);
        if (count >= PERSIST_MIN) stable.add(label);
      }
    }

    return raw.filter(d => {
      const label = d.categories[0].categoryName;
      const score = d.categories[0].score;
      const target = trackTargetRef.current;
      const thresh = target && target.label === label ? HYST_RELEASE : HYST_ACQUIRE;
      return score >= thresh && stable.has(label);
    });
  }

  function processTracking(detections: Detection[]) {
    if (!trackingRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    const stableDetections = filterDetections(detections);

    // Dark detection
    brightnessRef.current = sampleBrightness();
    if (brightnessRef.current < 35) {
      darkFramesRef.current++;
    } else {
      darkFramesRef.current = 0;
      darkAvoidRef.current = false;
    }
    if (darkFramesRef.current > 15) {
      darkAvoidRef.current = true;
    }

    if (darkAvoidRef.current) {
      const p = darkPhaseRef.current;
      darkTimerRef.current++;
      if (p === 0) {
        setLeftMotor(0); setRightMotor(0);
        sendMotor(0, 0);
        setTrackInfo('gelap!');
        if (darkTimerRef.current > 10) {
          darkPhaseRef.current = 1;
          darkTimerRef.current = 0;
        }
      } else if (p === 1) {
        setLeftMotor(-180); setRightMotor(-180);
        sendMotor(-180, -180);
        if (darkTimerRef.current > 20) {
          darkPhaseRef.current = 2;
          darkTimerRef.current = 0;
        }
      } else if (p === 2) {
        setLeftMotor(-180); setRightMotor(180);
        sendMotor(-180, 180);
        if (darkTimerRef.current > 120) {
          darkPhaseRef.current = 3;
          darkTimerRef.current = 0;
        }
      } else {
        setLeftMotor(0); setRightMotor(0);
        sendMotor(0, 0);
        darkAvoidRef.current = false;
        darkFramesRef.current = 0;
        darkPhaseRef.current = 0;
        scanStateRef.current = 'idle';
        setTrackInfo('cari...');
      }
      return;
    }

    // Update telemetry map with persistent object positions
    {
      const h = headingRef.current;
      const p = posRef.current;
      const now = Date.now();
      const map = telemetryMapRef.current;
      const used = new Set<number>();
      for (const d of detections) {
        const box = d.boundingBox!;
        const cat = d.categories[0];
        const nx = (box.originX + box.width / 2) / vw;
        const area = (box.width / vw) * (box.height / vh);
        if (area < 0.005) continue;
        const angle = (nx - 0.5) * Math.PI;
        const dist = (1 - Math.min(area * 8, 1)) * 180;
        const absAngle = h + angle - Math.PI / 2;
        const wx = p.x + Math.cos(absAngle) * dist;
        const wy = p.y + Math.sin(absAngle) * dist;
        let matched = -1;
        for (let i = 0; i < map.length; i++) {
          if (used.has(i)) continue;
          if (map[i].label !== cat.categoryName) continue;
          if (Math.hypot(map[i].x - wx, map[i].y - wy) < 40) {
            matched = i;
            break;
          }
        }
        if (matched >= 0) {
          const e = map[matched];
          e.x = e.x + (wx - e.x) * 0.3;
          e.y = e.y + (wy - e.y) * 0.3;
          e.score = Math.max(e.score, cat.score);
          e.area = Math.max(e.area, area);
          e.lastSeen = now;
          used.add(matched);
        } else {
          map.push({ label: cat.categoryName, x: wx, y: wy, score: cat.score, lastSeen: now, area });
          used.add(map.length - 1);
        }
      }
      // Remove stale entries (>30s old)
      for (let i = map.length - 1; i >= 0; i--) {
        if (now - map[i].lastSeen > 30000) map.splice(i, 1);
      }
    }

    const target = trackTargetRef.current;

    if (target) {
      let found: { cx: number; cy: number; area: number; box: Detection["boundingBox"] } | null = null;
      for (const d of stableDetections) {
        if (d.categories[0].categoryName !== target.label) continue;
        const box = d.boundingBox!;
        const cx = (box.originX + box.width / 2) / vw;
        const cy = (box.originY + box.height / 2) / vh;
        const area = (box.width / vw) * (box.height / vh);
        if (area < 0.005) continue;
        if (!found || Math.hypot(cx - 0.5, cy - 0.5) < Math.hypot(found.cx - 0.5, found.cy - 0.5)) {
          found = { cx, cy, area, box };
        }
      }

      if (found) {
        trackLostRef.current = 0;
        scanStateRef.current = 'idle';
        trackTargetRef.current = { ...target, lastSeen: Date.now() };
        setTrackInfo(`${target.label}`);
        trackObject(found);
      } else {
        trackLostRef.current++;
        if (trackLostRef.current > 10) {
          trackTargetRef.current = null;
          setTrackInfo(`cari ${trackLabelRef.current}...`);
        }
      }
    }

    if (!trackTargetRef.current) {
      let best: { area: number; label: string } | null = null;
      for (const d of stableDetections) {
        if (trackLabelRef.current && d.categories[0].categoryName !== trackLabelRef.current) continue;
        const box = d.boundingBox!;
        const area = (box.width / vw) * (box.height / vh);
        if (area > 0.015 && (!best || area > best.area)) {
          best = { area, label: d.categories[0].categoryName };
        }
      }
      if (best) {
        trackTargetRef.current = { label: best.label, lastSeen: Date.now() };
        trackLabelRef.current = best.label;
        trackLostRef.current = 0;
        scanStateRef.current = 'idle';
        setTrackInfo(`🔒 ${best.label}`);
        return;
      }

      const SCAN_FRAMES = 240;
      const SECTORS = 16;
      const scan = scanStateRef.current;

      if (scan === 'idle') {
        scanStateRef.current = 'scanning';
        scanFrameRef.current = 0;
        scanMapRef.current = Array.from({length: SECTORS}, () => []);
        scanTargetSeeRef.current = false;
        setTrackInfo('scan...');
      }

      if (scan === 'scanning') {
        scanFrameRef.current++;
        const speed = 150;
        setLeftMotor(-speed); setRightMotor(speed);
        sendMotor(-speed, speed);

        const sector = Math.min(Math.floor((scanFrameRef.current / SCAN_FRAMES) * SECTORS), SECTORS - 1);
        const sectorData = scanMapRef.current[sector];
        for (const d of stableDetections) {
          const box = d.boundingBox!;
          const label = d.categories[0].categoryName;
          const area = (box.width / vw) * (box.height / vh);
          if (area > 0.005) {
            sectorData.push({label, area});
          }
          if (trackLabelRef.current && label === trackLabelRef.current) {
            scanTargetSeeRef.current = true;
          }
        }

        if (scanFrameRef.current >= SCAN_FRAMES) {
          scanStateRef.current = 'waiting';
          scanFrameRef.current = 0;
          setLeftMotor(0); setRightMotor(0);
          sendMotor(0, 0);

          let bestSec = 0;
          if (scanTargetSeeRef.current && trackLabelRef.current) {
            let bestArea = 0;
            for (let i = 0; i < SECTORS; i++) {
              for (const o of scanMapRef.current[i]) {
                if (o.label === trackLabelRef.current && o.area > bestArea) {
                  bestArea = o.area;
                  bestSec = i;
                }
              }
            }
            setTrackInfo('target terlihat!');
          } else {
            let leastObj = Infinity;
            for (let i = 0; i < SECTORS; i++) {
              const count = scanMapRef.current[i].length;
              if (count < leastObj) {
                leastObj = count;
                bestSec = i;
              }
            }
            setTrackInfo(`arah ${bestSec}`);
          }
          scanBestSecRef.current = bestSec;
        }
      }

      if (scan === 'waiting') {
        scanFrameRef.current++;
        const elapsed = scanFrameRef.current;

        if (elapsed < 10) {
          setLeftMotor(0); setRightMotor(0);
          sendMotor(0, 0);
          return;
        }

        const speed = 150;
        const bestSec = scanBestSecRef.current;
        const lastScanSector = SECTORS - 1;
        const dstCW = (bestSec - lastScanSector + SECTORS) % SECTORS;
        const dstCCW = (lastScanSector - bestSec + SECTORS) % SECTORS;
        const rotateSectors = Math.min(dstCW, dstCCW);
        const reverse = dstCCW < dstCW;
        const rotateFrames = Math.round((rotateSectors / SECTORS) * SCAN_FRAMES);
        const rotElapsed = elapsed - 10;

        if (rotElapsed < rotateFrames) {
          if (reverse) {
            setLeftMotor(speed); setRightMotor(-speed);
            sendMotor(speed, -speed);
          } else {
            setLeftMotor(-speed); setRightMotor(speed);
            sendMotor(-speed, speed);
          }
          setTrackInfo(`muter...`);
        } else {
          setLeftMotor(0); setRightMotor(0);
          sendMotor(0, 0);

          if (scanTargetSeeRef.current && trackLabelRef.current) {
            scanStateRef.current = 'idle';
            setTrackInfo('cari...');
          } else {
            scanStateRef.current = 'moving';
            scanFrameRef.current = 0;
            setTrackInfo('maju...');
          }
        }
      }

      if (scan === 'moving') {
        scanFrameRef.current++;
        setLeftMotor(200); setRightMotor(200);
        sendMotor(200, 200);
        if (scanFrameRef.current >= 90) {
          setLeftMotor(0); setRightMotor(0);
          sendMotor(0, 0);
          scanStateRef.current = 'idle';
          setTrackInfo('cari lagi...');
        }
      }
    }
  }

  function trackObject(found: { cx: number; cy: number; area: number }) {
    const stopZone = 0.18;
    if (found.area > stopZone) {
      setLeftMotor(0); setRightMotor(0);
      sendMotor(0, 0);
      setTrackInfo(`🔒 ${trackLabelRef.current} ✅`);
      return;
    }
    const errorX = found.cx - 0.5;
    const kp = 350;
    const turn = errorX * kp;
    const speedT = found.area / stopZone;
    const baseSpeed = Math.round((1 - speedT) * 255);
    let l = baseSpeed - Math.round(turn);
    let r = baseSpeed + Math.round(turn);
    l = Math.max(-255, Math.min(255, l));
    r = Math.max(-255, Math.min(255, r));
    setLeftMotor(l); setRightMotor(r);
    sendMotor(l, r);
  }

  useEffect(() => { faceDBRef.current = loadDB(); }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  return (
    <main className="flex flex-col items-center bg-black min-h-dvh px-3 pt-3 pb-3 gap-2 overflow-y-auto">
      {/* CAMERA + OVERLAY + HUD */}
      <div className="relative w-full max-w-sm aspect-square rounded-xl overflow-hidden bg-zinc-900 ring-1 ring-white/10 flex-shrink-0">
        {source === "local" ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-contain" />
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none z-20" />
          </>
        ) : streamUrl ? (
          <img src={streamUrl} alt="stream" className="absolute inset-0 h-full w-full object-contain" />
        ) : null}

        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <div className="size-8 rounded-full border border-zinc-600 flex items-center justify-center">
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <span className="text-[9px] font-medium tracking-wider">MATI</span>
          </div>
        )}

        {source === "stream" && !streamUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <div className="size-8 rounded-full border border-zinc-600 flex items-center justify-center">
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <span className="text-[9px] font-medium tracking-wider">STREAM KOSONG</span>
          </div>
        )}

        {/* Top HUD */}
        <button onClick={() => setShowEspInput((p) => !p)}
          className="absolute top-1.5 left-1.5 z-30 size-7 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-black/70">
          <div className={`size-2.5 rounded-full ${wsConnected ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" : "bg-zinc-500"}`} />
        </button>
        {modelLoading && !modelReady && (
          <div className="absolute top-1.5 left-9 z-30 flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-[7px] text-yellow-400 font-mono">model...</span>
          </div>
        )}
        {modelReady && (
          <div className="absolute top-1.5 left-9 z-30 flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-green-400" />
            <span className="text-[7px] text-green-400 font-mono">{detectionCount} obj</span>
            <button onClick={() => {
              if (tracking) {
                setTracking(false); trackingRef.current = false; trackTargetRef.current = null; trackLabelRef.current = null; setTrackInfo(""); setPickerTargets([]);
              } else {
                setTracking(true); trackingRef.current = true;
                const labels = [...new Set(detectionsRef.current.map(d => d.categories[0].categoryName))];
                if (labels.length === 0) { setTrackInfo("mencari..."); } else if (labels.length === 1) {
                  trackTargetRef.current = { label: labels[0], lastSeen: Date.now() }; trackLabelRef.current = labels[0]; setTrackInfo(`🔒 ${labels[0]}`); setPickerTargets([]);
                } else { setPickerTargets(labels); setTrackInfo("pilih objek"); }
              }
            }}
              className="ml-1 size-4 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border"
              style={{ backgroundColor: tracking ? "#ef4444" : "transparent", borderColor: tracking ? "#ef4444" : "rgba(255,255,255,0.2)", color: tracking ? "#000" : "rgba(255,255,255,0.5)" }}>
              F
            </button>
            {tracking && trackInfo && (
              <span className="text-[7px] text-red-400 font-mono ml-0.5">{trackInfo}</span>
            )}
            <button onClick={() => { setDebug(p => { debugRef.current = !p; return !p; }); }}
              className="ml-1 size-4 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border"
              style={{ backgroundColor: debug ? "rgba(255,255,255,0.2)" : "transparent", borderColor: debug ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)", color: debug ? "#fff" : "rgba(255,255,255,0.4)" }}>
              D
            </button>
          </div>
        )}
        <button onClick={() => { if (source === "stream") { setSource("local"); setActive(false); } else { setSource("stream"); setActive(true); } }}
          className="absolute top-1.5 right-1.5 z-30 size-7 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-black/70 active:scale-90">
          <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12.75 3.03v.568c0 .334.148.65.405.864l1.068.89c.442.369.535 1.01.216 1.49l-.51.766a2.25 2.25 0 0 1-1.161.886l-.143.048a1.107 1.107 0 0 0-.57 1.664c.369.555.169 1.307-.427 1.605L9 13.125l3.75-6.375" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 20.25a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          </svg>
        </button>

        {/* Bottom HUD */}
        {source === "local" && (
          <button onClick={() => setActive((p) => !p)}
            className="absolute bottom-1.5 right-1.5 z-30 size-8 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-black/70 active:scale-90">
            <div className={`size-2.5 rounded-full duration-300 ${active ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-zinc-500"}`} />
          </button>
        )}
        {source === "local" && (
          <button onClick={() => setFacingMode((p) => p === "environment" ? "user" : "environment")}
            className="absolute bottom-1.5 left-1.5 z-30 size-8 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-black/70 active:scale-90">
            <svg className="size-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </button>
        )}

        {/* TARGET PICKER */}
        {pickerTargets.length > 0 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 flex gap-1.5">
            {pickerTargets.map(label => (
              <button key={label} onClick={() => { trackTargetRef.current = { label, lastSeen: Date.now() }; trackLabelRef.current = label; setTrackInfo(`🔒 ${label}`); setPickerTargets([]); }}
                className="px-2 py-1 rounded-full bg-black/70 text-white text-[9px] font-mono font-bold border border-white/20 backdrop-blur-md active:scale-90">
                {label}
              </button>
            ))}
          </div>
        )}

        {/* FACE REGISTER */}
        {!registering && recognizedFaceRef.current === null && faceLandmarksRef.current.length > 0 && (
          <button onClick={() => { setRegistering(true); setRegName(""); }}
            className="absolute bottom-8 right-2 z-40 size-7 rounded-full bg-fuchsia-600/80 text-white text-[8px] font-mono font-bold border border-fuchsia-400/40 backdrop-blur-md flex items-center justify-center active:scale-90">
            +
          </button>
        )}
        {registering && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex gap-1 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl px-2.5 py-2 items-center">
            <input value={regName} onChange={e => setRegName(e.target.value)} placeholder="nama"
              className="w-24 px-1.5 py-0.5 rounded bg-zinc-800 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
            <button onClick={() => {
              if (!regName) return;
              faceDBRef.current = registerFace(faceDBRef.current, regName, faceLandmarksRef.current);
              recognizedFaceRef.current = faceDBRef.current[faceDBRef.current.length - 1];
              setRegistering(false);
            }}
              className="px-2 py-0.5 rounded-full bg-fuchsia-600 text-white text-[7px] font-mono font-bold active:scale-90">
              SIMPAN
            </button>
            <button onClick={() => setRegistering(false)}
              className="px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300 text-[7px] font-mono active:scale-90">
              X
            </button>
          </div>
        )}
      </div>

      {/* DEBUG PANEL */}
      {debug && (
        <div className="w-full max-w-sm rounded-xl bg-zinc-900/90 ring-1 ring-white/10 px-3 py-2 text-[8px] font-mono">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-zinc-400">
            <span>detect: <span className="text-white">{detectTimeRef.current}ms</span></span>
            <span>fps: <span className="text-white">{detectTimeRef.current > 0 ? (1000 / detectTimeRef.current).toFixed(1) : "-"}</span></span>
            <span>model: <span className="text-white">EfficientDet Lite0</span></span>
            <span>motor: <span className="text-blue-400">L:{leftMotor}</span> <span className="text-orange-400">R:{rightMotor}</span></span>
            <span>track: <span className="text-white">{trackInfo || "-"}</span></span>
            <span>scan: <span className="text-purple-400">{scanStateRef.current}</span></span>
            <span>gelap: <span className={darkAvoidRef.current ? "text-red-400" : "text-zinc-600"}>{darkAvoidRef.current ? "YA" : "tidak"}</span> <span className="text-zinc-600">({brightnessRef.current.toFixed(0)})</span></span>
            <span>ws: <span className={wsConnected ? "text-green-400" : "text-red-400"}>{wsConnected ? "ON" : "OFF"}</span></span>
          </div>
          {detectionsRef.current.length > 0 && (
            <div className="mt-1 pt-1 border-t border-white/5 text-zinc-500 leading-3">
              {detectionsRef.current.map((d, i) => {
                const b = d.boundingBox!;
                return (
                  <div key={i} className="truncate">
                    <span className="text-green-400">{d.categories[0].categoryName}</span>
                    <span className="text-zinc-600"> ({d.categories[0].score.toFixed(2)}) </span>
                    <span className="text-zinc-600">[{b.originX.toFixed(0)},{b.originY.toFixed(0)} {b.width.toFixed(0)}x{b.height.toFixed(0)}]</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ESP / STREAM INPUT */}
      {showEspInput && (
        <div className="flex gap-1.5 w-full max-w-sm">
          <input value={espIp} onChange={(e) => setEspIp(e.target.value)}
            placeholder="IP ESP32"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
          <button onClick={connectESP}
            className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-200 flex-shrink-0">
            {wsConnected ? "PUTUS" : "HUBUNG"}
          </button>
        </div>
      )}

      {source === "stream" && !showEspInput && (
        <div className="flex gap-1.5 w-full max-w-sm">
          <input value={inputUrl} onChange={(e) => setInputUrl(e.target.value)}
            placeholder="URL stream"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
          <button onClick={() => setStreamUrl(inputUrl)}
            className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold hover:bg-zinc-200 flex-shrink-0">
            {streamUrl ? "GANTI" : "PAKAI"}
          </button>
        </div>
      )}

      {/* TELEMETRI + JOYSTICK */}
      <div className="w-full max-w-sm grid grid-cols-2 gap-2">
        <div className="aspect-square rounded-xl bg-zinc-900 ring-1 ring-white/10 relative overflow-hidden">
          {showTelemetry ? (
            <Simulasi
              headingRef={headingRef}
              posRef={posRef}
              telemetryMapRef={telemetryMapRef}
              scanStateRef={scanStateRef}
              scanMapRef={scanMapRef}
              scanBestSecRef={scanBestSecRef}
              scanTargetSeeRef={scanTargetSeeRef}
              trackLabelRef={trackLabelRef}
              trackTargetRef={trackTargetRef}
              detectionsRef={detectionsRef}
              trackingRef={trackingRef}
              leftMotor={leftMotor}
              rightMotor={rightMotor}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[8px] font-mono text-zinc-600">TELEMETRI OFF</span>
            </div>
          )}
          <button onClick={() => setShowTelemetry(p => !p)}
            className="absolute top-1.5 left-1.5 z-10 size-5 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border"
            style={{ backgroundColor: showTelemetry ? "#a855f7" : "transparent", borderColor: showTelemetry ? "#a855f7" : "rgba(255,255,255,0.15)", color: showTelemetry ? "#000" : "rgba(255,255,255,0.4)" }}>
            T
          </button>
          <div className="absolute bottom-0 left-0 right-0 flex flex-wrap gap-x-2 px-2 py-1 text-[6px] font-mono text-zinc-600 bg-black/40">
            <span><span style={{ color: '#3b82f6' }}>&#9650;</span> robot</span>
            <span><span style={{ color: '#22c55e' }}>&#8593;</span> gerak</span>
            <span><span style={{ color: 'rgba(239,68,68,0.6)' }}>██</span> halang</span>
            <span><span style={{ color: 'rgba(34,197,94,0.6)' }}>██</span> kosong</span>
            <span><span style={{ color: '#22c55e' }}>&#9679;</span> objek</span>
            <span><span style={{ color: '#ef4444' }}>&#9679;</span> target</span>
          </div>
        </div>

        <div className="aspect-square rounded-2xl bg-zinc-900 ring-1 ring-white/10 touch-none select-none relative"
          ref={joystickRef}
          onPointerDown={(e) => { e.preventDefault(); keysRef.current.clear(); joyActiveRef.current = true; handleJoyMove(e.clientX, e.clientY); }}
          onPointerMove={(e) => { if (joyActiveRef.current) handleJoyMove(e.clientX, e.clientY); }}
          onPointerUp={handleJoyEnd}
          onPointerCancel={handleJoyEnd}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-2 rounded-full bg-zinc-700" />
          </div>
          <div
            className="absolute size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 backdrop-blur-md border border-white/20"
            style={{ left: `calc(50% + ${joyPos.x}px)`, top: `calc(50% + ${joyPos.y}px)` }}
          />
          <div className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1.5">
            <button onClick={() => { setStraightAssist(p => { straightAssistRef.current = !p; return !p; }); }}
              className="size-5 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border"
              style={{ backgroundColor: straightAssist ? "#3b82f6" : "transparent", borderColor: straightAssist ? "#3b82f6" : "rgba(255,255,255,0.15)", color: straightAssist ? "#000" : "rgba(255,255,255,0.4)" }}>
              S
            </button>
          </div>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-10 flex gap-2 text-[7px] font-mono">
            <span className="text-blue-400">L:{leftMotor}</span>
            <span className="text-orange-400">R:{rightMotor}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
