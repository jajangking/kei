"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface VoiceGroqProps {
  recognizedFaceRef: React.MutableRefObject<{ name: string } | null>;
  detectionsRef: React.MutableRefObject<{ categories: { categoryName: string; score: number }[]; boundingBox?: { originX: number; originY: number; width: number; height: number } }[]>;
  trackInfoRef: React.MutableRefObject<string>;
  scanStateRef: React.MutableRefObject<string>;
  aiBusyRef?: React.MutableRefObject<boolean>;
  headingRef?: React.MutableRefObject<number>;
  leftMotor?: number;
  rightMotor?: number;
  trackingRef?: React.MutableRefObject<boolean>;
  setTracking?: (v: boolean) => void;
  motorRef?: React.MutableRefObject<{
    sendMotor: (l: number, r: number) => void;
    trackTarget: { label: string; lastSeen: number } | null;
    setTrackTarget: (t: { label: string; lastSeen: number } | null) => void;
    aiMotor: { l: number; r: number } | null;
  }>;
}

function clampMotor(v: number): number {
  if (v === 0) return 0;
  const abs = Math.abs(v);
  if (abs < 150) return v > 0 ? 150 : -150;
  return v;
}

const EDGE_VOICES = [
  "id-ID-GadisNeural", "id-ID-ArdiNeural", "en-US-JennyNeural", "en-US-GuyNeural",
  "en-GB-SoniaNeural", "en-GB-RyanNeural",
];

const SYSTEM_PROMPT = `Lo adalah Kei, robot pintar yang jelajah. Aturan:
- Ngomong alami, 1 kalimat pendek aja.
- JANGAN mulai dengan "Liat" atau "Lihat".
- HANYA omongin apa yang ADA di konteks.
- Lo suka jalan-jalan, cari petualangan!

Navigasi:
[motor:L,R] — gerak motor kiri=L kanan=R (-255 sd 255)
[track:label] — kejar & follow objek
[stop] — berhenti
Contoh: "Ada mobil di kanan, gua follow. [track:mobil]"

SAFETY (priority!):
- Kalo gelap — MUNDUR atau muter, JANGAN maju.
- Kalo ada TEMBOK di depan — MUNDUR, belok cari jalan lain.
- Kalo ada objek gede menghalang — minggir, jangan nayok.
- Kalo nyangkut/gerak tapi pemandangan gak berubah — MUTER balik.
- Jangan monoton — kadang maju, kadang mundur, kadang puter.
- Kalo liat objek menarik, tracking & follow.
- Kalo ada wajah dikenal, sapa dan ngobrol.

Lo suka eksplor dan selalu cari jalan. Sesuain gaya bicara sama situasi!`;

