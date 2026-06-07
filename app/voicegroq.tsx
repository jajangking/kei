"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface VoiceGroqProps {
  recognizedFaceRef: React.MutableRefObject<{ name: string } | null>;
  detectionsRef: React.MutableRefObject<{ categories: { categoryName: string; score: number }[]; boundingBox?: { originX: number; originY: number; width: number; height: number } }[]>;
  trackInfoRef: React.MutableRefObject<string>;
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

interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

function clampMotor(v: number): number {
  if (v === 0) return 0;
  const abs = Math.abs(v);
  if (abs < 60) return v > 0 ? 60 : -60;
  return Math.min(255, Math.max(-255, v));
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
- Kalo ada TEMBOK di depan — MUNDUR, belok cari jalan lain (cek tepi kiri/kanan).
- Kalo ada objek gede menghalang — minggir, jangan nayok.
- Kalo nyangkut/gerak tapi pemandangan gak berubah — MUTER balik.
- Kalo muter terus (loop detected) — cari arah baru.
- Jangan monoton — kadang maju, kadang mundur, kadang puter.
- Kalo liat objek menarik, tracking & follow.
- Kalo ada wajah dikenal, sapa dan ngobrol.

Lo suka eksplor dan selalu cari jalan. Sesuain gaya bicara sama situasi!
Kalo auto mode nyala, lo jalan sendiri.`;

function buildContext(
  dets: VoiceGroqProps["detectionsRef"]["current"],
  face: { name: string } | null,
  trackInfo: string,
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
  recognizedFaceRef, detectionsRef, trackInfoRef, aiBusyRef,
  headingRef, leftMotor, rightMotor, trackingRef, setTracking, motorRef,
}: VoiceGroqProps) {
  const [status, setStatus] = useState("idle");
  const [lastLlm, setLastLlm] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [ttsState, setTtsState] = useState<"idle" | "speaking">("idle");
  const [ttsSource, setTtsSource] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("gtts");
  const [auto, setAuto] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const genRef = useRef(0);
  const listenGenRef = useRef(0);
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
  const chatHistoryRef = useRef<ChatMsg[]>([]);

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
    processingRef.current = true;

    const gen = ++genRef.current;
    abortRef.current = false;
    speechSynthesis.cancel();
    speakingRef.current = false;
    setTtsState("idle");
    setLastLlm("");
    let fullText = "";

    const ctx = buildContext(detectionsRef.current, recognizedFaceRef.current, trackInfoRef.current, headingRef?.current, leftMotor, rightMotor);
    const systemMsg: ChatMsg = { role: "system", content: `${SYSTEM_PROMPT}\n\nKonteks saat ini: ${ctx}` };
    const history = chatHistoryRef.current.filter(m => m.role !== "system");
    const recent = history.slice(-10);

    try {
      const key = apiKey || undefined;
      const body = {
        messages: [...recent, { role: "user", content: text }],
        apiKey: key,
        systemPrompt: `${SYSTEM_PROMPT}\n\nKonteks saat ini: ${ctx}`,
      };

      const res = await fetch("/api/groq/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        const userMsg: ChatMsg = { role: "user", content: text };
        const reply = fullText.replace(/\[([^\]]+)\]/g, '').trim();

        chatHistoryRef.current = [...chatHistoryRef.current, userMsg, { role: "assistant", content: reply }];
        setChatHistory(chatHistoryRef.current);

        if (!isAuto) {
          const cmds = fullText.match(/\[([^\]]+)\]/g) || [];
          for (const raw of cmds) {
            const cmd = raw.slice(1, -1);
            if (cmd.startsWith("motor:")) {
              const parts = cmd.slice(6).split(",");
              if (parts.length === 2) {
                const l = parseInt(parts[0]), r = parseInt(parts[1]);
                if (!isNaN(l) && !isNaN(r) && motorRef?.current) {
                  motorRef.current.sendMotor(clampMotor(l), clampMotor(r));
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

        if (reply) {
          setTtsState("speaking");
          speakingRef.current = true;

          const voiceOpt = voicesRef.current.find((v) => v.id === selectedVoiceRef.current);
          try {
            if (voiceOpt?.type === "browser" && voiceOpt.voice) {
              setTtsSource(voiceOpt.voice.name);
              await speakBrowser(reply, voiceOpt.voice);
            } else if (voiceOpt?.type === "edge") {
              setTtsSource(voiceOpt.label);
              await fetchEdgeTts(reply, voiceOpt.id.replace("edge:", ""));
            } else {
              setTtsSource("gTTS");
              await fetchTts(reply);
            }
          } catch {}
          speakingRef.current = false;
          ttsEndRef.current = Date.now();
          setTtsState("idle");
        }
      }
    } catch (e: any) {
      setLastLlm(`Error: ${e.message}`);
    }

    processingRef.current = false;
    if (aiBusyRef) aiBusyRef.current = false;
    setStatus("idle");
    if (genRef.current === gen && !abortRef.current && !autoRef.current) {
      startListeningRef.current?.();
    }
  }

  function startListening() {
    if (abortRef.current || listeningRef.current || processingRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    if (recogRef.current) {
      try { recogRef.current.abort(); } catch {}
      recogRef.current = null;
    }

    const now = Date.now();
    if (now - lastListenRef.current < 2000) return;
    if (now - lastListenRef.current < 10000) listenCountRef.current++;
    else listenCountRef.current = 0;
    if (listenCountRef.current > 5) { setStatus("idle"); return; }
    lastListenRef.current = now;

    const sessionGen = ++listenGenRef.current;
    let gotResult = false;
    listeningRef.current = true;
    const recog = new SR();
    recog.lang = "id-ID";
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    recog.onresult = (e: any) => {
      if (listenGenRef.current !== sessionGen) return;
      gotResult = true;
      listeningRef.current = false;
      listenCountRef.current = 0;
      const text = e.results[e.results.length - 1][0].transcript.trim();
      if (!text) return;
      if (Date.now() - ttsEndRef.current < 800) return;
      genRef.current++;
      speechSynthesis.cancel();
      speakingRef.current = false;
      setStatus("processing");
      askGroqRef.current?.(text, false);
    };

    recog.onerror = () => {
      if (listenGenRef.current !== sessionGen) return;
      listeningRef.current = false;
      if (recogRef.current === recog) recogRef.current = null;
      if (!abortRef.current) setTimeout(() => startListeningRef.current?.(), 1500);
    };

    recog.onend = () => {
      if (listenGenRef.current !== sessionGen) return;
      listeningRef.current = false;
      if (recogRef.current === recog) recogRef.current = null;
      if (!abortRef.current && !gotResult && !processingRef.current) {
        setTimeout(() => startListeningRef.current?.(), 1500);
      }
    };

    recog.start();
    recogRef.current = recog;
    setStatus("listening");
  }

  // Auto context update + face greeting
  useEffect(() => {
    contextIvRef.current = setInterval(() => {
      if (processingRef.current) return;

      const ctx = buildContext(detectionsRef.current, recognizedFaceRef.current, trackInfoRef.current, undefined, leftMotor, rightMotor);
      if (ctx === lastContextRef.current) return;
      lastContextRef.current = ctx;

      const faceNow = recognizedFaceRef.current?.name ?? null;
      if (faceNow && faceNow !== lastFaceRef.current && !speakingRef.current) {
        lastFaceRef.current = faceNow;
        motorRef?.current?.sendMotor(0, 0);
        if (motorRef?.current) {
          motorRef.current.setTrackTarget({ label: `wajah ${faceNow}`, lastSeen: Date.now() });
        }
        if (autoRef.current) {
          setAuto(false);
          autoRef.current = false;
          clearInterval(autoIvRef.current);
        }
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
      if (speakingRef.current || !autoRef.current || processingRef.current) return;
      const trackInfo = trackInfoRef.current;
      const isTracking = trackInfo.includes('✅') || trackInfo.includes('🔒');
      const isStuck = trackInfo.includes('stuck');
      const isBlocked = trackInfo.startsWith('hindar');
      const key = `${isTracking ? 'T' : ''}${isStuck ? '!':''}${isBlocked ? 'B':''}`;
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
      if (!autoRef.current || speakingRef.current || processingRef.current) return;
      groqCalls++;
      if (groqCalls % 6 !== 0) return;
      askGroqRef.current?.("Ada yang menarik? Kasi saran target. Jalan-jalan cari petualangan!", true);
    };
    const reportIv = setInterval(() => {
      if (!autoRef.current || speakingRef.current || processingRef.current) return;
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
    const saved = localStorage.getItem("kei_groq_key");
    if (saved) setApiKey(saved);
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
    genRef.current++;
    abortRef.current = false;
    speakingRef.current = false;
    setLastLlm("");
    setTtsState("idle");
    startListeningRef.current?.();
  }, []);

  const stop = useCallback(() => {
    genRef.current++;
    abortRef.current = true;
    speakingRef.current = false;
    processingRef.current = false;
    listeningRef.current = false;
    recogRef.current?.abort();
    recogRef.current = null;
    speechSynthesis.cancel();
    setStatus("idle");
    setTtsState("idle");
  }, []);

  return (
    <div className="w-full max-w-sm rounded-xl bg-zinc-900/90 ring-1 ring-white/10 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <div className={`size-1.5 rounded-full ${status === "listening" ? "bg-green-400 animate-pulse" : status === "processing" ? "bg-yellow-400" : "bg-zinc-600"}`} />
          <span className="text-[10px] font-mono text-zinc-400">Kei Voice</span>
          {ttsState === "speaking" ? (
            <span className="text-[7px] text-blue-400 font-mono">🔊 {selectedVoiceRef.current === "gtts" ? "gTTS" : selectedVoiceRef.current?.startsWith("edge:") ? "Edge" : selectedVoiceRef.current?.startsWith("browser:") ? "Browser" : ""}</span>
          ) : ttsSource ? (
            <span className="text-[6px] text-zinc-600 font-mono">{ttsSource}</span>
          ) : null}
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
          <button onClick={() => setShowSettings(p => !p)}
            className="text-[9px] text-zinc-500 hover:text-zinc-300 font-mono ml-1">
            {showSettings ? "×" : "⚙"}
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="px-3 py-2 border-b border-white/5 flex gap-1.5 items-center">
          <input value={apiKey} onChange={e => { setApiKey(e.target.value); localStorage.setItem("kei_groq_key", e.target.value); }}
            placeholder="Groq API key"
            type="password"
            className="flex-1 min-w-0 px-2 py-1 rounded bg-zinc-800 text-white text-[9px] font-mono placeholder-zinc-500 focus:outline-none" />
          {apiKey && <div className="size-1.5 rounded-full bg-green-400 shrink-0" />}
        </div>
      )}

      {lastLlm && (
        <div className="px-2.5 py-1.5 border-b border-white/5">
          <div className="text-[8px] font-mono text-zinc-300 leading-relaxed">{lastLlm}</div>
        </div>
      )}

      {chatHistory.length > 0 && (
        <div className="px-2.5 py-1.5 border-b border-white/5 max-h-20 overflow-y-auto">
          {chatHistory.filter(m => m.role !== "system").slice(-4).map((m, i) => (
            <div key={i} className={`text-[7px] font-mono ${m.role === "user" ? "text-fuchsia-400" : "text-zinc-400"}`}>
              {m.role === "user" ? "🧑 " : "🤖 "}{m.content.slice(0, 80)}{m.content.length > 80 ? "…" : ""}
            </div>
          ))}
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
