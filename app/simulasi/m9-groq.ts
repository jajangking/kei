import { useRef } from "react";
import { SECTORS } from "./constants";
import type { ModuleCtx } from "./types";

export interface M9State {
  lastCallRef: React.MutableRefObject<number>;
  busyRef: React.MutableRefObject<boolean>;
  lastReplyRef: React.MutableRefObject<string>;
  contextRef: React.MutableRefObject<string>;
  tickRef: React.MutableRefObject<number>;
}

export function createM9State() {
  return {
    lastCallRef: { current: 0 },
    busyRef: { current: false },
    lastReplyRef: { current: "" },
    contextRef: { current: "" },
    tickRef: { current: 0 },
  };
}

export function m9Tick(ctx: ModuleCtx, st: M9State) {
  if (ctx.joyActiveRef.current || ctx.keyActiveRef.current) return;

  const now = Date.now();
  const apiKey = localStorage.getItem("kei_groq_key") || "";

  // Throttle: minimal 5 detik antar call, dan harus ada API key
  if (!apiKey || st.busyRef.current || now - st.lastCallRef.current < 5000) return;

  // Build context
  const sd = ctx.sectorDataRef.current;
  const scanned = sd.filter(d => d >= 0).length;
  const unscanned = sd.filter(d => d < 0).length;
  const sectorStr = sd.map((d, i) => `${SECTORS[i].id}=${d >= 0 ? d.toFixed(0) + "cm" : "?"}`).join(" ");
  const headingDeg = ((ctx.headingRef.current * 180 / Math.PI) % 360 + 360) % 360;
  const pos = ctx.posRef.current;

  const ctxStr = [
    `Servo: ${ctx.servoRef.current}° (scan ${scanned}/14 sector, ${unscanned} belum discan)`,
    `Posisi: x=${pos.x.toFixed(0)} y=${pos.y.toFixed(0)} heading=${headingDeg.toFixed(0)}°`,
    `Motor: L=${ctx.leftMotorRef.current} R=${ctx.rightMotorRef.current}`,
    `Sektor: ${sectorStr}`,
    `Gyro: ${ctx.gyroRef.current.toFixed(2)}`,
    `Jarak: ${ctx.distanceRef.current > 0 ? ctx.distanceRef.current.toFixed(0) + "cm" : "?"}`,
  ].join("\n");

  st.contextRef.current = ctxStr;
  st.busyRef.current = true;
  st.lastCallRef.current = now;
  st.tickRef.current++;

  const systemPrompt = `Lo ADALAH robot Kei. Lo punya tubuh, sensor, dan motor. Lo yang ngerasain situasi langsung.

Lo punya:
- Servo + ultrasonik: scan lingkungan, dapat data jarak per sektor (S1-S14)
- Motor kiri & kanan: gerak maju, mundur, belok
- Heading: arah hadap lo sekarang

PERINTAH (WAJIB pakai kurung siku):
[motor:L,R] — motor kiri=L kanan=R (-255..255, maju positif, mundur negatif)
[servo:XX] — putar servo ke XX derajat (0=kiri, 90=tengah, 180=kanan)
[stop] — berhenti total

SAFETY — PALING PENTING:
- < 15cm = DEDAH! Langsung [stop] atau [motor:-80,-80] (mundur). JANGAN nabrak.
- 15-30cm = DEKAT. Speed MAX 60. Scan dulu sebelum maju.
- 30-60cm = AMAN tapi waspada. Speed MAX 120.
- > 60cm = LEGA. Speed bebas sampai 200.
- Kalau depan mepet tapi sisi ada jalan, belok dulu jangan maju.

CARA KERJA:
1. SCAN: Kirim [servo:XX] ke arah berbeda tiap response. Akumulasi data.
2. ANALISA: Baca S1-S14. "?" = belum discan. Angka = jarak obstacle cm.
3. PUTUSKAN: Pilih arah paling lega, sesuaikan speed, jalankan.

Contoh respons:
"Dekat 20cm, mundur [motor:-80,-80] [servo:30]"
"Kanan lega 85cm, jalan [servo:140] [motor:120,120]"
"Semua sector clear, maju [servo:90] [motor:180,180]"
"Kiri 45cm, kanan 70cm, ambil kanan [servo:150] [motor:80,120]"

Aturan:
- Respon 1 kalimat pendek + command.
- WAJIB sertakan [servo:XX] setiap response buat scan.
- Jangan muter di tempat sama lebih dari 3x.
- Kalau buntu, [stop] dulu, scan semua arah, baru putuskan arah keluar.`;

  fetch("/api/groq/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      stream: false,
      systemPrompt: `${systemPrompt}\n\nKonteks robot:\n${ctxStr}`,
      messages: [{ role: "user", content: "Gimana situasi? Kasih perintah." }],
    }),
  }).then(r => r.json()).then(data => {
    let reply = (data.content || "").trim();
    const cmds = reply.match(/\[([^\]]+)\]/g) || [];

    for (const cmd of cmds) {
      const inner = cmd.slice(1, -1);
      if (inner.startsWith("motor:")) {
        const parts = inner.slice(6).split(",").map(Number);
        if (parts.length === 2 && parts.every((n: number) => !isNaN(n))) {
          const ml = Math.max(-255, Math.min(255, parts[0]));
          const mr = Math.max(-255, Math.min(255, parts[1]));
          ctx.setMotors(ml, mr);
          ctx.logEvent(`M9 motor L=${ml} R=${mr}`, "nav");
        }
      } else if (inner.startsWith("servo:")) {
        const deg = parseInt(inner.slice(6));
        if (!isNaN(deg)) {
          ctx.sendServo(Math.max(0, Math.min(180, deg)));
          ctx.logEvent(`M9 servo → ${deg}°`, "nav");
        }
      } else if (inner.startsWith("stop")) {
        ctx.setMotors(0, 0);
        ctx.logEvent("M9: stop", "nav");
      }
    }

    reply = reply.replace(/\[([^\]]+)\]/g, "").trim();
    st.lastReplyRef.current = reply || "(no reply)";
    ctx.logEvent(`M9: ${reply}`, "nav");
    st.tickRef.current++;
  }).catch(e => {
    st.lastReplyRef.current = `error: ${e.message}`;
    ctx.logEvent(`M9 error: ${e.message}`, "error");
    st.tickRef.current++;
  }).finally(() => { st.busyRef.current = false; });
}
