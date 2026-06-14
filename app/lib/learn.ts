export type SensorSnapshot = {
  farLeft: number;
  midLeft: number;
  nearLeft: number;
  front: number;
  nearRight: number;
  midRight: number;
  farRight: number;
  gyro: number; // simulated MPU gyro Z-axis
  wallLeft: boolean;
  wallRight: boolean;
};

export type MotorCmd = {
  left: number;
  right: number;
};

type Experience = {
  s: SensorSnapshot;
  a: MotorCmd;
  r: -1 | 0 | 1;
  t: number;
};

const STORAGE_KEY = "kei_learn_db2";
const INPUT_DIM = 10;
const HIDDEN_DIM = 12;
const OUTPUT_DIM = 2;
const LR = 0.05;
const MAX_EXP = 200;

// Neural network weights
type Network = {
  w1: number[][];  // [INPUT_DIM][HIDDEN_DIM]
  b1: number[];    // [HIDDEN_DIM]
  w2: number[][];  // [HIDDEN_DIM][OUTPUT_DIM]
  b2: number[];    // [OUTPUT_DIM]
};

function rand(): number {
  return Math.random() * 2 - 1;
}

function createNetwork(): Network {
  const w1 = Array.from({ length: INPUT_DIM }, () => Array.from({ length: HIDDEN_DIM }, rand));
  const b1 = Array.from({ length: HIDDEN_DIM }, rand);
  const w2 = Array.from({ length: HIDDEN_DIM }, () => Array.from({ length: OUTPUT_DIM }, rand));
  const b2 = Array.from({ length: OUTPUT_DIM }, rand);
  return { w1, b1, w2, b2 };
}

function normalize(s: SensorSnapshot, maxRange = 400): number[] {
  const norm = (v: number) => v < 0 ? 1 : Math.min(v / maxRange, 1);
  return [
    norm(s.farLeft),
    norm(s.midLeft),
    norm(s.nearLeft),
    norm(s.front),
    norm(s.nearRight),
    norm(s.midRight),
    norm(s.farRight),
    s.gyro / 2, // normalize gyro to roughly [-0.5, 0.5]
    s.wallLeft ? 1 : 0,
    s.wallRight ? 1 : 0,
  ];
}

// Forward pass. Returns { hidden: tanh output, output: raw output }
function forward(net: Network, x: number[]): { hidden: number[]; output: number[] } {
  // hidden = tanh(x * w1 + b1)
  const hidden: number[] = [];
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let sum = net.b1[j];
    for (let i = 0; i < INPUT_DIM; i++) sum += x[i] * net.w1[i][j];
    hidden.push(Math.tanh(sum));
  }
  // output = hidden * w2 + b2  (linear)
  const output: number[] = [];
  for (let j = 0; j < OUTPUT_DIM; j++) {
    let sum = net.b2[j];
    for (let i = 0; i < HIDDEN_DIM; i++) sum += hidden[i] * net.w2[i][j];
    output.push(sum);
  }
  return { hidden, output };
}

