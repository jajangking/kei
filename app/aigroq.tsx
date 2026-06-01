"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface AIGroqProps {
  recognizedFaceRef: React.MutableRefObject<{ name: string } | null>;
  detectionsRef: React.MutableRefObject<{ categories: { categoryName: string; score: number }[]; boundingBox?: { originX: number; originY: number; width: number; height: number } }[]>;
  trackInfoRef: React.MutableRefObject<string>;
  scanStateRef: React.MutableRefObject<string>;
  aiBusyRef?: React.MutableRefObject<boolean>;
  headingRef?: React.MutableRefObject<number>;
  leftMotor?: number;
  rightMotor?: number;
  motorRef?: React.MutableRefObject<{
    sendMotor: (l: number, r: number) => void;
    trackTarget: { label: string; lastSeen: number } | null;
    setTrackTarget: (t: { label: string; lastSeen: number } | null) => void;
  }>;
}

interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

function clampMotor(v: number): number {
  if (v === 0) return 0;
  const abs = Math.abs(v);
  if (abs < 150) return v > 0 ? 150 : -150;
  return v;
}

let speechRecogCtor: any = null;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const STORAGE_KEY = "kei_groq_key";

const SYSTEM_PROMPT = `Lo adalah Kei, suara robot. Aturan:
- Ngomong alami, JANGAN mulai dengan "Liat" atau "Lihat".
- Kalo cuma greeting, jawab salam aja.
- HANYA omongin apa yang ADA di konteks — jangan ngarang.
- Jawab 1 kalimat pendek aja.

Lo BISA gerakin robot pake perintah di dalem kurung siku:
[motor:L,R] — gerak motor kiri=L kanan=R (-255 sd 255)
[track:label] — tracking objek
[stop] — berhenti
Contoh: "Ada mobil di kanan, gua follow. [track:mobil]"

Kalo lagi mode autonomous, lo yang mutusin. Tapi aturan SAFETY:
- Kalo gelap — JANGAN maju. MUNDUR atau muter.
- Kalo ada objek gede di depan — minggir, jangan nayok.
- Jangan monoton — kadang maju, kadang mundur, kadang puter.
- Kalo liat objek menarik, tracking aja.
Sesuain gaya bicara sama situasi.`;

function buildContext(
  dets: AIGroqProps["detectionsRef"]["current"],
  face: { name: string } | null,
  trackInfo: string,
  scanState: string,
  heading?: number,
  leftMotor?: number,
  rightMotor?: number,
): string {
  let ctx = "";
  if (dets.length > 0) {
    const labels = [...new Set(dets.map(d => d.categories[0].categoryName))];
    ctx += `di depan ada ${labels.join(", ")}. `;
  } else {
    ctx += "gak liat apa-apa. ";
  }
  if (face) ctx += `ada ${face.name}. `;
  if (trackInfo) ctx += `lagi ${trackInfo}. `;
  if (scanState !== "idle") ctx += `(state ${scanState}). `;
  if (heading !== undefined) ctx += `arah ${((heading * 180 / Math.PI) % 360).toFixed(0)}°. `;
  if (leftMotor !== undefined && rightMotor !== undefined) {
    if (leftMotor !== 0 || rightMotor !== 0) {
      ctx += `motor kiri=${leftMotor} kanan=${rightMotor}. `;
    } else {
      ctx += "motor mati. ";
    }
  }
  return ctx;
}

