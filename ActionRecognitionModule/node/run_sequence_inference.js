#!/usr/bin/env node

/**
 * Collects a variable-length sequence during a user turn and classifies it
 * using the PyTorch GRU model (python/sequence_infer.py).
 *
 * Adds activity segmentation:
 * - Frame-wise activity score (pressure + accel + gyro)
 * - Hysteresis high/low thresholds to turn activity on/off
 * - Padding, short-burst drop, gap merge
 * - Each detected block is sent separately to the Python model; idle-only input is skipped.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";
import dotenv from "dotenv";
import five from "johnny-five";
import { Command } from "commander";

const { Board, Sensor, IMU } = five;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_PYTHON = "python";
const FEATURE_NAMES = ["pressure_delta", "ax", "ay", "az", "gx", "gy", "gz"];

dotenv.config({ path: path.join(MODULE_ROOT, ".env") });

const program = new Command();
program
  .description("Run sequence-level inference for PillowMate activity recognition.")
  .option("--pressure-pin <pin>", "Analog pin used for the pressure sensor", "A0")
  .option("--imu-controller <name>", "Johnny-Five IMU controller name", "MPU6050")
  .option("--sample-ms <ms>", "Sampling interval (ms)", (value) => parseInt(value, 10), 20)
  .option(
    "--sample-log-every <count>",
    "How many frames between progress logs while recording (default: 10)",
    (value) => parseInt(value, 10),
    10,
  )
  .option("--baseline-samples <count>", "Samples for pressure baseline", (value) => parseInt(value, 10), 200)
  .option("--python <cmd>", "Python interpreter to run sequence_infer.py", DEFAULT_PYTHON)
  .option(
    "--infer-script <path>",
    "Path to python/sequence_infer.py",
    path.resolve(MODULE_ROOT, "python", "sequence_infer.py"),
  )
  .option(
    "--model <path>",
    "Path to sequence_classifier.pt",
    path.resolve(MODULE_ROOT, "models", "251210pillowmate_full_many.pt"),
  )
  .option(
    "--config <path>",
    "Path to sequence_config.json",
    path.resolve(MODULE_ROOT, "models", "251210pillowmate_full_many.json"),
  )
  .option("--python-device <device>", "Device passed to sequence_infer.py (cpu/cuda/mps)", "cpu")
  .option(
    "--low-pass-window <samples>",
    "Moving average window to apply before inference",
    (value) => parseInt(value, 10),
    1,
  )
  .option("--auto-idle", "Enable heuristic idle detection", false)
  .option("--idle-label <name>", "Label name to emit when auto idle triggers", "idle")
  .option("--idle-pressure-std <value>", "Pressure std threshold for auto idle", (value) => parseFloat(value), 20)
  .option("--idle-pressure-mean <value>", "Abs mean pressure threshold for auto idle", (value) => parseFloat(value), 40)
  .option("--idle-accel-std <value>", "Accel std threshold for auto idle", (value) => parseFloat(value), 0.1)
  .option("--idle-gyro-std <value>", "Gyro std threshold for auto idle", (value) => parseFloat(value), 5.0)
  .option("--activity-high <value>", "High threshold for activity on/off", (value) => parseFloat(value), 100)
  .option("--activity-low <value>", "Low threshold for activity on/off", (value) => parseFloat(value), 10)
  .option("--activity-min-frames <count>", "Minimum frames to keep an activity block", (value) => parseInt(value, 10), 5)
  .option("--activity-pad-frames <count>", "Frames of context to pad around each block", (value) => parseInt(value, 10), 0)
  .option("--activity-gap-merge <count>", "Merge blocks if idle gap <= this", (value) => parseInt(value, 10), 100)
  .option("--activity-weight-pressure <value>", "Weight for pressure in activity score", (value) => parseFloat(value), 0.000002)
  .option("--activity-weight-accel <value>", "Weight for accel magnitude in activity score", (value) => parseFloat(value), 150.0)
  .option("--activity-weight-gyro <value>", "Weight for gyro magnitude in activity score", (value) => parseFloat(value), 500.0)
  .option("--disable-activity-segmentation", "Send whole sequence without idle trimming", false)
  .option("--activity-plot", "Plot activity score + thresholds + blocks with nodeplotlib", false)
  .option("--port <path>", "Serial port override (defaults to SERIAL_PORT/.env)")
  .option("--quiet", "Suppress interim console logs", false)
  .option("--stream-sensors", "Continuously print sensor readings", false);

const options = program.parse(process.argv).opts();
const sampleLogEvery = Math.max(1, Number.isFinite(options.sampleLogEvery) ? options.sampleLogEvery : 1);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function waitForLine(prompt) {
  process.stdout.write(`${prompt}\n`);
  return new Promise((resolve) => rl.once("line", resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSensors(conditionFn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!conditionFn()) {
    if (Date.now() > deadline) {
      throw new Error("Sensors did not report data in time. Check wiring/port and try again.");
    }
    await delay(50);
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
    await delay(sampleDelayMs);
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
    const proc = spawn(pythonCmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      process.stderr.write(chunk); // show Python stderr (e.g., auto-idle stats)
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

function computeActivityScores(frames, opts) {
  const { weightPressure, weightAccel, weightGyro, baselines, collectTerms } = opts;
  // Use calibrated baselines (pressure already baseline-subtracted).
  const basePressure = Math.max(1e-6, Math.abs(baselines.pressure));
  const baseAccel = Math.max(1e-6, baselines.accel);
  const baseGyro = Math.max(1e-6, baselines.gyro);

  const scores = [];
  const terms = collectTerms ? [] : null;
  for (const frame of frames) {
    const [dp, ax, ay, az, gx, gy, gz] = frame;
    const accelMag = Math.sqrt(ax * ax + ay * ay + az * az);
    const gyroMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    // Use only upward (positive) pressure deltas; ignore negative by clamping to 0.
    const pressureTerm = Math.max(0, dp) / basePressure;
    const accelTerm = Math.abs(accelMag - baseAccel) / baseAccel;
    const gyroTerm = Math.abs(gyroMag - baseGyro) / baseGyro;
    const raw = weightPressure * pressureTerm + weightAccel * accelTerm + weightGyro * gyroTerm;
    scores.push(raw);
    if (terms) {
      terms.push({ pressureTerm, accelTerm, gyroTerm });
    }
  }
  return { scores, terms };
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

  // Pad, drop short, and merge close blocks
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

async function plotActivity(scores, blocks, { high, low, terms }) {
  let plotting;
  try {
    plotting = await import("nodeplotlib");
  } catch (err) {
    console.warn("nodeplotlib is not installed. Run `npm install nodeplotlib` to enable plotting.");
    return;
  }
  const x = scores.map((_, idx) => idx);
  const traces = [
    { x, y: scores, type: "scatter", mode: "lines", name: "activity score"},
    {
      x: [0, scores.length - 1],
      y: [high, high],
      type: "scatter",
      mode: "lines",
      line: { dash: "dash", color: "green" },
      name: "high",
    },
    {
      x: [0, scores.length - 1],
      y: [low, low],
      type: "scatter",
      mode: "lines",
      line: { dash: "dash", color: "orange" },
      name: "low",
    },
  ];
  if (terms && terms.length === scores.length) {
    traces.push({
      x,
      y: terms.map((t) => t.pressureTerm * options.activityWeightPressure),
      type: "scatter",
      mode: "lines",
      line: { color: "blue", dash: "dot" },
      name: "pressure term",
    });
    traces.push({
      x,
      y: terms.map((t) => t.accelTerm * options.activityWeightAccel),
      type: "scatter",
      mode: "lines",
      line: { color: "red", dash: "dot" },
      name: "accel term",
    });
    traces.push({
      x,
      y: terms.map((t) => t.gyroTerm * options.activityWeightGyro),
      type: "scatter",
      mode: "lines",
      line: { color: "brown", dash: "dot" },
      name: "gyro term",
    });
  }
  const yMin = Math.min(...scores, low, high);
  const yMax = Math.max(...scores, low, high);
  const shapes = blocks.map(([s, e]) => ({
    type: "rect",
    xref: "x",
    yref: "y",
    x0: s,
    x1: e,
    y0: yMin,
    y1: yMax,
    fillcolor: "rgba(0,200,0,0.2)",
    line: { width: 0 },
  }));
  const layout = {
    title: "Activity score with thresholds/blocks",
    xaxis: { title: "frame" },
    yaxis: { title: "score" },
    shapes,
  };
  plotting.plot(traces, layout);
}

const SERIAL_PORT = options.port?.trim() || process.env.SERIAL_PORT?.trim();
const boardOptions = { repl: false };
if (SERIAL_PORT) {
  console.log(`Using serial port: ${SERIAL_PORT}`);
  boardOptions.port = SERIAL_PORT;
}

const board = new Board(boardOptions);
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  rl.close();
  try {
    board.io?.reset?.();
  } catch (_) {
    /* noop */
  }
  process.exit(code);
}

