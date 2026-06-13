const INPUT_DIM = 5;
const HIDDEN_DIM = 8;
const OUTPUT_DIM = 2;

export type Genome = number[];

export function createGenome(): Genome {
  const n = INPUT_DIM * HIDDEN_DIM + HIDDEN_DIM + HIDDEN_DIM * OUTPUT_DIM + OUTPUT_DIM;
  return Array.from({ length: n }, () => Math.random() * 2 - 1);
}

export function forward(genome: Genome, inputs: number[]): [number, number] {
  const w1End = INPUT_DIM * HIDDEN_DIM;
  const b1End = w1End + HIDDEN_DIM;
  const w2End = b1End + HIDDEN_DIM * OUTPUT_DIM;

  // Hidden layer
  const hidden: number[] = [];
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let sum = genome[w1End + j];
    for (let i = 0; i < INPUT_DIM; i++) {
      sum += inputs[i] * genome[i * HIDDEN_DIM + j];
    }
    hidden.push(Math.tanh(sum));
  }

  // Output layer
  const output: number[] = [];
  for (let j = 0; j < OUTPUT_DIM; j++) {
    let sum = genome[b1End + HIDDEN_DIM * OUTPUT_DIM + j];
    for (let i = 0; i < HIDDEN_DIM; i++) {
      sum += hidden[i] * genome[b1End + i * OUTPUT_DIM + j];
    }
    output.push(Math.tanh(sum));
  }

  return [output[0], output[1]];
}

export interface TrialResult {
  genome: Genome;
  fitness: number;
  steps: number;
}

export function crossover(a: Genome, b: Genome): Genome {
  return a.map((_, i) => Math.random() < 0.5 ? a[i] : b[i]);
}

export function mutate(genome: Genome, rate = 0.1, std = 0.15): Genome {
  return genome.map(g => Math.random() < rate ? g + (Math.random() * 2 - 1) * std : g);
}

export function evolvePopulation(population: TrialResult[], popSize: number): Genome[] {
  population.sort((a, b) => b.fitness - a.fitness);

  const next: Genome[] = [];

  // Elitism: keep top 2
  next.push(population[0].genome);
  next.push(population[1].genome);

  // Fill rest by crossover + mutation
  while (next.length < popSize) {
    const a = selectParent(population);
    const b = selectParent(population);
    let child = crossover(a.genome, b.genome);
    child = mutate(child);
    next.push(child);
  }

  return next;
}

function selectParent(population: TrialResult[]): TrialResult {
  // Tournament selection (size 3)
  const i = Math.floor(Math.random() * population.length);
  const j = Math.floor(Math.random() * population.length);
  const k = Math.floor(Math.random() * population.length);
  const a = population[i];
  const b = population[j];
  const c = population[k];
  if (a.fitness >= b.fitness && a.fitness >= c.fitness) return a;
  if (b.fitness >= a.fitness && b.fitness >= c.fitness) return b;
  return c;
}

export { INPUT_DIM, HIDDEN_DIM, OUTPUT_DIM };
