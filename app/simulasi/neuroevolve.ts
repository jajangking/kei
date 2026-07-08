import type { Obstacle } from "./types";
import { SECTORS, MAX_SENSE, SERVO_SCALE, ROBOT_R, WHEEL_BASE } from "./constants";
import { rayIntersect, gridCellKey } from "./utils";

// ─── Configuration ───────────────────────────────────────────
export const LAYERS = [19, 24, 2];
export const POPULATION_SIZE = 50;
export const MAX_STEPS = 300;
export const MUTATION_RATE = 0.08;
export const MUTATION_STD = 0.2;
export const ELITE_COUNT = 2;
export const TOURNAMENT_SIZE = 3;
export const GOAL_RADIUS = 30;

// ─── Brain: feedforward neural network ────────────────────────
export type Genome = number[];

export class Brain {
  layers: number[];
  weights: number[][];
  biases: number[][];

  constructor(layers?: number[]) {
    this.layers = layers ?? LAYERS;
    this.weights = [];
    this.biases = [];
    for (let i = 0; i < this.layers.length - 1; i++) {
      const rows = this.layers[i];
      const cols = this.layers[i + 1];
      const w: number[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          w.push(Math.random() * 2 - 1);
        }
      }
      this.weights.push(w);
      const b: number[] = [];
      for (let c = 0; c < cols; c++) {
        b.push(Math.random() * 2 - 1);
      }
      this.biases.push(b);
    }
  }

  static genomeSize(layers: number[]): number {
    let s = 0;
    for (let i = 0; i < layers.length - 1; i++) {
      s += layers[i] * layers[i + 1] + layers[i + 1];
    }
    return s;
  }

  genome(): Genome {
    const g: number[] = [];
    for (const w of this.weights) for (const v of w) g.push(v);
    for (const b of this.biases) for (const v of b) g.push(v);
    return g;
  }

  fromGenome(g: Genome): void {
    let idx = 0;
    for (let i = 0; i < this.layers.length - 1; i++) {
      const rows = this.layers[i];
      const cols = this.layers[i + 1];
      for (let r = 0; r < rows * cols; r++) {
        this.weights[i][r] = g[idx++];
      }
      for (let c = 0; c < cols; c++) {
        this.biases[i][c] = g[idx++];
      }
    }
  }

  forward(inputs: number[]): number[] {
    let activations = inputs;
    for (let li = 0; li < this.layers.length - 1; li++) {
      const w = this.weights[li];
      const b = this.biases[li];
      const rows = this.layers[li];
      const cols = this.layers[li + 1];
      const next: number[] = [];
      for (let c = 0; c < cols; c++) {
        let sum = b[c];
        for (let r = 0; r < rows; r++) {
          sum += activations[r] * w[r * cols + c];
        }
        const isLast = li === this.layers.length - 2;
        next.push(isLast ? Math.tanh(sum) : Math.max(0, sum));
      }
      activations = next;
    }
    return activations;
  }
}

// ─── Simulation for evaluation ─────────────────────────────
export interface SimState {
  x: number;
  y: number;
  heading: number;
  lMotor: number;
  rMotor: number;
  step: number;
  collided?: boolean;
}

function clampMin(v: number): number {
  return v === 0 ? 0 : Math.round(v > 0 ? Math.max(80, v) : Math.min(-80, v));
}

function simulateStep(
  state: SimState,
  obstacles: Obstacle[],
  lCmd: number,
  rCmd: number,
  dt: number,
  speedFactor: number,
): SimState {
  const l = clampMin(Math.max(-255, Math.min(255, lCmd)));
  const r = clampMin(Math.max(-255, Math.min(255, rCmd)));
  const avg = (l + r) / 2 * speedFactor;
  const ang = (r - l) / WHEEL_BASE * speedFactor;
  const h = state.heading + ang * dt;
  const vx = Math.sin(h) * avg;
  const vy = -Math.cos(h) * avg;
  const nx = state.x + vx * dt;
  const ny = state.y + vy * dt;

  const collides = (x: number, y: number) => {
    for (const o of obstacles) {
      if (x + ROBOT_R > o.x && x - ROBOT_R < o.x + o.w && y + ROBOT_R > o.y && y - ROBOT_R < o.y + o.h) return true;
    }
    return false;
  };

  const finalX = collides(nx, ny) ? state.x : nx;
  const finalY = collides(nx, ny) ? state.y : ny;
  const collided = collides(nx, ny);

  return { x: finalX, y: finalY, heading: h, lMotor: l, rMotor: r, step: state.step + 1, collided };
}

