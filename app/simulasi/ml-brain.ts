import * as tf from "@tensorflow/tfjs";

const INPUT_DIM = 14;   // 14 sector distances
const AUX_DIM = 2;      // currentSpeed, headingError
const OUTPUT_DIM = 2;   // leftMotor, rightMotor (normalized -1..1)

let model: tf.LayersModel | null = null;
let data: { xs: number[][]; ys: number[][] } = { xs: [], ys: [] };
let training = false;

export function dataCount() { return data.xs.length; }

export function recordSample(
  sectors: number[],
  speed: number,
  headingErr: number,
  lMotor: number,
  rMotor: number,
) {
  if (data.xs.length >= 5000) return; // cap
  const input = [
    ...sectors.map(d => Math.min(d / 400, 1)),
    Math.abs(speed) / 255,
    Math.atan(Math.tan(headingErr)) / Math.PI,
  ];
  data.xs.push(input);
  data.ys.push([lMotor / 255, rMotor / 255]);
}

export function clearData() { data = { xs: [], ys: [] }; }

export function saveData() {
  try {
    localStorage.setItem("kei_ml_data", JSON.stringify(data));
  } catch {}
}

export function loadData() {
  try {
    const raw = localStorage.getItem("kei_ml_data");
    if (raw) data = JSON.parse(raw);
  } catch {}
}

function buildModel() {
  const m = tf.sequential();
  m.add(tf.layers.dense({ units: 16, activation: "relu", inputShape: [INPUT_DIM + AUX_DIM] }));
  m.add(tf.layers.dense({ units: 12, activation: "relu" }));
  m.add(tf.layers.dense({ units: OUTPUT_DIM, activation: "tanh" }));
  m.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });
  return m;
}

export async function trainModel(
  onEpoch?: (epoch: number, loss: number) => void,
): Promise<number> {
  if (data.xs.length < 10) throw new Error("Data terlalu sedikit");
  if (training) throw new Error("Sedang training");
  training = true;

  try {
    if (!model) model = buildModel();
    const xs = tf.tensor2d(data.xs);
    const ys = tf.tensor2d(data.ys);

    let finalLoss = 0;
    await model.fit(xs, ys, {
      epochs: 50,
      batchSize: Math.min(32, data.xs.length),
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          finalLoss = logs!.loss;
          onEpoch?.(epoch, finalLoss);
        },
      },
    });

    xs.dispose();
    ys.dispose();

    const weights = model.getWeights().map(w => w.arraySync());
    localStorage.setItem("kei_ml_weights", JSON.stringify(weights));

    return finalLoss;
  } finally {
    training = false;
  }
}

export function loadWeights() {
  try {
    const raw = localStorage.getItem("kei_ml_weights");
    if (!raw) return false;
    const weights = JSON.parse(raw) as number[][][];
    if (!model) model = buildModel();
    model.setWeights(weights.map(w => tf.tensor(w)));
    return true;
  } catch { return false; }
}

export function predict(
  sectors: number[],
  speed: number,
  headingErr: number,
): [number, number] | null {
  if (!model) return null;
  const input = [
    ...sectors.map(d => Math.min(d / 400, 1)),
    Math.abs(speed) / 255,
    Math.atan(Math.tan(headingErr)) / Math.PI,
  ];
  const t = tf.tensor2d([input]);
  const out = model.predict(t) as tf.Tensor;
  const [l, r] = Array.from(out.dataSync());
  t.dispose();
  out.dispose();
  return [l * 255, r * 255];
}
