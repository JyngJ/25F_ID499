#!/usr/bin/env node

/**
 * Real-time Johnny-Five inference loop for the PillowMate Action Recognition Module.
 *
 * Loads models/model_params.json (exported by python/train_model.py), samples
 * the board via StandardFirmata, and prints predicted labels with confidence.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import five from "johnny-five";
import { Command } from "commander";

const { Board, Sensor, IMU } = five;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_MODEL_PATH = path.resolve(MODULE_ROOT, "models", "model_params.json");

const program = new Command();
program
  .description("Run the PillowMate classifier directly from a host machine via Johnny-Five.")
  .option("--model <path>", "Path to model_params.json", DEFAULT_MODEL_PATH)
  .option("--pressure-pin <pin>", "Analog pin connected to the Velostat sensor", "A0")
  .option("--imu-controller <name>", "Johnny-Five IMU controller", "MPU6050")
  .option("--sample-ms <ms>", "Sampling period for raw readings", (value) => parseInt(value, 10), 20)
  .option("--window-size <samples>", "Number of samples averaged per prediction", (value) => parseInt(value, 10), 8)
  .option(
    "--prediction-interval <ms>",
    "How often to emit a classification",
    (value) => parseInt(value, 10),
    250,
  )
  .option("--baseline-samples <count>", "Samples to estimate the resting pressure baseline", (value) => parseInt(value, 10), 200)
  .option("--min-prob <value>", "Only log predictions above this probability", (value) => parseFloat(value), 0.5)
  .option("--verbose", "Print the averaged feature vector before each prediction", false);

const options = program.parse(process.argv).opts();

function resolvePath(target) {
  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

function loadModel(modelPath) {
  const resolved = resolvePath(modelPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`모델 파일을 찾을 수 없습니다: ${resolved}. python/train_model.py를 먼저 실행하세요.`);
  }
  const payload = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const requiredFields = ["labels", "weights", "bias", "feature_mean", "feature_scale"];
  for (const field of requiredFields) {
    if (!payload[field]) {
      throw new Error(`모델 파일에 ${field} 필드가 없습니다.`);
    }
  }
  return payload;
}

function standardize(features, mean, scale) {
  return features.map((value, idx) => {
    const safeScale = scale[idx] === 0 ? 1 : scale[idx];
    return (value - mean[idx]) / safeScale;
  });
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((logit) => Math.exp(logit - max));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((value) => value / sum);
}

function predict(features, model) {
  const standardized = standardize(features, model.feature_mean, model.feature_scale);
  const logits = model.weights.map((row, classIdx) => {
    let logit = model.bias[classIdx];
    row.forEach((weight, featIdx) => {
      logit += weight * standardized[featIdx];
    });
    return logit;
  });
  const probabilities = softmax(logits);
  let bestIndex = 0;
  for (let i = 1; i < probabilities.length; i += 1) {
    if (probabilities[i] > probabilities[bestIndex]) {
      bestIndex = i;
    }
  }
  return {
    label: model.labels[bestIndex],
    index: bestIndex,
    probability: probabilities[bestIndex],
    probabilities,
  };
}

function averageSamples(samples) {
  if (!samples.length) {
    return [];
  }
  const sums = samples[0].map(() => 0);
  samples.forEach((sample) => {
    sample.forEach((value, idx) => {
      sums[idx] += value;
    });
  });
  return sums.map((value) => value / samples.length);
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSensors(conditionFn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!conditionFn()) {
    if (Date.now() > deadline) {
      throw new Error("센서에서 값을 읽어오지 못했습니다. 연결 상태를 확인하세요.");
    }
    await delay(50);
  }
}

async function calibrateBaseline(readPressure, samples, sampleDelayMs) {
  console.log(`\n압력 기준을 잡는 중입니다 (${samples} 샘플). 베개를 건드리지 말고 기다려 주세요.`);
  let collected = 0;
  let sum = 0;
  while (collected < samples) {
    const value = readPressure();
    if (value != null) {
      sum += value;
      collected += 1;
    }
    await delay(sampleDelayMs);
  }
  const baseline = sum / samples;
  console.log(`기준 압력: ${baseline.toFixed(2)}`);
  return baseline;
}

const model = loadModel(options.model);
const featureCount = model.feature_mean.length;

const board = new Board({ repl: false });
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    board.io?.reset?.();
  } catch (_) {
    /* noop */
  }
  process.exit(code);
}

process.on("SIGINT", () => {
  console.log("\n종료 신호를 받았습니다. 연결을 정리합니다.");
  shutdown(0);
});

board.on("error", (err) => {
  console.error("보드 오류:", err);
  shutdown(1);
});

board.on("ready", async () => {
  console.log("Johnny-Five 보드 연결 완료. 센서 데이터를 기다리는 중입니다...");
  const pressureSensor = new Sensor({
    pin: options.pressurePin,
    freq: options.sampleMs,
  });
  const imu = new IMU({
    controller: options.imuController,
    freq: options.sampleMs,
  });

  let latestPressure = null;
  let latestAccel = null;
  let latestGyro = null;

  pressureSensor.on("change", function onPressure() {
    latestPressure = this.value;
  });
  imu.on("change", function onImu() {
    latestAccel = {
      x: this.accelerometer.x,
      y: this.accelerometer.y,
      z: this.accelerometer.z,
    };
    latestGyro = {
      x: this.gyro.x,
      y: this.gyro.y,
      z: this.gyro.z,
    };
  });

  try {
    await waitForSensors(() => latestPressure !== null && latestAccel !== null && latestGyro !== null);
    const baseline = await calibrateBaseline(() => latestPressure, options.baselineSamples, options.sampleMs);
    console.log("실시간 추론을 시작합니다. 상호작용을 수행해 주세요.");

    const window = [];
    let lastPrediction = null;

    board.loop(options.sampleMs, () => {
      if (latestPressure == null || latestAccel == null || latestGyro == null) {
        return;
      }
      const vector = [
        latestPressure - baseline,
        latestAccel.x,
        latestAccel.y,
        latestAccel.z,
        latestGyro.x,
        latestGyro.y,
        latestGyro.z,
      ];
      if (vector.length !== featureCount) {
        return;
      }
      window.push(vector);
      if (window.length > options.windowSize) {
        window.shift();
      }
    });

    board.loop(options.predictionInterval, () => {
      if (window.length < options.windowSize) {
        return;
      }
      const averaged = averageSamples(window);
      const prediction = predict(averaged, model);
      if (options.verbose) {
        console.log(
          `평균 특징값: ${averaged.map((value) => value.toFixed(3)).join(", ")}`,
        );
      }
      if (
        prediction.probability >= options.minProb &&
        (!lastPrediction || prediction.index !== lastPrediction.index || prediction.probability > lastPrediction.probability + 0.05)
      ) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${prediction.label} (${(prediction.probability * 100).toFixed(1)}%)`);
        lastPrediction = prediction;
      }
    });
  } catch (err) {
    console.error("실시간 추론 중 오류:", err);
    shutdown(1);
  }
});