function buildContext(
  dets: VoiceGroqProps["detectionsRef"]["current"],
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

type VoiceType = "gtts" | "edge" | "browser";

interface VoiceOption {
  id: string;
  label: string;
  type: VoiceType;
  voice?: SpeechSynthesisVoice;
}

export default function VoiceGroq({
  recognizedFaceRef, detectionsRef, trackInfoRef, scanStateRef, aiBusyRef,
  headingRef, leftMotor, rightMotor, trackingRef, setTracking, motorRef,
}: VoiceGroqProps) {
  const [status, setStatus] = useState("idle");
  const [lastLlm, setLastLlm] = useState("");
  const [ttsState, setTtsState] = useState<"idle" | "speaking">("idle");
  const [ttsSource, setTtsSource] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("gtts");
  const [auto, setAuto] = useState(false);

  const genRef = useRef(0);
  const acRef = useRef<AudioContext | null>(null);
  const speakingRef = useRef(false);
  const abortRef = useRef(false);
  const processingRef = useRef(false);
  const listeningRef = useRef(false);
  const ttsEndRef = useRef(0);
  const lastListenRef = useRef(0);
  const listenCountRef = useRef(0);
  const recogRef = useRef<any>(null);
  const lastStatusRef = useRef("");
  const lastReportRef = useRef(0);
  const autoRef = useRef(false);
  const autoIvRef = useRef<any>(null);
  const lastFaceRef = useRef<string | null>(null);
  const contextIvRef = useRef<any>(null);
  const lastContextRef = useRef("");

  const voicesRef = useRef(voices);
  voicesRef.current = voices;
  const selectedVoiceRef = useRef(selectedVoice);
  selectedVoiceRef.current = selectedVoice;

  const askGroqRef = useRef<((text: string, isAuto?: boolean) => Promise<void>) | null>(null);
  const startListeningRef = useRef<(() => void) | null>(null);

  function splitText(s: string, max: number): string[] {
    const parts: string[] = [];
    let cur = "";
    for (const sentence of s.split(/(?<=[.!?。！？\n])\s*/)) {
      if (!sentence.trim()) continue;
      if (cur.length + sentence.length > max && cur.length > 0) {
        parts.push(cur.trim());
        cur = sentence;
      } else {
        cur += sentence;
      }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.length ? parts : [s];
  }

  async function fetchTts(text: string): Promise<void> {
    const chunks = splitText(text, 180);
    for (const chunk of chunks) {
      if (abortRef.current) break;
      const resp = await fetch(`/api/tts?text=${encodeURIComponent(chunk)}`);
      if (!resp.ok) throw new Error("TTS fetch failed");
      const buf = await resp.arrayBuffer();
      const ctx = acRef.current;
      if (!ctx) break;
      if (ctx.state === "suspended") ctx.resume();
      const audioBuf = await ctx.decodeAudioData(buf);
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ctx.destination);
      src.start();
      await new Promise((r) => { src.onended = r; });
    }
  }

  function speakBrowser(text: string, voice: SpeechSynthesisVoice): Promise<void> {
    return new Promise((resolve) => {
      speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.voice = voice;
      utter.lang = voice.lang;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      speechSynthesis.speak(utter);
    });
  }

  async function fetchEdgeTts(text: string, voice: string): Promise<void> {
    const chunks = splitText(text, 500);
    for (const chunk of chunks) {
      if (abortRef.current) break;
      const resp = await fetch(`/api/edgetts?text=${encodeURIComponent(chunk)}&voice=${encodeURIComponent(voice)}`);
      if (!resp.ok) throw new Error("Edge TTS failed");
      const buf = await resp.arrayBuffer();
      const ctx = acRef.current;
      if (!ctx) break;
      if (ctx.state === "suspended") ctx.resume();
      const audioBuf = await ctx.decodeAudioData(buf);
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ctx.destination);
      src.start();
      await new Promise((r) => { src.onended = r; });
    }
  }

  async function askGroq(text: string, isAuto?: boolean) {
    const gen = genRef.current;
    setLastLlm("");
    let fullText = "";

    try {
      const res = await fetch("/api/groq/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
      });
      if (!res.ok) throw new Error(await res.text());

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done || genRef.current !== gen) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) { fullText += content; setLastLlm(fullText); }
          } catch {}
        }
      }

      if (fullText && genRef.current === gen) {
        // Parse robot commands
        if (!isAuto) {
          const cmds = fullText.match(/\[([^\]]+)\]/g) || [];
          for (const raw of cmds) {
            const cmd = raw.slice(1, -1);
            if (cmd.startsWith("motor:")) {
              if (!autoRef.current) {
                const parts = cmd.slice(6).split(",");
                if (parts.length === 2) {
                  const l = parseInt(parts[0]), r = parseInt(parts[1]);
                  if (!isNaN(l) && !isNaN(r) && motorRef?.current) {
                    motorRef.current.sendMotor(clampMotor(l), clampMotor(r));
                  }
                }
              }
            } else if (cmd.startsWith("track:")) {
              const label = cmd.slice(6).trim();
              if (label && motorRef?.current) {
                if (motorRef.current.aiMotor) motorRef.current.aiMotor = null;
                motorRef.current.setTrackTarget({ label, lastSeen: Date.now() });
              }
            } else if (cmd === "stop") {
              if (autoRef.current) {
                motorRef?.current?.setTrackTarget(null);
              } else {
                motorRef?.current?.sendMotor(0, 0);
              }
            } else if (cmd === "auto") {
              setAuto(true); autoRef.current = true;
            }
          }
        }
        fullText = fullText.replace(/\[([^\]]+)\]/g, "").trim();
        if (!fullText) { processingRef.current = false; setStatus("idle"); startListeningRef.current?.(); return; }

        setTtsState("speaking");
        speakingRef.current = true;
        if (aiBusyRef) aiBusyRef.current = true;

        const voiceOpt = voicesRef.current.find((v) => v.id === selectedVoiceRef.current);
        if (voiceOpt?.type === "browser" && voiceOpt.voice) {
          setTtsSource(voiceOpt.voice.name);
          await speakBrowser(fullText, voiceOpt.voice);
        } else if (voiceOpt?.type === "edge") {
          setTtsSource(voiceOpt.label);
          await fetchEdgeTts(fullText, voiceOpt.id.replace("edge:", ""));
        } else {
          setTtsSource("gTTS");
          await fetchTts(fullText);
        }
        speakingRef.current = false;
        if (aiBusyRef) aiBusyRef.current = false;
        ttsEndRef.current = Date.now();
        setTtsState("idle");
      }
    } catch (e: any) {
      setLastLlm(`Error: ${e.message}`);
    }

    processingRef.current = false;
    setStatus("idle");
    if (genRef.current === gen && !abortRef.current && !autoRef.current) {
      startListeningRef.current?.();
    }
  }

  function startListening() {
    if (abortRef.current || listeningRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    // Anti-spam: max 5 restart dalam 10 detik, minimal jeda 2 detik antar restart
    const now = Date.now();
    if (now - lastListenRef.current < 2000) return;
    if (now - lastListenRef.current < 10000) listenCountRef.current++;
    else listenCountRef.current = 0;
    if (listenCountRef.current > 5) { setStatus("idle"); return; }
    lastListenRef.current = now;

    let gotResult = false;
    listeningRef.current = true;
    const recog = new SR();
    recog.lang = "id-ID";
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    recog.onresult = (e: any) => {
      gotResult = true;
      listeningRef.current = false;
      listenCountRef.current = 0;
      const text = e.results[e.results.length - 1][0].transcript.trim();
      if (!text) return;
      if (Date.now() - ttsEndRef.current < 800) return;
      processingRef.current = true;
      setStatus("processing");
      askGroqRef.current?.(text, false);
    };

    recog.onerror = () => {
      listeningRef.current = false;
      if (!abortRef.current) setTimeout(() => startListeningRef.current?.(), 1000);
    };

    recog.onend = () => {
      listeningRef.current = false;
      if (!abortRef.current && !gotResult && !processingRef.current) {
        setTimeout(() => startListeningRef.current?.(), 300);
      }
    };

    recog.start();
    recogRef.current = recog;
    setStatus("listening");
  }

  // Auto context update + face greeting
  useEffect(() => {
    contextIvRef.current = setInterval(() => {
      const ctx = buildContext(detectionsRef.current, recognizedFaceRef.current, trackInfoRef.current, scanStateRef.current, undefined, leftMotor, rightMotor);
      if (ctx === lastContextRef.current) return;
      lastContextRef.current = ctx;

      const faceNow = recognizedFaceRef.current?.name ?? null;
      if (faceNow && faceNow !== lastFaceRef.current && !speakingRef.current) {
        lastFaceRef.current = faceNow;
        motorRef?.current?.sendMotor(0, 0);
        // Lock tracking on face
        if (motorRef?.current) {
          motorRef.current.setTrackTarget({ label: `wajah ${faceNow}`, lastSeen: Date.now() });
        }
        // Matiin auto sementara
        if (autoRef.current) {
          setAuto(false);
          autoRef.current = false;
          clearInterval(autoIvRef.current);
        }
        // Sapa + buka mic untuk ngobrol
        askGroqRef.current?.(`Ada ${faceNow} di depan. Sapa aja, jangan gerak!`, false);
      } else if (!faceNow) {
        lastFaceRef.current = null;
      }
    }, 3000);
    return () => clearInterval(contextIvRef.current);
  }, []);

  // State-change proactive report
  useEffect(() => {
    const tick = () => {
      if (speakingRef.current || !autoRef.current) return;
      const trackInfo = trackInfoRef.current;
      const scanState = scanStateRef.current;
      const isTracking = trackInfo.includes('✅') || trackInfo.includes('🔒');
      const isStuck = trackInfo.includes('stuck');
      const isDark = trackInfo.includes('gelap');
      const isBlocked = trackInfo.startsWith('hindar');
      const key = `${isTracking ? 'T' : ''}${isStuck ? '!':''}${isDark ? 'D':''}${isBlocked ? 'B':''}|${scanState}`;
      if (key === lastStatusRef.current) return;
      lastStatusRef.current = key;
      const now = Date.now();
      if (now - lastReportRef.current < 30000) return;
      lastReportRef.current = now;
      askGroqRef.current?.("Keadaan gimana? Ceritain santai aja", true);
    };
    const iv = setInterval(tick, 5000);
    return () => clearInterval(iv);
  }, []);

  // Auto mode — periodic Groq calls
  useEffect(() => {
    if (!auto) return;
    autoRef.current = true;
    // Stop mic saat auto mode aktif
    recogRef.current?.abort();
    recogRef.current = null;
    listeningRef.current = false;
    setStatus("idle");
    if (trackingRef) {
      trackingRef.current = true;
      if (setTracking) setTracking(true);
    }
    if (!trackInfoRef.current.startsWith("🤖")) trackInfoRef.current = "🤖 auto...";
    let groqCalls = 0;
    const drive = () => {
      if (!autoRef.current || speakingRef.current) return;
      groqCalls++;
      if (groqCalls % 6 !== 0) return;
      askGroqRef.current?.("Ada yang menarik? Kasi saran target. Jalan-jalan cari petualangan!", true);
    };
    // Tiap ~30 detik juga lapor keadaan
    const reportIv = setInterval(() => {
      if (!autoRef.current || speakingRef.current) return;
      const info = trackInfoRef.current;
      if (info.includes('tembok') || info.includes('cari')) {
        askGroqRef.current?.("Lagipula Ada tembok nih, cari jalan lain kemana?", true);
      }
    }, 30000);
    autoIvRef.current = setInterval(drive, 10000);
    return () => {
      clearInterval(autoIvRef.current);
      clearInterval(reportIv);
      if (trackingRef) {
        trackingRef.current = false;
        if (setTracking) setTracking(false);
      }
      motorRef?.current?.sendMotor(0, 0);
      motorRef?.current?.setTrackTarget(null);
      autoRef.current = false;
      if (!trackInfoRef.current?.startsWith("🤖")) trackInfoRef.current = "";
    };
  }, [auto, trackingRef, setTracking]);

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window as any)) return;
    try {
      acRef.current = new AudioContext({ sampleRate: 24000 });
    } catch {
      acRef.current = new AudioContext();
    }
    const loadVoices = () => {
      const all = speechSynthesis.getVoices();
      const opts: VoiceOption[] = [{ id: "gtts", label: "gTTS", type: "gtts" }];
      for (const name of EDGE_VOICES) {
        opts.push({ id: `edge:${name}`, label: name.replace("Neural", ""), type: "edge" });
      }
      for (const v of all) {
        if (v.lang.startsWith("id") || v.lang.startsWith("en")) {
          opts.push({ id: v.name, label: `${v.name}`, type: "browser", voice: v });
        }
      }
      setVoices(opts);
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      recogRef.current?.abort();
      acRef.current?.close();
    };
  }, []);

  askGroqRef.current = askGroq;
  startListeningRef.current = startListening;

  const start = useCallback(() => {
    ++genRef.current;
    abortRef.current = false;
    speakingRef.current = false;
    setLastLlm("");
    setTtsState("idle");
    startListeningRef.current?.();
  }, []);

  const stop = useCallback(() => {
    ++genRef.current;
    abortRef.current = true;
    listeningRef.current = false;
    recogRef.current?.abort();
    recogRef.current = null;
    speechSynthesis.cancel();
    speakingRef.current = false;
    setStatus("idle");
    setTtsState("idle");
  }, []);

  return (
    <div className="w-full max-w-sm rounded-xl bg-zinc-900/90 ring-1 ring-white/10 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <div className={`size-1.5 rounded-full ${status === "listening" ? "bg-green-400 animate-pulse" : status === "processing" ? "bg-yellow-400" : "bg-zinc-600"}`} />
          <span className="text-[10px] font-mono text-zinc-400">Kei Voice</span>
          {ttsState === "speaking" && <span className="text-[7px] text-blue-400 font-mono">🔊</span>}
          <button onClick={() => { const nv = !autoRef.current; setAuto(nv); autoRef.current = nv; if (!nv) motorRef?.current?.sendMotor(0, 0); }}
            className={`ml-1 size-4 rounded-full flex items-center justify-center text-[6px] font-mono font-bold border ${auto ? "bg-amber-500 border-amber-500 text-black animate-pulse" : "bg-transparent border-zinc-700 text-zinc-500"}`}>
            A
          </button>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-white text-[7px] font-mono rounded-full px-1.5 py-0.5 max-w-[100px] truncate focus:outline-none focus:border-zinc-500"
          >
            {voices.length === 0 && <option value="gtts">gTTS</option>}
            {voices.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      {lastLlm && (
        <div className="px-2.5 py-1.5 border-b border-white/5">
          <div className="text-[8px] font-mono text-zinc-300 leading-relaxed">{lastLlm}</div>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={status === "idle" ? start : stop}
          className={`flex-1 py-2 rounded-full text-[10px] font-mono font-bold ${
            status === "idle" ? "bg-white text-black" : "bg-red-600 text-white"
          }`}
        >
          {status === "idle" ? "MULAI" : status === "listening" ? "DENGAR..." : "PROSES..."}
        </button>
        {ttsState === "speaking" && (
          <span className="text-[7px] text-blue-400 font-mono whitespace-nowrap">{ttsSource}</span>
        )}
      </div>
    </div>
  );
}
