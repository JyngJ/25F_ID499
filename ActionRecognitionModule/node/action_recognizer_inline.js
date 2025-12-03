import path from "path";
import { spawn } from "child_process";
import { performance } from "perf_hooks";
import dotenv from "dotenv";
import five from "johnny-five";

const { Board, Sensor, IMU } = five;

const FEATURE_NAMES = ["pressure_delta", "ax", "ay", "az", "gx", "gy", "gz"];
const DEFAULT_PYTHON = "python";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSensors(conditionFn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!conditionFn()) {
    if (Date.now() > deadline) {
      throw new Error("Sensors did not report data in time. Check wiring/port and try again.");
    }
    await wait(50);
  }
}

async function calibrateBaselines(readPressure, readAccel, readGyro, samples, sampleDelayMs) {
  console.log(`\nCalibrating pressure + IMU baselines with ${samples} samples...`);
  let pressureSum = 0;
  let pressureCount = 0;
  let accelSum = 0;
  let accelCount = 0;
  let gyroSum = 0;
  let gyroCount = 0;

  for (let i = 0; i < samples; i += 1) {
    const p = readPressure();
    if (p != null) {
      pressureSum += p;
      pressureCount += 1;
    }
    const a = readAccel();
    if (a) {
      const accelMag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      accelSum += accelMag;
      accelCount += 1;
    }
    const g = readGyro();
    if (g) {
      const gyroMag = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
      gyroSum += gyroMag;
      gyroCount += 1;
    }
    await wait(sampleDelayMs);
  }

  const pressureBaseline = pressureCount ? pressureSum / pressureCount : 0;
  const accelBaseline = accelCount ? accelSum / accelCount : 0;
  const gyroBaseline = gyroCount ? gyroSum / gyroCount : 0;

  console.log(
    `Baselines -> pressure=${pressureBaseline.toFixed(2)}, |accel|=${accelBaseline.toFixed(
      3,
    )}, |gyro|=${gyroBaseline.toFixed(3)}`,
  );
  return { pressureBaseline, accelBaseline, gyroBaseline };
}

function computeActivityScores(frames, opts) {
  const { weightPressure, weightAccel, weightGyro, baselines } = opts;
  const basePressure = Math.max(1e-6, Math.abs(baselines.pressure));
  const baseAccel = Math.max(1e-6, baselines.accel);
  const baseGyro = Math.max(1e-6, baselines.gyro);

  const scores = [];
  for (const frame of frames) {
    const [dp, ax, ay, az, gx, gy, gz] = frame;
    const accelMag = Math.sqrt(ax * ax + ay * ay + az * az);
    const gyroMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    const pressureTerm = Math.abs(dp) / basePressure;
    const accelTerm = Math.abs(accelMag - baseAccel) / baseAccel;
    const gyroTerm = Math.abs(gyroMag - baseGyro) / baseGyro;
    const raw = weightPressure * pressureTerm + weightAccel * accelTerm + weightGyro * gyroTerm;
    scores.push(raw);
  }
  return scores;
}

function extractBlocks(frames, scores, opts) {
  const { high, low, minFrames, padFrames, gapMerge } = opts;
  const blocks = [];
  let active = false;
  let start = 0;
  scores.forEach((score, idx) => {
    if (!active && score >= high) {
      active = true;
      start = idx;
    } else if (active && score <= low) {
      blocks.push([start, idx]);
      active = false;
    }
  });
  if (active) {
    blocks.push([start, scores.length - 1]);
  }

  const padded = blocks
    .map(([s, e]) => [Math.max(0, s - padFrames), Math.min(frames.length - 1, e + padFrames)])
    .filter(([s, e]) => e - s + 1 >= minFrames);

  const merged = [];
  for (const seg of padded) {
    if (!merged.length) {
      merged.push(seg);
      continue;
    }
    const last = merged[merged.length - 1];
    if (seg[0] - last[1] <= gapMerge) {
      last[1] = Math.max(last[1], seg[1]);
    } else {
      merged.push(seg);
    }
  }
  return merged;
}