function simulateSectors(
  x: number,
  y: number,
  heading: number,
  obstacles: Obstacle[],
): number[] {
  return SECTORS.map((sec) => {
    const angleOffset = ((sec.cx - 90) / SERVO_SCALE) * (Math.PI / 180);
    const h = heading + angleOffset;
    const rx = Math.sin(h);
    const ry = -Math.cos(h);
    let closest = -1;
    for (const o of obstacles) {
      const d = rayIntersect(x, y, rx, ry, o);
      if (d > 0 && (closest < 0 || d < closest)) closest = d;
    }
    return closest > 0 ? Math.min(closest, MAX_SENSE) / MAX_SENSE : 1;
  });
}

// ─── Evolution Engine ──────────────────────────────────────
export interface EvoStats {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  bestGenome: Genome;
  fitnesses: number[];
}

export interface GenRunResult {
  bestFitness: number;
  avgFitness: number;
  bestGenome: Genome;
  fitnesses: number[];
}

export class EvolutionEngine {
  brains: Brain[];
  fitnesses: number[];
  generation: number;
  bestFitness: number;
  bestGenome: Genome;
  fitnessHistory: { gen: number; best: number; avg: number }[];
  running: boolean;
  goalX: number;
  goalY: number;

  constructor() {
    this.brains = [];
    this.fitnesses = [];
    this.generation = 0;
    this.bestFitness = -Infinity;
    this.bestGenome = Brain.genomeSize(LAYERS) > 0 ? new Brain().genome() : [];
    this.fitnessHistory = [];
    this.running = false;
    this.goalX = 0;
    this.goalY = 350;
  }

  createPopulation(dir?: number[]): void {
    this.brains = [];
    for (let i = 0; i < POPULATION_SIZE; i++) {
      const b = new Brain(LAYERS);
      if (dir) {
        const g = b.genome();
        for (let j = 0; j < g.length; j++) {
          g[j] = g[j] * 0.3 + dir[j] * 0.7 + (Math.random() * 2 - 1) * 0.1;
        }
        b.fromGenome(g);
      }
      this.brains.push(b);
    }
    this.fitnesses = new Array(POPULATION_SIZE).fill(0);
    this.generation = 0;
    this.bestFitness = -Infinity;
    this.fitnessHistory = [];
  }

  runGeneration(obstacles: Obstacle[]): GenRunResult {
    if (this.brains.length === 0) this.createPopulation();

    let totalFitness = 0;
    let genBest = -Infinity;
    let genBestGenome: Genome | null = null;
    const allFitnesses: number[] = [];

    for (let i = 0; i < this.brains.length; i++) {
      const fit = this.evaluate(this.brains[i], obstacles);
      this.fitnesses[i] = fit;
      allFitnesses.push(fit);
      totalFitness += fit;
      if (fit > genBest) {
        genBest = fit;
        genBestGenome = this.brains[i].genome();
      }
    }

    if (genBest > this.bestFitness && genBestGenome) {
      this.bestFitness = genBest;
      this.bestGenome = genBestGenome;
    }

    const avgFit = totalFitness / this.brains.length;
    this.fitnessHistory.push({ gen: this.generation, best: genBest, avg: avgFit });

    this.evolve();

    return {
      bestFitness: genBest,
      avgFitness: avgFit,
      bestGenome: genBestGenome ?? this.bestGenome,
      fitnesses: allFitnesses,
    };
  }

