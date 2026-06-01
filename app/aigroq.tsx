"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface AIGroqProps {
  recognizedFaceRef: React.MutableRefObject<{ name: string } | null>;
  detectionsRef: React.MutableRefObject<{ categories: { categoryName: string; score: number }[] }[]>;
  trackInfoRef: React.MutableRefObject<string>;
  scanStateRef: React.MutableRefObject<string>;
  aiBusyRef?: React.MutableRefObject<boolean>;
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

let speechRecogCtor: any = null;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const STORAGE_KEY = "kei_groq_key";

const SYSTEM_PROMPT = `Lo adalah Kei, suara robot. Aturan:
- Ngomong alami kayak orang, JANGAN mulai dengan kata "Liat" atau "Lihat".
- Kalo ditanya situasi, ceritain apa yang ada — dengan bahasa sendiri, bukan ngulang data mentah.
- Kalo cuma greeting, jawab salam aja.
- HANYA omongin apa yang ADA di konteks — jangan ngarang.
- Jawab 1-2 kalimat pendek.
- Gak usah pake emoticon.

Lo BISA gerakin robot pake perintah di dalem kurung siku:
[motor:L,R] — gerak motor kiri=L kanan=R (-255 sd 255)
[track:label] — tracking objek
[stop] — berhenti
[scan] — cari objek dari awal
Contoh: "Ada mobil di kanan, gua follow. [track:mobil]"
Contoh: "Maju dikit. [motor:50,50]"

Sesuain gaya bicara sama situasi.`;

function buildContext(
  dets: { categories: { categoryName: string; score: number }[] }[],
  face: { name: string } | null,
  trackInfo: string,
  scanState: string,
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
  return ctx;
}

export default function AIGroq({ recognizedFaceRef, detectionsRef, trackInfoRef, scanStateRef, aiBusyRef, motorRef }: AIGroqProps) {
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

  const sendToGroq = useCallback(async (userText: string, isAuto?: boolean) => {
    const key = apiKeyRef.current;
    if (!key) return;

    const ctx = buildContext(detectionsRef.current, recognizedFaceRef.current, trackInfoRef.current, scanStateRef.current);
    const systemMsg: ChatMsg = { role: "system", content: `${SYSTEM_PROMPT}\n\nKonteks saat ini: ${ctx}` };

    const history = msgsRef.current.filter(m => m.role !== "system");
    const recent = history.slice(-10);
    const body = {
      model: MODEL,
      messages: [systemMsg, ...recent, { role: "user", content: userText }],
      temperature: 0.5,
      max_tokens: 60,
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
      let reply = (data.choices?.[0]?.message?.content || "").trim();
      // Strip thinking tags (closed or unclosed)
      reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();
      if (reply) {
        // Parse commands from reply: [motor:l,r] [track:label] [stop] [scan]
        const cmds = reply.match(/\[([^\]]+)\]/g) || [];
        for (const raw of cmds) {
          const cmd = raw.slice(1, -1);
          if (cmd.startsWith("motor:")) {
            const parts = cmd.slice(6).split(",");
            if (parts.length === 2) {
              const l = parseInt(parts[0]), r = parseInt(parts[1]);
              if (!isNaN(l) && !isNaN(r) && motorRef?.current) {
                motorRef.current.sendMotor(l, r);
              }
            }
          } else if (cmd.startsWith("track:")) {
            const label = cmd.slice(6).trim();
            if (label && motorRef?.current) {
              motorRef.current.setTrackTarget({ label, lastSeen: Date.now() });
            }
          } else if (cmd === "stop") {
            motorRef?.current?.sendMotor(0, 0);
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
    sendToGroq(text.trim());
  }, [thinking, sendToGroq]);

  // Auto context update + proactive chat
  useEffect(() => {
    contextIvRef.current = setInterval(() => {
      const ctx = buildContext(detectionsRef.current, recognizedFaceRef.current, trackInfoRef.current, scanStateRef.current);
      if (ctx === lastContextRef.current) return;
      lastContextRef.current = ctx;

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

  // Auto-report on state change (event-based + cooldown)
  useEffect(() => {
    const tick = () => {
      if (!apiKeyRef.current || speakingRef.current || convRef.current) return;
      updateMood();
      const trackInfo = trackInfoRef.current;
      const scanState = scanStateRef.current;
      const dets = detectionsRef.current;
      // Build a status key — only report on changes
      const hasTarget = trackInfo.includes('✅') || trackInfo.includes('🔒');
      const isScanning = trackInfo.startsWith('cari') || scanState === 'scanning';
      const isBlocked = trackInfo.startsWith('hindar');
      const isDark = trackInfo.includes('gelap');
      const detCount = dets.length > 3 ? 'banyak' : dets.length === 0 ? 'kosong' : 'ada';
      const key = `${hasTarget ? 'track' : ''}|${isScanning ? 'scan' : ''}|${isBlocked ? 'block' : ''}|${isDark ? 'dark' : ''}|${detCount}`;
      if (key === lastStatusRef.current) return;
      lastStatusRef.current = key;
      // Cooldown 5 detik
      const now = Date.now();
      if (now - lastReportRef.current < 5000) return;
      lastReportRef.current = now;
      sendToGroq("Keadaan gimana? Ceritain santai aja", true);
    };
    autoReplyIvRef.current = setInterval(tick, 2000);
    return () => clearInterval(autoReplyIvRef.current);
  }, [sendToGroq]);

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