function runPythonInference({
  pythonCmd,
  scriptPath,
  modelPath,
  configPath,
  payload,
  lowPassWindow,
  autoIdleOptions,
  pythonDevice,
}) {
  return new Promise((resolve, reject) => {
    const args = [scriptPath, "--model", modelPath, "--config", configPath, "--device", pythonDevice];
    if (lowPassWindow && Number.isInteger(lowPassWindow) && lowPassWindow > 1) {
      args.push("--low-pass-window", String(lowPassWindow));
    }
    if (autoIdleOptions?.enabled) {
      args.push("--auto-idle", "--idle-label", autoIdleOptions.label);
      args.push("--idle-pressure-std", String(autoIdleOptions.pressureStd));
      args.push("--idle-pressure-mean", String(autoIdleOptions.pressureMean));
      args.push("--idle-accel-std", String(autoIdleOptions.accelStd));
      args.push("--idle-gyro-std", String(autoIdleOptions.gyroStd));
    }
    const proc = spawn(pythonCmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Python process exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

export class InlineActionRecognizer {
  constructor(options = {}) {
    const moduleRoot = options.moduleRoot ?? path.resolve(process.cwd(), "ActionRecognitionModule");
    this.options = {
      moduleRoot,
      sampleMs: 20,
      pressurePin: "A0",
      imuController: "MPU6050",
      baselineSamples: 200,
      modelPath: path.resolve(moduleRoot, "models", "sequence_classifier_20251201_more.pt"),
      configPath: path.resolve(moduleRoot, "models", "sequence_config_20251201_more.json"),
      inferScript: path.resolve(moduleRoot, "python", "sequence_infer.py"),
      pythonCmd: DEFAULT_PYTHON,
      pythonDevice: "cpu",
      lowPassWindow: 1,
      streamSensors: false,
      activityHigh: 100,
      activityLow: 10,
      activityMinFrames: 5,
      activityPadFrames: 0,
      activityGapMerge: 100,
      activityWeightPressure: 0.000001,
      activityWeightAccel: 150.0,
      activityWeightGyro: 500.0,
      autoIdle: {
        enabled: false,
        label: "idle",
        pressureStd: 20,
        pressureMean: 40,
        accelStd: 0.1,
        gyroStd: 5.0,
      },
      onSensorFrame: null,
      quiet: true,
      ...options,
    };

    dotenv.config({ path: path.join(moduleRoot, ".env") });

    this.latestPressure = null;
    this.latestAccel = null;
    this.latestGyro = null;
    this.frames = [];
    this.capturing = false;
    this.sensorLogTick = 0;
    this.baselines = { pressureBaseline: 0, accelBaseline: 0, gyroBaseline: 0 };
    this.ready = false;
    this.pollTimer = null;

    this.readyPromise = this.initializeBoard();
    process.on("exit", () => this.dispose());
    process.on("SIGINT", () => {
      this.dispose();
      process.exit(0);
    });
  }

  async initializeBoard() {
    const boardOptions = { repl: false };
    const serialPort = this.options.port?.trim() || process.env.SERIAL_PORT?.trim();
    if (serialPort) {
      boardOptions.port = serialPort;
    }
    this.board = new Board(boardOptions);

    return new Promise((resolve, reject) => {
      this.board.on("error", (err) => reject(err));
      this.board.on("ready", async () => {
        console.log("Johnny-Five board ready. Initializing sensors...");
        try {
          this.pressureSensor = new Sensor({ pin: this.options.pressurePin, freq: this.options.sampleMs });
          this.imu = new IMU({ controller: this.options.imuController, freq: this.options.sampleMs });

          this.pressureSensor.on("change", () => {
            this.latestPressure = this.pressureSensor.value;
          });
          this.imu.on("change", () => {
            this.latestAccel = {
              x: this.imu.accelerometer.x,
              y: this.imu.accelerometer.y,
              z: this.imu.accelerometer.z,
            };
            this.latestGyro = {
              x: this.imu.gyro.x,
              y: this.imu.gyro.y,
              z: this.imu.gyro.z,
            };
          });

          await waitForSensors(
            () => this.latestPressure !== null && this.latestAccel !== null && this.latestGyro !== null,
          );
          this.baselines = await calibrateBaselines(
            () => this.latestPressure,
            () => this.latestAccel,
            () => this.latestGyro,
            this.options.baselineSamples,
            this.options.sampleMs,
          );

          this.pollTimer = setInterval(() => this.captureFrame(), this.options.sampleMs);
          this.ready = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  captureFrame() {
    if (!this.capturing) return;
    if (this.latestPressure == null || !this.latestAccel || !this.latestGyro) return;

    const frame = [
      this.latestPressure - this.baselines.pressureBaseline,
      this.latestAccel.x,
      this.latestAccel.y,
      this.latestAccel.z,
      this.latestGyro.x,
      this.latestGyro.y,
      this.latestGyro.z,
    ];

    this.frames.push(frame);
    this.sensorLogTick += 1;

    if (typeof this.options.onSensorFrame === "function" && this.options.streamSensors) {
      if (this.sensorLogTick % Math.max(1, Math.floor(200 / this.options.sampleMs)) === 0) {
        this.options.onSensorFrame({
          dp: frame[0],
          ax: frame[1],
          ay: frame[2],
          az: frame[3],
          gx: frame[4],
          gy: frame[5],
          gz: frame[6],
        });
      }
    }
  }

  async ensureReady() {
    if (!this.ready) {
      await this.readyPromise;
    }
  }

  async startTurn() {
    await this.ensureReady();
    this.frames = [];
    this.capturing = true;
    this.sensorLogTick = 0;
  }

  async stopAndGetAction() {
    await this.ensureReady();
    this.capturing = false;

    if (!this.frames.length) {
      return { label: "idle", probability: 0, raw: "no_frames" };
    }

    const basePayload = {
      label: "unknown",
      sample_ms: this.options.sampleMs,
      feature_names: FEATURE_NAMES,
      features: this.frames,
    };

    let blocks = [[0, this.frames.length - 1]];
    if (!this.options.disableActivitySegmentation && this.frames.length > 1) {
      const scores = computeActivityScores(this.frames, {
        weightPressure: this.options.activityWeightPressure,
        weightAccel: this.options.activityWeightAccel,
        weightGyro: this.options.activityWeightGyro,
        baselines: {
          pressure: 0,
          accel: this.baselines.accelBaseline,
          gyro: this.baselines.gyroBaseline,
        },
      });
      blocks = extractBlocks(this.frames, scores, {
        high: this.options.activityHigh,
        low: this.options.activityLow,
        minFrames: this.options.activityMinFrames,
        padFrames: this.options.activityPadFrames,
        gapMerge: this.options.activityGapMerge,
      });
      if (!blocks.length) {
        return { label: this.options.autoIdle?.label ?? "idle", probability: 1, raw: "auto_idle" };
      }
    }

    let selected = blocks[0];
    let longestLen = -1;
    blocks.forEach((block) => {
      const len = block[1] - block[0] + 1;
      if (len > longestLen) {
        longestLen = len;
        selected = block;
      }
    });
    const [start, end] = selected;
    const segment = this.frames.slice(start, end + 1);
    const payload = { ...basePayload, features: segment };

    const autoIdleOptions = this.options.autoIdle?.enabled
      ? {
          enabled: true,
          label: this.options.autoIdle.label,
          pressureStd: this.options.autoIdle.pressureStd,
          pressureMean: this.options.autoIdle.pressureMean,
          accelStd: this.options.autoIdle.accelStd,
          gyroStd: this.options.autoIdle.gyroStd,
        }
      : { enabled: false };

    const inferenceStart = performance.now();
    const output = await runPythonInference({
      pythonCmd: this.options.pythonCmd,
      scriptPath: this.options.inferScript,
      modelPath: this.options.modelPath,
      configPath: this.options.configPath,
      payload,
      lowPassWindow: this.options.lowPassWindow,
      autoIdleOptions,
      pythonDevice: this.options.pythonDevice,
    });
    const inferenceElapsed = performance.now() - inferenceStart;

    try {
      const parsed = JSON.parse(output);
      return {
        label: parsed.label,
        probability: parsed.probability,
        raw: `${parsed.label} (${parsed.probability}) | ${inferenceElapsed.toFixed(1)}ms`,
      };
    } catch (err) {
      return { label: "unknown", probability: 0, raw: output };
    }
  }

  dispose() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    try {
      this.board?.io?.reset?.();
    } catch (_) {
      /* noop */
    }
  }
}