  evaluate(brain: Brain, obstacles: Obstacle[]): number {
    const startPos = this.findSafeSpawn(obstacles);
    let state: SimState = {
      x: startPos.x,
      y: startPos.y,
      heading: Math.random() * Math.PI * 2,
      lMotor: 0,
      rMotor: 0,
      step: 0,
      collided: false,
    };

    let fitness = 0;
    const visited = new Set<string>();
    const dt = 0.03;
    const speedFactor = 0.12;
    let prevDist = Infinity;
    let stuckTicks = 0;
    let forwardTicks = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const sectors = simulateSectors(state.x, state.y, state.heading, obstacles);
      const speed = Math.abs(state.lMotor + state.rMotor) / 510;
      const nearObs = sectors.some(s => s < 0.15);
      const inputs = [
        ...sectors,
        Math.sin(state.heading),
        Math.cos(state.heading),
        speed,
        nearObs ? 1 : 0,
      ];
      const outputs = brain.forward(inputs);
      const lCmd = outputs[0] * 255;
      const rCmd = outputs[1] * 255;

      const prevPos = { x: state.x, y: state.y };
      state = simulateStep(state, obstacles, lCmd, rCmd, dt, speedFactor);
      const moved = Math.hypot(state.x - prevPos.x, state.y - prevPos.y);

      const cellKey = gridCellKey(state.x, state.y);
      const isNew = !visited.has(cellKey);
      if (isNew) visited.add(cellKey);

      const distToGoal = Math.hypot(state.x - this.goalX, state.y - this.goalY);

      if (moved > 0.5 && !state.collided) {
        fitness += moved * 3;
        forwardTicks++;
        stuckTicks = 0;
      } else if (moved < 0.1) {
        stuckTicks++;
        if (stuckTicks > 30) fitness -= 0.5;
      }

      if (state.collided) {
        fitness -= 15;
        break;
      }

      if (isNew) fitness += 5;

      if (prevDist < distToGoal) fitness += 0.3;

      if (distToGoal < GOAL_RADIUS) {
        fitness += 50;
        break;
      }

      if (nearObs) fitness -= 0.2;
      if (sectors[6] > 0.7) fitness += 0.3;

      prevDist = distToGoal;

      if (state.collided) break;
    }

    fitness += visited.size * 2;
    if (forwardTicks > MAX_STEPS * 0.6) fitness += 20;

    return Math.max(fitness, -200);
  }

  evolve(): void {
    const indexed = this.brains.map((b, i) => ({ brain: b, fitness: this.fitnesses[i] }));
    indexed.sort((a, b) => b.fitness - a.fitness);

    const next: Brain[] = [];

    for (let i = 0; i < ELITE_COUNT && i < indexed.length; i++) {
      const b = new Brain(LAYERS);
      b.fromGenome(indexed[i].brain.genome());
      next.push(b);
    }

    while (next.length < POPULATION_SIZE) {
      const a = this.selectParent(indexed);
      const b = this.selectParent(indexed);
      const childGenome = this.crossover(a.genome(), b.genome());
      const mutated = this.mutate(childGenome);
      const child = new Brain(LAYERS);
      child.fromGenome(mutated);
      next.push(child);
    }

    this.brains = next;
    this.generation++;
  }

  private selectParent(pop: { brain: Brain; fitness: number }[]): Brain {
    let best = pop[Math.floor(Math.random() * pop.length)];
    for (let i = 1; i < TOURNAMENT_SIZE; i++) {
      const c = pop[Math.floor(Math.random() * pop.length)];
      if (c.fitness > best.fitness) best = c;
    }
    return best.brain;
  }

  private crossover(a: Genome, b: Genome): Genome {
    return a.map((v, i) => (Math.random() < 0.5 ? v : b[i]));
  }

  private mutate(g: Genome): Genome {
    return g.map((v) => (Math.random() < MUTATION_RATE ? v + (Math.random() * 2 - 1) * MUTATION_STD : v));
  }

  private findSafeSpawn(obstacles: Obstacle[]): { x: number; y: number } {
    const candidates = [
      { x: 0, y: 350 },
      { x: -150, y: 250 },
      { x: 150, y: 450 },
      { x: -200, y: 450 },
      { x: 200, y: 150 },
      { x: 0, y: 100 },
      { x: 0, y: 600 },
    ];
    for (const pos of candidates) {
      let ok = true;
      for (const o of obstacles) {
        if (pos.x + ROBOT_R > o.x && pos.x - ROBOT_R < o.x + o.w && pos.y + ROBOT_R > o.y && pos.y - ROBOT_R < o.y + o.h) {
          ok = false;
          break;
        }
      }
      if (ok) return pos;
    }
    for (let y = 50; y < 650; y += 50) {
      for (let x = -350; x < 350; x += 50) {
        let ok = true;
        for (const o of obstacles) {
          if (x + ROBOT_R > o.x && x - ROBOT_R < o.x + o.w && y + ROBOT_R > o.y && y - ROBOT_R < o.y + o.h) {
            ok = false;
            break;
          }
        }
        if (ok) return { x, y };
      }
    }
    return { x: 0, y: 350 };
  }
}
