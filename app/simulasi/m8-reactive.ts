import { useRef } from "react";
import { SECTORS } from "./constants";
import type { ModuleCtx } from "./types";

export type M8Phase = "IDLE" | "BACK" | "TURN";

export interface M8State {
  phaseRef: React.MutableRefObject<M8Phase>;
  tickRef: React.MutableRefObject<number>;
  turnDirRef: React.MutableRefObject<number>;
  targetHeadingRef: React.MutableRefObject<number>;
  bestSectorRef: React.MutableRefObject<number>;
}

export function createM8State() {
  return {
    phaseRef: { current: "IDLE" as M8Phase },
    tickRef: { current: 0 },
    turnDirRef: { current: 1 },
    targetHeadingRef: { current: 0 },
    bestSectorRef: { current: -1 },
  };
}

export function m8Tick(ctx: ModuleCtx, st: M8State) {
  if (ctx.joyActiveRef.current || ctx.keyActiveRef.current) return;

  const dist = ctx.distanceRef.current;
  const heading = ctx.headingRef.current;
  const sd = ctx.sectorDataRef.current;
  const phase = st.phaseRef.current;

  // === IDLE: maju, scan sector, hindari rintangan ===
  if (phase === "IDLE") {
    let spd = 100;
    if (dist > 0 && dist < 15) spd = 0;
    else if (dist > 0 && dist < 30) spd = 30;
    else if (dist > 0 && dist < 60) spd = 60;

    ctx.setMotors(spd, spd);

    if (dist > 0 && dist < 30) {
      // Cari sector paling lega
      let best = -1, bestScore = -1;
      for (let i = 0; i < SECTORS.length; i++) {
        const d = sd[i];
        if (d < 0) continue;
        const clearance = Math.min(d / 100, 1);
        const cx = SECTORS[i].cx;
        const centerBonus = (1 - Math.abs(cx - 90) / 90) * 0.3;
        const score = clearance + centerBonus;
        if (score > bestScore) { bestScore = score; best = i; }
      }

      if (best >= 0 && bestScore > 0.2) {
        const targetAngle = (90 - SECTORS[best].cx) * Math.PI / 180;
        st.targetHeadingRef.current = heading + targetAngle;
        st.turnDirRef.current = SECTORS[best].cx > 90 ? 1 : -1;
        st.bestSectorRef.current = best;
        ctx.sendServo(SECTORS[best].cx);
        st.phaseRef.current = "TURN";
        st.tickRef.current = 0;
        ctx.logEvent(`M8: ${dist.toFixed(0)}cm → S${best + 1} (${d(st, best)}cm)`, "nav");
      } else {
        // Semua sector blocked, mundur
        st.phaseRef.current = "BACK";
        st.tickRef.current = 0;
        ctx.logEvent(`M8: ${dist.toFixed(0)}cm, semua blokir, mundur`, "nav");
      }
    }
  }

  // === BACK: mundur sebentar ===
  if (phase === "BACK") {
    st.tickRef.current++;
    const spd = Math.min(60 + st.tickRef.current * 2, 120);
    ctx.setMotors(-spd, -spd);
    ctx.sendServo(90);

    if (st.tickRef.current > 25) {
      // Scan sehabis mundur
      let best = -1, bestScore = -1;
      for (let i = 0; i < SECTORS.length; i++) {
        const dd = sd[i];
        if (dd < 0) continue;
        const clearance = Math.min(dd / 100, 1);
        const cx = SECTORS[i].cx;
        const centerBonus = (1 - Math.abs(cx - 90) / 90) * 0.3;
        const score = clearance + centerBonus;
        if (score > bestScore) { bestScore = score; best = i; }
      }

      if (best >= 0 && bestScore > 0.2) {
        const targetAngle = (90 - SECTORS[best].cx) * Math.PI / 180;
        st.targetHeadingRef.current = heading + targetAngle;
        st.turnDirRef.current = SECTORS[best].cx > 90 ? 1 : -1;
        st.bestSectorRef.current = best;
        ctx.sendServo(SECTORS[best].cx);
        st.phaseRef.current = "TURN";
        st.tickRef.current = 0;
        ctx.logEvent(`M8: mundur OK → S${best + 1}`, "nav");
      } else {
        // Putar random
        st.turnDirRef.current = Math.random() > 0.5 ? 1 : -1;
        st.targetHeadingRef.current = heading + st.turnDirRef.current * Math.PI / 2;
        st.bestSectorRef.current = -1;
        ctx.sendServo(st.turnDirRef.current > 0 ? 140 : 40);
        st.phaseRef.current = "TURN";
        st.tickRef.current = 0;
        ctx.logEvent("M8: mundur OK, putar random", "nav");
      }
    }
  }

  // === TURN: putar ke arah sector ===
  if (phase === "TURN") {
    st.tickRef.current++;
    const speed = 100;
    ctx.setMotors(-speed * st.turnDirRef.current, speed * st.turnDirRef.current);

    // Servo tetap arah sector selama belok
    if (st.bestSectorRef.current >= 0) {
      ctx.sendServo(SECTORS[st.bestSectorRef.current].cx);
    }

    // Cek heading
    let diff = st.targetHeadingRef.current - heading;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    if (Math.abs(diff) < 0.3 || st.tickRef.current > 40) {
      ctx.sendServo(90);
      st.phaseRef.current = "IDLE";
      st.tickRef.current = 0;
      st.bestSectorRef.current = -1;
      ctx.logEvent("M8: putar OK", "nav");
    }
  }
}

// Safety clamp — jalanin SETIAP tick, override motor kalau bahaya
export function m8Safety(ctx: ModuleCtx) {
  const dist = ctx.distanceRef.current;
  let l = ctx.leftMotorRef.current;
  let r = ctx.rightMotorRef.current;
  let overridden = false;

  if (dist > 0 && dist < 15 && (l > 0 || r > 0)) {
    l = -80; r = -80;
    overridden = true;
  } else if (dist > 0 && dist < 30 && (l + r) / 2 > 60) {
    l = Math.min(l, 60);
    r = Math.min(r, 60);
    overridden = true;
  } else if (dist > 0 && dist < 60 && (l + r) / 2 > 120) {
    l = Math.min(l, 120);
    r = Math.min(r, 120);
    overridden = true;
  }

  if (overridden && (l !== ctx.leftMotorRef.current || r !== ctx.rightMotorRef.current)) {
    ctx.setMotors(l, r);
    ctx.logEvent(`M8 safety: ${dist.toFixed(0)}cm`, "warn");
  }
}

function d(st: M8State, i: number): string {
  return (SECTORS[i] as any)?.id ?? "?";
}
