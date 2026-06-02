"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type TTSState = "idle" | "speaking";

const EDGE_VOICES = [
  "id-ID-GadisNeural", "id-ID-ArdiNeural", "en-US-JennyNeural", "en-US-GuyNeural",
  "en-GB-SoniaNeural", "en-GB-RyanNeural", "ja-JP-NanamiNeural", "ko-KR-SunHiNeural",
  "zh-CN-XiaoxiaoNeural",
];

interface VoiceOption {
  id: string;
  label: string;
  type: "gtts" | "browser" | "edge";
  voice?: SpeechSynthesisVoice;
}

export default function XiaozhiPage() {
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [lastLlm, setLastLlm] = useState("");
  const [ttsState, setTtsState] = useState<TTSState>("idle");
  const [ttsSource, setTtsSource] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("gtts");

  const logRef = useRef<string[]>([]);
  const genRef = useRef(0);
  const recogRef = useRef<any>(null);
  const acRef = useRef<AudioContext | null>(null);
  const speakingRef = useRef(false);
  const abortRef = useRef(false);
  const processingRef = useRef(false);
  const listeningRef = useRef(false);
  const ttsEndRef = useRef(0);

  const addLog = useCallback((m: string) => {
    const t = `${new Date().toLocaleTimeString()} ${m}`;
    logRef.current = [...logRef.current.slice(-99), t];
    setLogs(logRef.current);
  }, []);

  const askGroqRef = useRef<((text: string) => Promise<void>) | null>(null);
  const startListeningRef = useRef<(() => void) | null>(null);
  const voicesRef = useRef(voices);
  voicesRef.current = voices;
  const selectedVoiceRef = useRef(selectedVoice);
  selectedVoiceRef.current = selectedVoice;

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window as any)) {
      addLog("SpeechRecognition tidak tersedia ❌");
    } else {
      addLog("SpeechRecognition siap ✅");
    }
    try {
      acRef.current = new AudioContext({ sampleRate: 24000 });
      addLog("AudioContext 24kHz siap ✅");
    } catch {
      acRef.current = new AudioContext();
      addLog("AudioContext default rate");
    }

    const loadVoices = () => {
      const all = speechSynthesis.getVoices();
      const opts: VoiceOption[] = [{ id: "gtts", label: "gTTS (Google)", type: "gtts" }];
      for (const name of EDGE_VOICES) {
        opts.push({ id: `edge:${name}`, label: `Edge ${name}`, type: "edge" });
      }
      for (const v of all) {
        if (v.lang.startsWith("id") || v.lang.startsWith("en")) {
          opts.push({ id: v.name, label: `Browser ${v.name}`, type: "browser", voice: v });
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
    addLog(`TTS: ${chunks.length} chunk(s), total ${text.length} chars`);
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

  async function askGroq(text: string) {
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
        addLog(`Groq ✅ ${fullText.slice(0, 80)}...`);
        setTtsState("speaking");
        speakingRef.current = true;

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
        ttsEndRef.current = Date.now();
        setTtsState("idle");
      }
    } catch (e: any) {
      addLog(`Groq error: ${e.message}`);
    }

    processingRef.current = false;
    setStatus("idle");
    if (genRef.current === gen && !abortRef.current) {
      startListeningRef.current?.();
    }
  }

  function startListening() {
    if (abortRef.current || listeningRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    let gotResult = false;
    listeningRef.current = true;
    const recog = new SR();
    recog.lang = "id-ID";
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    recog.onresult = (e: any) => {
      gotResult = true;
      listeningRef.current = false;
      const text = e.results[e.results.length - 1][0].transcript.trim();
      if (!text) return;
      // ignore echo within 800ms after TTS
      if (Date.now() - ttsEndRef.current < 800) {
        addLog(`Echo ignored: ${text.slice(0, 40)}`);
        return;
      }
      processingRef.current = true;
      addLog(`STT: ${text}`);
      setStatus("processing");
      askGroqRef.current?.(text);
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
    addLog("Mendengarkan...");
  }

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
    recogRef.current?.abort();
    recogRef.current = null;
    speechSynthesis.cancel();
    speakingRef.current = false;
    setStatus("idle");
    setTtsState("idle");
  }, []);

  askGroqRef.current = askGroq;
  startListeningRef.current = startListening;

  return (
    <main className="flex flex-col items-center bg-black min-h-dvh px-3 py-4 gap-3 overflow-y-auto">
      <div className="w-full max-w-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-white">Kei Voice</h1>
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-white text-[8px] font-mono rounded-full px-2 py-1 max-w-[140px] truncate focus:outline-none focus:border-zinc-500"
          >
            {voices.length === 0 && <option value="gtts" className="bg-zinc-900 text-white text-[8px]">gTTS (Google)</option>}
            {voices.map((v) => (
              <option key={v.id} value={v.id} className="bg-zinc-900 text-white text-[8px]">
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={status === "idle" ? start : stop}
          className={`py-3 rounded-full text-[12px] font-mono font-bold ${
            status === "idle" ? "bg-white text-black" : "bg-red-600 text-white"
          }`}
        >
          {status === "idle" ? "MULAI" : "BERHENTI"}
        </button>

        <div className="flex items-center gap-2 px-2">
          <div className={`size-2 rounded-full ${
            status === "listening" ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)] animate-pulse"
            : status === "processing" ? "bg-yellow-400" : "bg-zinc-600"
          }`}/>
          <span className="text-[9px] font-mono text-zinc-400">
            {status === "idle" ? "siap" : status === "listening" ? "dengar..." : "proses..."}
          </span>
          {ttsState === "speaking" && (
            <span className="text-[8px] text-blue-400 font-mono ml-auto">{ttsSource} 🔊</span>
          )}
        </div>

        {lastLlm && (
          <div className="rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-2.5 py-2">
            <div className="text-[7px] font-mono text-zinc-500 mb-1">RESPON</div>
            <div className="text-[11px] font-mono text-white leading-relaxed">{lastLlm}</div>
          </div>
        )}

        <div className="rounded-xl bg-zinc-900/80 ring-1 ring-white/10 px-2.5 py-2">
          <div className="text-[7px] font-mono text-zinc-500 mb-1">LOG</div>
          <div className="h-48 overflow-y-auto space-y-0.5">
            {logs.length === 0 && (
              <div className="text-[8px] text-zinc-700 font-mono">Klik MULAI untuk bicara</div>
            )}
            {logs.map((m, i) => (
              <div key={i} className={`text-[8px] font-mono leading-3.5 ${
                m.includes("❌") ? "text-red-400" :
                m.includes("✅") ? "text-green-400" :
                m.includes("TTS:") ? "text-cyan-300" :
                m.includes("Groq") ? "text-emerald-300" :
                m.includes("STT:") ? "text-yellow-300" : "text-zinc-400"
              }`}>{m}</div>
            ))}
          </div>
        </div>

        <div className="text-[7px] font-mono text-zinc-700 leading-relaxed">
          Flow: Mic → SpeechRecognition → Groq LLM → TTS → Speaker
          <br />Pilih suara di dropdown. gTTS default, browser voices alternatif.
        </div>
      </div>
    </main>
  );
}