export default function AIGroq({ recognizedFaceRef, detectionsRef, trackInfoRef, scanStateRef, aiBusyRef, headingRef, leftMotor, rightMotor, motorRef }: AIGroqProps) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [wakeWord, setWakeWord] = useState(false);
  const [convMode, setConvMode] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [hasSpeech, setHasSpeech] = useState(false);
  const [mood, setMood] = useState("chill");
  const [auto, setAuto] = useState(false);

  const msgsRef = useRef<ChatMsg[]>([]);
  const apiKeyRef = useRef("");
  const wakeRef = useRef(false);
  const convRef = useRef(false);
  const convTimerRef = useRef<any>(null);
  const speakingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const wakeRecRef = useRef<any>(null);
  const restartWakeRef = useRef<(() => void) | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const lastContextRef = useRef("");
  const contextIvRef = useRef<any>(null);
  const autoReplyIvRef = useRef<any>(null);
  const lastReportRef = useRef(0);
  const lastStatusRef = useRef("");
  const cooldownRef = useRef(0);
  const moodRef = useRef("chill");
  const autoRef = useRef(false);
  const autoIvRef = useRef<any>(null);
  const autoLastCmdRef = useRef(0);
  const autoSafeIvRef = useRef<any>(null);
  const lastFaceRef = useRef<string | null>(null);
  const tokenBudgetRef = useRef(80000); // sisa token hari ini (max 100K)
  const tokenResetRef = useRef(Date.now());

  // Load API key
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setApiKey(saved);
      apiKeyRef.current = saved;
      setHasKey(true);
    }
    // Initialize speech recognition on client only
    if (!speechRecogCtor) {
      speechRecogCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    }
    setHasSpeech(!!speechRecogCtor);
  }, []);

  const saveKey = useCallback((key: string) => {
    setApiKey(key);
    apiKeyRef.current = key;
    localStorage.setItem(STORAGE_KEY, key);
    setHasKey(true);
  }, []);

  // Scroll chat
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs]);

  const moodMap: Record<string, { icon: string; pitch: number; rate: number }> = {
    excited: { icon: "🔥", pitch: 1.3, rate: 1.2 },
    confused: { icon: "❓", pitch: 1.0, rate: 0.8 },
    curious: { icon: "👀", pitch: 1.1, rate: 0.9 },
    alert: { icon: "⚠️", pitch: 0.9, rate: 1.1 },
    chill: { icon: "💤", pitch: 0.85, rate: 0.85 },
  };

  function updateMood() {
    const info = trackInfoRef.current;
    const scan = scanStateRef.current;
    let m = "chill";
    if (info.includes("✅") || info.includes("🔒")) m = "excited";
    else if (info.startsWith("cari") || scan === "scanning") m = "curious";
    else if (info.startsWith("hindar") || info.includes("stuck")) m = "alert";
    else if (info.includes("gelap")) m = "alert";
    else if (trackLostRef()) m = "confused";
    if (m !== moodRef.current) {
      moodRef.current = m;
      setMood(m);
    }
  }

  function trackLostRef() {
    // true if trackInfo contains "cari" without 🔒
    return trackInfoRef.current.startsWith("cari") || trackInfoRef.current.includes("ilang");
  }

  const speak = useCallback((text: string, m?: string) => {
    const moodKey = m || moodRef.current || "chill";
    const cfg = moodMap[moodKey] || moodMap.chill;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "id-ID";
    utter.rate = cfg.rate;
    utter.pitch = cfg.pitch;
    utter.onstart = () => {
      speakingRef.current = true;
      setSpeaking(true);
      if (aiBusyRef) aiBusyRef.current = true;
      wakeRecRef.current?.stop();
    };
    utter.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
      if (aiBusyRef) aiBusyRef.current = false;
      // restart mic from the stored restart function
      setTimeout(() => restartWakeRef.current?.(), 200);
    };
    utter.onerror = () => {
      speakingRef.current = false;
      setSpeaking(false);
      if (aiBusyRef) aiBusyRef.current = false;
      setTimeout(() => restartWakeRef.current?.(), 200);
    };
    window.speechSynthesis.speak(utter);
  }, [aiBusyRef]);

  const sendToGroq = useCallback(async (userText: string, isAuto?: boolean, chatOnly?: boolean) => {
    const key = apiKeyRef.current;
    if (!key) return;

    // Token budget check: kalo sisa < 2000, skip auto calls
    if (isAuto && tokenBudgetRef.current < 2000) return;

    // Reset budget setiap 24 jam
    if (Date.now() - tokenResetRef.current > 86400000) {
      tokenBudgetRef.current = 80000;
      tokenResetRef.current = Date.now();
    }

    const ctx = buildContext(detectionsRef.current, recognizedFaceRef.current, trackInfoRef.current, scanStateRef.current);
    const systemMsg: ChatMsg = { role: "system", content: `${SYSTEM_PROMPT}\n\nKonteks saat ini: ${ctx}` };

    const history = msgsRef.current.filter(m => m.role !== "system");
    const recent = history.slice(-10);
    const body = {
      model: MODEL,
      messages: [systemMsg, ...recent, { role: "user", content: userText }],
      temperature: 0.5,
      max_tokens: 30,
    };

    if (!isAuto) { setThinking(true); if (aiBusyRef) aiBusyRef.current = true; }
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText} — ${errText}`);
      }
      const data = await res.json();
      // Token tracking
      if (data.usage) {
        tokenBudgetRef.current -= data.usage.total_tokens || 0;
      } else {
        tokenBudgetRef.current -= Math.round(JSON.stringify(body).length / 3) + 30;
      }
      if (tokenBudgetRef.current < 0) tokenBudgetRef.current = 0;
      let reply = (data.choices?.[0]?.message?.content || "").trim();
      // Strip thinking tags (closed or unclosed)
      reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();
      if (reply) {
        // Parse commands from reply: [motor:l,r] [track:label] [stop] [scan]
        if (!chatOnly) {
          const cmds = reply.match(/\[([^\]]+)\]/g) || [];
          for (const raw of cmds) {
            const cmd = raw.slice(1, -1);
            if (cmd.startsWith("motor:")) {
              const parts = cmd.slice(6).split(",");
              if (parts.length === 2) {
                const l = parseInt(parts[0]), r = parseInt(parts[1]);
                if (!isNaN(l) && !isNaN(r) && motorRef?.current) {
                  motorRef.current.sendMotor(clampMotor(l), clampMotor(r));
                  autoLastCmdRef.current = Date.now();
                }
              }
            } else if (cmd.startsWith("track:")) {
              const label = cmd.slice(6).trim();
              if (label && motorRef?.current) {
                motorRef.current.setTrackTarget({ label, lastSeen: Date.now() });
                autoLastCmdRef.current = Date.now();
              }
            } else if (cmd === "stop") {
              motorRef?.current?.sendMotor(0, 0);
              autoLastCmdRef.current = Date.now();
            } else if (cmd === "auto") {
              setAuto(true); autoRef.current = true;
            }
          }
        }
        // Strip commands from displayed reply
        reply = reply.replace(/\[([^\]]+)\]/g, '').trim();
        if (reply) {
          const updated: ChatMsg[] = [...msgsRef.current, { role: "assistant", content: reply }];
          msgsRef.current = updated;
          setMsgs(updated);
          updateMood();
          speak(reply, moodRef.current);
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || "unknown error";
      console.error("[keigroq]", errMsg);
      const updated: ChatMsg[] = [...msgsRef.current, { role: "assistant", content: `Wah error: ${errMsg}` }];
      msgsRef.current = updated;
      setMsgs(updated);
    }
    if (!isAuto) { setThinking(false); if (aiBusyRef) aiBusyRef.current = false; }
  }, [speak]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || thinking || !apiKeyRef.current) return;
    const updated: ChatMsg[] = [...msgsRef.current, { role: "user", content: text.trim() }];
    msgsRef.current = updated;
    setMsgs(updated);
    setInput("");
    sendToGroq(text.trim(), false, true);
  }, [thinking, sendToGroq]);

  // Auto context update + proactive chat
  useEffect(() => {
    contextIvRef.current = setInterval(() => {
    const ctx = buildContext(detectionsRef.current, recognizedFaceRef.current, trackInfoRef.current, scanStateRef.current, undefined, leftMotor, rightMotor);
      if (ctx === lastContextRef.current) return;
      lastContextRef.current = ctx;

      // Face greeting: wajah baru muncul → AI nyapa, stop motor
      const faceNow = recognizedFaceRef.current?.name ?? null;
      if (faceNow && faceNow !== lastFaceRef.current && !speakingRef.current) {
        lastFaceRef.current = faceNow;
        motorRef?.current?.sendMotor(0, 0);
        sendToGroq(`Ada ${faceNow} di depan. Sapa aja, jangan gerak!`, true, true);
      } else if (!faceNow) {
        lastFaceRef.current = null;
      }

      // Update system prompt with latest context
      const systemMsg: ChatMsg = { role: "system", content: `${SYSTEM_PROMPT}\n\nKonteks saat ini: ${ctx}` };
      const updated = msgsRef.current.length > 0 ? [...msgsRef.current] : [];
      const sysIdx = updated.findIndex(m => m.role === "system" && m.content.startsWith("Kamu adalah Kei"));
      if (sysIdx >= 0) {
        updated[sysIdx] = systemMsg;
      } else {
        updated.unshift(systemMsg);
      }
      msgsRef.current = updated;
      // Only set state if we already have user messages (don't show system-only updates)
      if (updated.some(m => m.role === "user")) setMsgs(updated);
    }, 3000);

    return () => clearInterval(contextIvRef.current);
  }, []);

  // Auto-report on state change (hemat token — max 2x/menit)
  useEffect(() => {
    const tick = () => {
      if (!apiKeyRef.current || speakingRef.current || convRef.current) return;
      updateMood();
      const trackInfo = trackInfoRef.current;
      const scanState = scanStateRef.current;
      // Cuma lapor kalo ada perubahan penting
      const info = trackInfo;
      const isTracking = info.includes('✅') || info.includes('🔒');
      const isStuck = info.includes('stuck');
      const isDark = info.includes('gelap');
      const isBlocked = info.startsWith('hindar');
      const key = `${isTracking ? 'T' : ''}${isStuck ? '!':''}${isDark ? 'D':''}${isBlocked ? 'B':''}|${scanState}`;
      if (key === lastStatusRef.current) return;
      lastStatusRef.current = key;
      // Cooldown 30 detik
      const now = Date.now();
      if (now - lastReportRef.current < 30000) return;
      lastReportRef.current = now;
      sendToGroq("Keadaan gimana? Ceritain santai aja", true, true);
    };
    autoReplyIvRef.current = setInterval(tick, 5000);
    return () => clearInterval(autoReplyIvRef.current);
  }, [sendToGroq]);

  // Auto hybrid mode — mostly built-in tracking/scan, Groq tiap 60s buat personality
  useEffect(() => {
    if (!auto) return;
    autoRef.current = true;
    trackInfoRef.current = "🤖 auto...";
    let groqCalls = 0;

    const drive = () => {
      if (!autoRef.current || !apiKeyRef.current || speakingRef.current) return;
      const dets = detectionsRef.current;
      const info = trackInfoRef.current;
      const scan = scanStateRef.current;

      // Safety 1: dark → mundur (bypass AI)
      if (info.includes("gelap")) {
        motorRef?.current?.sendMotor(clampMotor(-60), clampMotor(-60));
        return;
      }
      // Safety 2: obstacle besar di tengah → hindar (bypass AI)
      const big = dets.find(d => {
        const b = d.boundingBox!;
        const vw = 640, vh = 480;
        const cx = (b.originX + b.width / 2) / vw;
        const area = (b.width / vw) * (b.height / vh);
        return area > 0.3 && cx > 0.2 && cx < 0.8;
      });
      if (big && !info.includes("🔒") && !info.includes("✅")) {
        const b = big.boundingBox!;
        const vw = 640;
        const cx = (b.originX + b.width / 2) / vw;
        const dir = cx < 0.5 ? 80 : -80;
        motorRef?.current?.sendMotor(clampMotor(dir), clampMotor(-dir));
        if (!info.includes("🤖")) trackInfoRef.current = "🤖 hindar...";
        return;
      }
      // Kalo lagi tracking/scan, biarin tracking built-in jalan
      if (info.includes("🔒") || info.includes("✅")) return;
      if (info.startsWith("cari") || scan === "scanning") return;

      // Groq cuma tiap ~60s buat saran strategis
      groqCalls++;
      if (groqCalls % 6 !== 0) return; // 10s * 6 = 60s
      const ctx = buildContext(dets, recognizedFaceRef.current, info, scan, headingRef?.current, leftMotor, rightMotor);
      sendToGroq("Ada yang menarik? Kasi saran target.", true, false);
    };
    autoIvRef.current = setInterval(drive, 10000);

    // Smart obstacle avoidance — scan 360° cari jalan bersih
    const SCAN_SECTORS = 6;
    let scanState = 'idle';
    let scanSector = 0;
    let scanMap: { cnt: number }[] = [];
    let scanTimer = 0;
    let chosenDir = 0;
    let scanCooldown = 0;

    const safety = () => {
      if (!autoRef.current || !apiKeyRef.current) return;

      if (scanCooldown > 0) { scanCooldown--; return; }

      if (scanState === 'idle') {
        const dets = detectionsRef.current;
        const close = dets.find(d => {
          const b = d.boundingBox!;
          const vw = 640, vh = 480;
          const cx = (b.originX + b.width / 2) / vw;
          const area = (b.width / vw) * (b.height / vh);
          return area > 0.1 && cx > 0.1 && cx < 0.9;
        });
        if (close) {
          motorRef?.current?.sendMotor(0, 0);
          scanState = 'scan_stop';
          scanSector = 0;
          scanMap = Array.from({length: SCAN_SECTORS}, () => ({cnt: 0}));
          scanTimer = 0;
          trackInfoRef.current = "🤖 cari jalan...";
        }
        return;
      }

      if (scanState === 'scan_stop') {
        scanTimer++;
        // Stop 2 tick (1s) — biar deteksi stabil
        if (scanTimer >= 2) {
          const dets = detectionsRef.current;
          const vw = 640, vh = 480;
          let obstacleCount = 0;
          for (const d of dets) {
            const b = d.boundingBox!;
            const area = (b.width / vw) * (b.height / vh);
            if (area > 0.05) obstacleCount++;
          }
          if (scanSector < SCAN_SECTORS && scanMap[scanSector]) {
            scanMap[scanSector].cnt = obstacleCount;
          }
          scanSector++;
          scanTimer = 0;
          if (scanSector >= SCAN_SECTORS) {
            scanState = 'scan_pick';
          } else {
            scanState = 'scan_turn';
          }
        }
        return;
      }

      if (scanState === 'scan_turn') {
        scanTimer++;
        motorRef?.current?.sendMotor(-170, 170);
        // Turn 2 tick (1s)
        if (scanTimer >= 2) {
          motorRef?.current?.sendMotor(0, 0);
          scanTimer = 0;
          scanState = 'scan_stop';
        }
        return;
      }

      if (scanState === 'scan_pick') {
        // Pilih sektor paling bersih (paling dikit obstacle)
        let best = 0, bestCnt = Infinity;
        for (let i = 0; i < SCAN_SECTORS; i++) {
          if (scanMap[i].cnt < bestCnt) {
            bestCnt = scanMap[i].cnt;
            best = i;
          }
        }
        // Kalo semua penuh, pilih sektor yang udah dilewatin
        if (bestCnt > 5) best = SCAN_SECTORS / 2;
        chosenDir = best;
        scanState = 'scan_rotato';
        scanTimer = 0;
        trackInfoRef.current = `🤖 arah ${best}`;
        return;
      }

      if (scanState === 'scan_rotato') {
        scanTimer++;
        // Rotasi berlawanan arah buat balik ke sektor yang dipilih
        const lastSector = SCAN_SECTORS - 1;
        const dstCCW = (chosenDir - lastSector + SCAN_SECTORS) % SCAN_SECTORS;
        const dstCW = (lastSector - chosenDir + SCAN_SECTORS) % SCAN_SECTORS;
        const reverse = dstCCW < dstCW;
        const needTurns = Math.min(dstCCW, dstCW);
        if (scanTimer <= needTurns * 2) {
          if (reverse) {
            motorRef?.current?.sendMotor(170, -170);
          } else {
            motorRef?.current?.sendMotor(-170, 170);
          }
        } else {
          motorRef?.current?.sendMotor(0, 0);
          scanState = 'scan_go';
          scanTimer = 0;
        }
        return;
      }

      if (scanState === 'scan_go') {
        scanTimer++;
        motorRef?.current?.sendMotor(180, 180);
        // Maju 1.5 detik
        if (scanTimer >= 3) {
          motorRef?.current?.sendMotor(0, 0);
          scanState = 'idle';
          scanCooldown = 4; // cooldown 2 detik sebelum scan ulang
          if (!trackInfoRef.current?.startsWith("🤖")) trackInfoRef.current = "";
          else trackInfoRef.current = "🤖 auto...";
        }
        return;
      }
    };
    autoSafeIvRef.current = setInterval(safety, 500);

    return () => {
      clearInterval(autoIvRef.current);
      clearInterval(autoSafeIvRef.current);
      motorRef?.current?.sendMotor(0, 0);
      autoRef.current = false;
      if (!trackInfoRef.current?.startsWith("🤖")) trackInfoRef.current = "";
    };
  }, [auto]);

  useEffect(() => () => { wakeRef.current = false; convRef.current = false; if (convTimerRef.current) clearTimeout(convTimerRef.current); wakeRecRef.current?.stop(); }, []);

  const toggleListening = useCallback(() => {
    if (!speechRecogCtor) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new speechRecogCtor();
    rec.lang = "id-ID";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setListening(false);
      sendMessage(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening, sendMessage]);

  // Wake word: loop of single-shot recognitions (more reliable on mobile than continuous)
  const startWakeWord = useCallback(() => {
    if (!speechRecogCtor || wakeRef.current) return;

    const createWakeRec = () => {
      if (!wakeRef.current) return;
      restartWakeRef.current = createWakeRec;
      const rec = new speechRecogCtor();
      rec.lang = "id-ID";
      rec.continuous = false;
      rec.interimResults = false;
      let lastResult = "";
      rec.onresult = (e: any) => {
        const t = e.results[0][0].transcript.trim();
        if (!t || t === lastResult) return;
        lastResult = t;

        if (convRef.current) {
          if (speakingRef.current) return;
          if (/^(bye|dadah|stop|selesai|udah|gausah)$/i.test(t)) {
            convRef.current = false;
            setConvMode(false);
            setListening(false);
            return;
          }
          if (convTimerRef.current) clearTimeout(convTimerRef.current);
          convTimerRef.current = setTimeout(() => { convRef.current = false; setConvMode(false); setListening(false); }, 30000);
          if (t.length > 0) sendMessage(t);
          return;
        }

        if (speakingRef.current) return;

        const lower = t.toLowerCase();
        if (!lower.includes('kei') && !lower.includes('kay') && !/^k[eyi]/i.test(t)) return;

        convRef.current = true;
        setConvMode(true);
        setListening(true);
        try {
          const ac = new AudioContext();
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.connect(gain); gain.connect(ac.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.15, ac.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
          osc.start(); osc.stop(ac.currentTime + 0.15);
        } catch {}

        const idx = lower.indexOf('kei');
        if (idx >= 0) {
          const after = t.slice(idx + 3).trim();
          if (after.length > 0) sendMessage(after);
        }

        if (convTimerRef.current) clearTimeout(convTimerRef.current);
        convTimerRef.current = setTimeout(() => { convRef.current = false; setConvMode(false); setListening(false); }, 30000);
      };
      rec.onerror = () => {};
      rec.onend = () => {
        // don't restart while TTS is playing; speak().onend will restart
        if (wakeRef.current && !speakingRef.current) setTimeout(createWakeRec, 300);
      };
      wakeRecRef.current = rec;
      rec.start();
    };

    wakeRef.current = true;
    setWakeWord(true);
    createWakeRec();
  }, [sendMessage]);

  const stopWakeWord = useCallback(() => {
    wakeRef.current = false;
    convRef.current = false;
    restartWakeRef.current = null;
    setWakeWord(false);
    setConvMode(false);
    setListening(false);
    if (convTimerRef.current) clearTimeout(convTimerRef.current);
    wakeRecRef.current?.stop();
    wakeRecRef.current = null;
  }, []);

  return (
    <div className="w-full max-w-sm rounded-xl bg-zinc-900/90 ring-1 ring-white/10 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <div className={`size-1.5 rounded-full ${speaking ? "bg-green-400 animate-pulse" : "bg-zinc-600"}`} />
          <span className="text-[10px] font-mono text-zinc-400">Kei</span>
          <span className="text-[9px]">{moodMap[mood]?.icon || ""}</span>
          {thinking && <span className="text-[8px] text-zinc-500 animate-pulse">ngomong...</span>}
          {hasSpeech && (
            <button onClick={() => { wakeWord ? stopWakeWord() : startWakeWord(); }}
              className={`ml-1 size-4 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border ${
                convMode ? "bg-green-500 border-green-500 text-black" : wakeWord ? "bg-fuchsia-600 border-fuchsia-600 text-black" : "bg-transparent border-zinc-700 text-zinc-500"
              }`}>
              V
            </button>
          )}
          <button onClick={() => { const nv = !autoRef.current; setAuto(nv); autoRef.current = nv; if (!nv) motorRef?.current?.sendMotor(0, 0); }}
            className={`ml-1 size-4 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border ${auto ? "bg-amber-500 border-amber-500 text-black animate-pulse" : "bg-transparent border-zinc-700 text-zinc-500"}`}>
            A
          </button>
        </div>
        <button onClick={() => setShowSettings(p => !p)}
          className="text-[9px] text-zinc-500 hover:text-zinc-300 font-mono">
          {showSettings ? "×" : "⚙"}
        </button>
      </div>

      {/* API Key input */}
      {showSettings && (
        <div className="px-3 py-2 border-b border-white/5 flex gap-1.5 items-center">
          <input value={apiKey} onChange={e => saveKey(e.target.value)}
            placeholder="Groq API key"
            type="password"
            className="flex-1 min-w-0 px-2 py-1 rounded bg-zinc-800 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
          {hasKey && <div className="size-1.5 rounded-full bg-green-400 shrink-0" />}
        </div>
      )}

      {/* Chat bubbles */}
      <div ref={chatRef} className="flex-1 overflow-y-auto px-2.5 py-2 space-y-1.5" style={{ maxHeight: 180 }}>
        {msgs.filter(m => m.role !== "system").length === 0 && (
          <div className="text-[9px] text-zinc-600 text-center py-6 font-mono">
            {hasKey ? "Ajak ngobrol, seru!" : "Isi API key Groq dulu"}
          </div>
        )}
        {msgs.map((m, i) => (
          m.role !== "system" ? (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] px-2 py-1 rounded-xl text-[10px] leading-relaxed ${
                m.role === "user"
                  ? "bg-fuchsia-600/30 text-fuchsia-200 rounded-tr-sm"
                  : "bg-zinc-800/80 text-zinc-200 rounded-tl-sm"
              }`}>
                {m.content}
              </div>
            </div>
          ) : null
        ))}
      </div>

      {/* Input bar */}
      <div className="flex gap-1.5 px-2.5 py-2 border-t border-white/5">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") sendMessage(input); }}
          placeholder="Ketik pesan..."
          className="flex-1 min-w-0 px-2 py-1.5 rounded-full bg-zinc-800 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
        {hasSpeech && (
          <button onClick={toggleListening}
            className={`size-7 rounded-full flex items-center justify-center text-[9px] font-mono font-bold border shrink-0 ${
              listening || convMode ? "bg-red-500 border-red-500 text-white" : "bg-transparent border-zinc-700 text-zinc-400"
            }`}>
            {(listening || convMode) ? "■" : "🎤"}
          </button>
        )}
        <button onClick={() => sendMessage(input)}
          className={`px-2.5 py-1.5 rounded-full text-[9px] font-mono font-bold shrink-0 ${
            thinking || !hasKey
              ? "bg-zinc-800 text-zinc-600"
              : "bg-fuchsia-600 text-white"
          }`}
          disabled={thinking || !hasKey}>
          ↑
        </button>
      </div>
    </div>
  );
}