function trainOnce(net: Network, experiences: Experience[], weight: (e: Experience) => number): number {
  // Accumulate gradients
  const dw1 = Array.from({ length: INPUT_DIM }, () => new Float64Array(HIDDEN_DIM));
  const db1 = new Float64Array(HIDDEN_DIM);
  const dw2 = Array.from({ length: HIDDEN_DIM }, () => new Float64Array(OUTPUT_DIM));
  const db2 = new Float64Array(OUTPUT_DIM);
  let totalLoss = 0;
  let totalW = 0;

  for (const exp of experiences) {
    const w = weight(exp);
    if (w === 0) continue;
    totalW += w;

    const x = normalize(exp.s);
    const { hidden, output } = forward(net, x);
    const target = [exp.a.left / 255, exp.a.right / 255];

    // MSE loss
    const dLdy = [
      (output[0] - target[0]) * w,
      (output[1] - target[1]) * w,
    ];
    totalLoss += (dLdy[0] ** 2 + dLdy[1] ** 2) / 2;

    // Output layer: dL/dw2 = hidden^T * dL/dy
    for (let i = 0; i < HIDDEN_DIM; i++) {
      for (let j = 0; j < OUTPUT_DIM; j++) {
        dw2[i][j] += hidden[i] * dLdy[j];
      }
    }
    for (let j = 0; j < OUTPUT_DIM; j++) db2[j] += dLdy[j];

    // Hidden layer: dL/dh = dL/dy * w2^T
    const dLdh = new Float64Array(HIDDEN_DIM);
    for (let i = 0; i < HIDDEN_DIM; i++) {
      for (let j = 0; j < OUTPUT_DIM; j++) dLdh[i] += dLdy[j] * net.w2[i][j];
    }

    // Hidden activation: tanh derivative = 1 - tanh^2
    for (let i = 0; i < HIDDEN_DIM; i++) {
      const t = hidden[i];
      dLdh[i] *= (1 - t * t);
    }

    // Input layer: dL/dw1 = x^T * dL/dh
    for (let i = 0; i < INPUT_DIM; i++) {
      for (let j = 0; j < HIDDEN_DIM; j++) {
        dw1[i][j] += x[i] * dLdh[j];
      }
    }
    for (let j = 0; j < HIDDEN_DIM; j++) db1[j] += dLdh[j];
  }

  if (totalW === 0) return 0;

  // Apply gradient descent
  const scale = LR / Math.max(1, totalW);
  for (let i = 0; i < INPUT_DIM; i++)
    for (let j = 0; j < HIDDEN_DIM; j++)
      net.w1[i][j] -= dw1[i][j] * scale;
  for (let j = 0; j < HIDDEN_DIM; j++) net.b1[j] -= db1[j] * scale;
  for (let i = 0; i < HIDDEN_DIM; i++)
    for (let j = 0; j < OUTPUT_DIM; j++)
      net.w2[i][j] -= dw2[i][j] * scale;
  for (let j = 0; j < OUTPUT_DIM; j++) net.b2[j] -= db2[j] * scale;

  return totalLoss / Math.max(1, totalW);
}

export class LearningDB {
  private exps: Experience[] = [];
  private net: Network;

  constructor() {
    this.net = createNetwork();
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        this.exps = data.exps || [];
        if (data.net) {
          this.net = data.net;
        } else {
          this.net = createNetwork();
        }
      }
    } catch {
      this.net = createNetwork();
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ exps: this.exps, net: this.net }));
    } catch {}
  }

  record(s: SensorSnapshot, a: MotorCmd, r: -1 | 0 | 1 = 0) {
    this.exps.push({ s, a, r, t: Date.now() });
    if (this.exps.length > MAX_EXP) this.exps.splice(0, this.exps.length - MAX_EXP);
    this.train();
    this.save();
  }

  // Run training epochs
  train(epochs = 8) {
    if (this.exps.length < 3) return;
    // Sample recent 100 for responsiveness
    const batch = this.exps.length > 100 ? this.exps.slice(-100) : this.exps;
    const rated = batch.filter(e => e.r !== 0);
    const pool = rated.length >= 5 ? rated : batch;
    for (let e = 0; e < epochs; e++) {
      trainOnce(this.net, pool, exp => {
        if (exp.r === 0) return 0.3;
        if (exp.r === 1) return 1.0;
        return 0.5; // negative — still learn but lower weight
      });
    }
  }

  rateRecent(lastN: number, rating: -1 | 1) {
    let count = 0;
    for (let i = this.exps.length - 1; i >= 0 && count < lastN; i--, count++) {
      this.exps[i].r = rating;
    }
    this.train();
    this.save();
  }

  forget() {
    this.exps = [];
    this.net = createNetwork();
    this.save();
  }

  get size() { return this.exps.length; }
  get ratedCount() { return this.exps.filter(e => e.r !== 0).length; }

  // Predict motor command from sensor snapshot
  predict(s: SensorSnapshot): MotorCmd | null {
    if (this.exps.length < 3) return null;
    const x = normalize(s);
    const { output } = forward(this.net, x);
    return {
      left: Math.round(output[0] * 255),
      right: Math.round(output[1] * 255),
    };
  }
}
