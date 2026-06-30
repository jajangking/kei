"use client";

import { useRef, useEffect, useState, useCallback } from "react";

const GRID = 50;
const COLS = 20;
const ROWS = 16;
const ROBOT_R = 12;
const ACCEL = 0.06;
const FRICTION = 0.85;

type Cell = 0 | 1; // 0 = jalan, 1 = tembok

export default function GamePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef({ x: 1.5 * GRID, y: 1.5 * GRID });
  const headingRef = useRef(0);
  const velRef = useRef({ x: 0, y: 0 });
  const angVelRef = useRef(0);
  const keysRef = useRef(new Set<string>());
  const [score, setScore] = useState(0);
  const [hp, setHp] = useState(5);
  const [gameOver, setGameOver] = useState(false);
  const [level, setLevel] = useState(1);
  const mazeRef = useRef<Cell[][]>(genMaze(COLS, ROWS));
  const visitedRef = useRef<Set<string>>(new Set());
  const bonusRef = useRef<{ x: number; y: number } | null>(null);
  const [showBonus, setShowBonus] = useState(false);
  const animRef = useRef(0);
  const joystickRef = useRef<HTMLDivElement>(null);
  const joyActiveRef = useRef(false);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const joyMotorRef = useRef({ nx: 0, ny: 0 });
  const [aiActive, setAiActive] = useState(false);
  const aiActiveRef = useRef(false);
  const [aiStatus, setAiStatus] = useState("");

  // Generate maze with recursive backtracking
  function genMaze(cols: number, rows: number): Cell[][] {
    const grid: Cell[][] = Array.from({ length: rows }, () => Array(cols).fill(1));
    const stack: [number, number][] = [];
    const start: [number, number] = [1, 1];
    grid[start[1]][start[0]] = 0;
    stack.push(start);

    while (stack.length > 0) {
      const [cx, cy] = stack[stack.length - 1];
      const dirs: [number, number][] = [[2, 0], [-2, 0], [0, 2], [0, -2]];
      const shuffled = dirs.sort(() => Math.random() - 0.5);
      let carved = false;
      for (const [dx, dy] of shuffled) {
        const nx = cx + dx, ny = cy + dy;
        if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && grid[ny][nx] === 1) {
          grid[ny][nx] = 0;
          grid[cy + dy / 2][cx + dx / 2] = 0;
          stack.push([nx, ny]);
          carved = true;
          break;
        }
      }
      if (!carved) stack.pop();
    }
    return grid;
  }

  const worldX = (col: number) => col * GRID;
  const worldY = (row: number) => row * GRID;

  function collides(x: number, y: number): boolean {
    const r = ROBOT_R;
    const minCol = Math.max(0, Math.floor((x - r) / GRID));
    const maxCol = Math.min(COLS - 1, Math.ceil((x + r) / GRID));
    const minRow = Math.max(0, Math.floor((y - r) / GRID));
    const maxRow = Math.min(ROWS - 1, Math.ceil((y + r) / GRID));
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (mazeRef.current[row][col] === 1) {
          const cx = worldX(col) + GRID / 2;
          const cy = worldY(row) + GRID / 2;
          const hw = GRID / 2;
          const hh = GRID / 2;
          const nearX = Math.max(cx - hw, Math.min(x, cx + hw));
          const nearY = Math.max(cy - hh, Math.min(y, cy + hh));
          if (Math.hypot(x - nearX, y - nearY) < r) return true;
        }
      }
    }
    return false;
  }

  const resetGame = useCallback(() => {
    posRef.current = { x: 1.5 * GRID, y: 1.5 * GRID };
    headingRef.current = 0;
    velRef.current = { x: 0, y: 0 };
    angVelRef.current = 0;
    mazeRef.current = genMaze(COLS, ROWS);
    visitedRef.current = new Set();
    setScore(0);
    setHp(5);
    setGameOver(false);
    bonusRef.current = null;
    setShowBonus(false);
  }, []);

  // Tick
  const tick = useCallback(() => {
    if (gameOver) return;
    const k = keysRef.current;
    let lm = 0, rm = 0;
    if (k.has("w") || k.has("arrowup")) { lm = 255; rm = 255; }
    if (k.has("s") || k.has("arrowdown")) { lm = -255; rm = -255; }
    if (k.has("a") || k.has("arrowleft")) { lm = -200; rm = 200; }
    if (k.has("d") || k.has("arrowright")) { lm = 200; rm = -200; }
    if (k.has(" ")) { lm = 0; rm = 0; }
    // Joystick override
    if (joyActiveRef.current) {
      const jm = joyMotorRef.current;
      if (Math.abs(jm.nx) > 0.1 || Math.abs(jm.ny) > 0.1) {
        // Pacman-style: joystick arah = heading, magnitude = speed
        const targetH = Math.atan2(jm.nx, jm.ny);
        const mag = Math.min(1, Math.hypot(jm.nx, jm.ny));
        headingRef.current = targetH;
        const speed = mag * 255;
        lm = speed; rm = speed;
      } else {
        lm = 0; rm = 0;
      }
    }

    // AI mode — direct steering to nearest unvisited cell center
    if (aiActiveRef.current && !joyActiveRef.current && keysRef.current.size === 0) {
      const p = posRef.current;
      // Cari cell terdekat yg belum dikunjungi
      let best: [number, number] | null = null, bestDist = Infinity;
      for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) {
          if (mazeRef.current[r][c] === 1 || visitedRef.current.has(`${c},${r}`)) continue;
          const d = Math.hypot(worldX(c) + GRID / 2 - p.x, worldY(r) + GRID / 2 - p.y);
          if (d < bestDist) { bestDist = d; best = [c, r]; }
        }
      }
      if (best) {
        const tx = worldX(best[0]) + GRID / 2;
        const ty = worldY(best[1]) + GRID / 2;
        const targetH = Math.atan2(tx - p.x, -(ty - p.y));
        let err = targetH - headingRef.current;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        if (Math.abs(err) > 0.2) {
          const power = Math.min(200, Math.abs(err) * 180);
          if (err > 0) { lm = -Math.round(power); rm = Math.round(power); }
          else { lm = Math.round(power); rm = -Math.round(power); }
        } else {
          headingRef.current += err * 0.15;
          lm = 200; rm = 200;
        }
        setAiStatus(`→ ${Math.round(bestDist / GRID)} cells`);
      } else {
        setAiStatus("done ✓");
      }
    }

    const h = headingRef.current;
    const vl = Math.max(-1, Math.min(1, lm / 255));
    const vr = Math.max(-1, Math.min(1, rm / 255));
    const V_target = (vl + vr) / 2 * 1.5;
    const w_target = (vl - vr) / 14 * 1.2;
    const targetVx = V_target * Math.sin(h);
    const targetVy = -V_target * Math.cos(h);

    velRef.current.x += (targetVx - velRef.current.x) * ACCEL;
    velRef.current.y += (targetVy - velRef.current.y) * ACCEL;
    angVelRef.current += (w_target - angVelRef.current) * 0.04;

    if (lm === 0 && rm === 0) {
      velRef.current.x *= FRICTION;
      velRef.current.y *= FRICTION;
      angVelRef.current *= 0.7;
    }

    const p = posRef.current;
    const dx = velRef.current.x;
    const dy = velRef.current.y;
    const dh = angVelRef.current;

    if (!collides(p.x + dx, p.y)) p.x += dx; else velRef.current.x *= -0.2;
    if (!collides(p.x, p.y + dy)) p.y += dy; else velRef.current.y *= -0.2;
    headingRef.current = h + dh;

    // Scoring: visit cells
    const cellKey = `${Math.floor(p.x / GRID)},${Math.floor(p.y / GRID)}`;
    if (!visitedRef.current.has(cellKey)) {
      visitedRef.current.add(cellKey);
      setScore(s => s + 10);
      // Bonus spawn
      if (Math.random() < 0.05 && !bonusRef.current) {
        let bx = 0, by = 0;
        do {
          bx = 1 + Math.floor(Math.random() * (COLS - 2));
          by = 1 + Math.floor(Math.random() * (ROWS - 2));
        } while (mazeRef.current[by][bx] === 1);
        bonusRef.current = { x: worldX(bx) + GRID / 2, y: worldY(by) + GRID / 2 };
        setShowBonus(true);
      }
    }

    // Check win
    if (visitedRef.current.size >= COLS * ROWS * 0.7) {
      setLevel(l => l + 1);
      resetGame();
      return;
    }
  }, [gameOver, resetGame]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const vw = rect.width;
    const vh = rect.height;
    const s = Math.min(vw / (COLS * GRID), vh / (ROWS * GRID));
    const ox = (vw - COLS * GRID * s) / 2;
    const oy = (vh - ROWS * GRID * s) / 2;

    ctx.fillStyle = "#18181b";
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    // Maze
    const maze = mazeRef.current;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * GRID;
        const y = row * GRID;
        if (maze[row][col] === 1) {
          ctx.fillStyle = "#27272a";
          ctx.fillRect(x, y, GRID, GRID);
          ctx.strokeStyle = "#3f3f46";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, GRID, GRID);
        } else {
          const vk = `${col},${row}`;
          if (visitedRef.current.has(vk)) {
            ctx.fillStyle = "rgba(34, 197, 94, 0.08)";
            ctx.fillRect(x, y, GRID, GRID);
          }
        }
      }
    }

    // Bonus
    if (bonusRef.current) {
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(bonusRef.current.x, bonusRef.current.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(251, 191, 36, 0.3)";
      ctx.beginPath();
      ctx.arc(bonusRef.current.x, bonusRef.current.y, 14 + Math.sin(Date.now() / 200) * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Trail
    const p = posRef.current;

    // Robot
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(headingRef.current);
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath();
    ctx.arc(0, 0, ROBOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Direction
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -ROBOT_R - 6);
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // HUD
    ctx.font = "10px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillText(`SCORE: ${score}`, 10, 18);
    ctx.fillText(`HP: ${"♥".repeat(hp)}${"♡".repeat(5 - hp)}`, 10, 32);
    ctx.fillText(`LV: ${level}`, 10, 46);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillText(`${visitedRef.current.size} cells explored`, 10, vh - 8);

    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, vw, vh);
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 24px monospace";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", vw / 2, vh / 2 - 20);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px monospace";
      ctx.fillText(`SCORE: ${score}`, vw / 2, vh / 2 + 10);
      ctx.fillText("Tekan SPACE untuk mulai ulang", vw / 2, vh / 2 + 35);
      ctx.textAlign = "left";
    }
  }, [score, hp, level, gameOver, showBonus]);

  // Loop
  useEffect(() => {
    const loop = () => {
      tick();
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [tick, draw]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase());
      if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(e.key.toLowerCase())) e.preventDefault();
      if (e.key === " " && gameOver) resetGame();
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [gameOver, resetGame]);

  useEffect(() => { aiActiveRef.current = aiActive; if (!aiActive) setAiStatus(""); }, [aiActive]);

  // Bonus pickup collision
  useEffect(() => {
    const iv = setInterval(() => {
      if (gameOver || !bonusRef.current) return;
      const d = Math.hypot(posRef.current.x - bonusRef.current.x, posRef.current.y - bonusRef.current.y);
      if (d < ROBOT_R + 10) {
        setScore(s => s + 50);
        bonusRef.current = null;
        setShowBonus(false);
      }
    }, 100);
    return () => clearInterval(iv);
  }, [gameOver]);

  // Wall hit damage
  const lastHpRef = useRef(0);
  useEffect(() => {
    const iv = setInterval(() => {
      if (gameOver) return;
      const v = Math.hypot(velRef.current.x, velRef.current.y);
      if (v < 0.5 || keysRef.current.size === 0) return;
      // check if touching wall
      const p = posRef.current;
      const r = ROBOT_R;
      let touching = false;
      const minCol = Math.max(0, Math.floor((p.x - r) / GRID));
      const maxCol = Math.min(COLS - 1, Math.ceil((p.x + r) / GRID));
      const minRow = Math.max(0, Math.floor((p.y - r) / GRID));
      const maxRow = Math.min(ROWS - 1, Math.ceil((p.y + r) / GRID));
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (mazeRef.current[row][col] === 1) {
            const cx = worldX(col) + GRID / 2;
            const cy = worldY(row) + GRID / 2;
            const nearX = Math.max(cx - GRID / 2, Math.min(p.x, cx + GRID / 2));
            const nearY = Math.max(cy - GRID / 2, Math.min(p.y, cy + GRID / 2));
            if (Math.hypot(p.x - nearX, p.y - nearY) < r + 1) { touching = true; break; }
          }
        }
        if (touching) break;
      }
      if (touching && v > 2) {
        const now = Date.now();
        if (now - lastHpRef.current > 500) {
          lastHpRef.current = now;
          setHp(p => {
            const n = p - 1;
            if (n <= 0) { setGameOver(true); return 0; }
            return n;
          });
        }
      }
    }, 200);
    return () => clearInterval(iv);
  }, [gameOver]);

  return (
    <main className="fixed inset-0 bg-black select-none touch-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none"
        tabIndex={0}
      />
      {/* Controls hint */}
      <div className="fixed bottom-[168px] left-1/2 -translate-x-1/2 text-[8px] font-mono text-zinc-600 bg-zinc-900/80 px-3 py-1 rounded-full backdrop-blur-sm border border-white/5 pointer-events-none">
        WASD / Arrow — gerak  |  Space — stop
      </div>

      {/* Joystick (HP touch) */}
      <div
        ref={joystickRef}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 size-36 rounded-full bg-zinc-900/80 backdrop-blur-md border border-white/10 touch-none select-none z-20"
        onPointerDown={(e) => {
          e.preventDefault();
          joyActiveRef.current = true;
          const el = joystickRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const maxR = rect.width / 2 - 10;
          let dx = e.clientX - cx;
          let dy = e.clientY - cy;
          const d = Math.hypot(dx, dy);
          if (d > maxR) { dx = (dx / d) * maxR; dy = (dy / d) * maxR; }
          setJoyPos({ x: dx, y: dy });
          const nx = dx / maxR;
          const ny = -dy / maxR;
          joyMotorRef.current = { nx, ny };
        }}
        onPointerMove={(e) => {
          if (!joyActiveRef.current) return;
          const el = joystickRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const maxR = rect.width / 2 - 10;
          let dx = e.clientX - cx;
          let dy = e.clientY - cy;
          const d = Math.hypot(dx, dy);
          if (d > maxR) { dx = (dx / d) * maxR; dy = (dy / d) * maxR; }
          setJoyPos({ x: dx, y: dy });
          const nx = dx / maxR;
          const ny = -dy / maxR;
          joyMotorRef.current = { nx, ny };
        }}
        onPointerUp={() => {
          joyActiveRef.current = false;
          joyMotorRef.current = { nx: 0, ny: 0 };
          setJoyPos({ x: 0, y: 0 });
        }}
        onPointerCancel={() => {
          joyActiveRef.current = false;
          joyMotorRef.current = { nx: 0, ny: 0 };
          setJoyPos({ x: 0, y: 0 });
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="size-2 rounded-full bg-zinc-700" />
        </div>
        <div
          className="absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 backdrop-blur-md border border-white/20 pointer-events-none"
          style={{ left: `calc(50% + ${joyPos.x}px)`, top: `calc(50% + ${joyPos.y}px)` }}
        />
      </div>

      <a href="/"
        className="fixed top-3 left-3 size-7 rounded-full bg-zinc-900/80 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-zinc-700/80 active:scale-90 z-10">
        <svg className="size-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
      </a>
      {/* AI toggle */}
      <button onClick={() => { setAiActive(p => !p); aiActiveRef.current = !aiActive; if (!aiActive) setAiStatus(""); }}
        className={`fixed top-3 right-3 z-10 px-2 py-1 rounded-full text-[9px] font-mono font-bold border transition-colors active:scale-90 ${
          aiActive ? "bg-violet-600 border-violet-500 text-white" : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white"
        }`}>
        {aiActive ? "AI ON" : "AI OFF"}
      </button>
      {aiActive && aiStatus && (
        <div className="fixed top-12 right-3 z-10 text-[8px] font-mono text-violet-400 bg-zinc-900/80 px-2 py-0.5 rounded-full backdrop-blur-sm">
          {aiStatus}
        </div>
      )}
    </main>
  );
}