process.on("SIGINT", () => {
  console.log("\nStopping (Ctrl+C).");
  shutdown(0);
});

board.on("error", (err) => {
  console.error("Board error:", err);
  shutdown(1);
});

board.on("ready", async () => {
  console.log("Johnny-Five board ready. Initializing sensors...");
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
    const baselines = await calibrateBaselines(
      () => latestPressure,
      () => latestAccel,
      () => latestGyro,
      options.baselineSamples,
      options.sampleMs,
    );
    let sensorLogTick = 0;
    console.log("\nReady. Press Enter to start recording. (Ctrl+C to exit)");

    while (true) {
      await waitForLine("Press Enter to start a turn.");
      console.log("Recording... perform the interaction, then press Enter to stop.");

      let stopRequested = false;
      const frames = [];
      const stopPromise = waitForLine("Press Enter to stop recording.").then(() => {
        stopRequested = true;
      });

      while (!stopRequested) {
        if (latestPressure != null && latestAccel && latestGyro) {
          const frame = [
            latestPressure - baselines.pressureBaseline,
            latestAccel.x,
            latestAccel.y,
            latestAccel.z,
            latestGyro.x,
            latestGyro.y,
            latestGyro.z,
          ];
          frames.push(frame);
          if (!options.quiet && frames.length % sampleLogEvery === 0) {
            console.log(
              `${frames.length} samples collected... ΔP=${frame[0].toFixed(2)} ax=${frame[1].toFixed(2)} ay=${frame[2].toFixed(2)} az=${frame[3].toFixed(2)} gx=${frame[4].toFixed(2)} gy=${frame[5].toFixed(2)} gz=${frame[6].toFixed(2)}`,
            );
          }
          if (options.streamSensors) {
            sensorLogTick += 1;
            if (sensorLogTick % Math.max(1, Math.floor(200 / options.sampleMs)) === 0) {
              console.log(
                `[sensor] dp=${frame[0].toFixed(1)} ax=${frame[1].toFixed(2)} ay=${frame[2].toFixed(
                  2,
                )} az=${frame[3].toFixed(2)} gx=${frame[4].toFixed(2)} gy=${frame[5].toFixed(
                  2,
                )} gz=${frame[6].toFixed(2)}`,
              );
            }
          }
        }
        await delay(options.sampleMs);
      }
      await stopPromise;

      if (!frames.length) {
        console.warn("No frames captured. Try again.");
        continue;
      }

      const basePayload = {
        label: "unknown",
        sample_ms: options.sampleMs,
        feature_names: FEATURE_NAMES,
        features: frames,
      };

      let blocks = [[0, frames.length - 1]];
      if (!options.disableActivitySegmentation && frames.length > 1) {
        const { scores, terms } = computeActivityScores(frames, {
          weightPressure: options.activityWeightPressure,
          weightAccel: options.activityWeightAccel,
          weightGyro: options.activityWeightGyro,
          baselines: {
            pressure: 0, // already baseline-subtracted
            accel: baselines.accelBaseline,
            gyro: baselines.gyroBaseline,
          },
          collectTerms: options.activityPlot || Boolean(options.activityDebugLog),
        });
        blocks = extractBlocks(frames, scores, {
          high: options.activityHigh,
          low: options.activityLow,
          minFrames: options.activityMinFrames,
          padFrames: options.activityPadFrames,
          gapMerge: options.activityGapMerge,
        });
        if (options.activityPlot) {
          await plotActivity(scores, blocks, { high: options.activityHigh, low: options.activityLow, terms });
        }
        if (!blocks.length) {
          console.warn("No activity blocks detected (idle only). Skipping inference.");
          continue;
        }
        if (!options.quiet) {
          console.log(`Detected ${blocks.length} activity block(s).`);
        }
      }

      if (blocks.length) {
        // 규칙: idle 제외 활동 블록 중 가장 긴 한 개만 추론
        let longestIdx = 0;
        let longestLen = 0;
        blocks.forEach(([s, e], idx) => {
          const len = e - s + 1;
          if (len > longestLen) {
            longestLen = len;
            longestIdx = idx;
          }
        });
        const [start, end] = blocks[longestIdx];
        const segment = frames.slice(start, end + 1);
        const payload = { ...basePayload, features: segment };
        const durationSec = ((end - start + 1) * options.sampleMs) / 1000;
        if (!options.quiet) {
          console.log(
            `Selected longest block ${longestIdx + 1}/${blocks.length} (frames=${segment.length}, ${durationSec.toFixed(2)}s) for inference.`,
          );
        }
        try {
          const inferenceStart = performance.now();
          const output = await runPythonInference({
            pythonCmd: options.python,
            scriptPath: options.inferScript,
            modelPath: options.model,
            configPath: options.config,
            payload,
            lowPassWindow: options.lowPassWindow,
            autoIdleOptions: options.autoIdle
              ? {
                  enabled: true,
                  label: options.idleLabel,
                  pressureStd: options.idlePressureStd,
                  pressureMean: options.idlePressureMean,
                  accelStd: options.idleAccelStd,
                  gyroStd: options.idleGyroStd,
                }
              : { enabled: false },
            pythonDevice: options.pythonDevice,
          });
          const inferenceElapsed = performance.now() - inferenceStart;
          try {
            const parsed = JSON.parse(output);
            console.log(
              `${parsed.label} (${(parsed.probability * 100).toFixed(1)}%) | ${inferenceElapsed.toFixed(1)}ms`,
            );
          } catch (parseErr) {
            console.log(`Python output (block ${longestIdx + 1}, ${inferenceElapsed.toFixed(1)}ms):`, output);
          }
        } catch (inferErr) {
          console.error(`Block ${longestIdx + 1} inference error:`, inferErr);
        }
      }
    }
  } catch (err) {
    console.error("Fatal error in inference loop:", err);
    shutdown(1);
  }
});
