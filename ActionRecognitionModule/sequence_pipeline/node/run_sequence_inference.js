#!/usr/bin/env node

/**
 * Collects a variable-length sequence during a user turn and classifies it
 * using the PyTorch GRU model (python/sequence_infer.py).
 *
 * The script streams Johnny-Five sensor data while the user speaks. Press Enter
 * to start recording, perform the interaction, then press Enter again to stop.
 * The captured sequence is sent to the Python inference helper, and the
 * predicted label is logged to the console.
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
const PIPELINE_ROOT = path.resolve(__dirname, "..");
const MODULE_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PYTHON = "python";
const FEATURE_NAMES = ["pressure_delta", "ax", "ay", "az", "gx", "gy", "gz"];

dotenv.config({ path: path.join(MODULE_ROOT, ".env") });

const program = new Command();
program
  .description("Run sequence-level inference for PillowMate activity recognition.")
  .option("--pressure-pin <pin>", "Analog pin used for the pressure sensor", "A0")
  .option("--imu-controller <name>", "Johnny-Five IMU controller name", "MPU6050")
  .option("--sample-ms <ms>", "Sampling interval (ms)", (value) => parseInt(value, 10), 20)
  .option("--baseline-samples <count>", "Samples for pressure baseline", (value) => parseInt(value, 10), 200)
  .option("--python <cmd>", "Python interpreter to run sequence_infer.py", DEFAULT_PYTHON)
  .option(
    "--infer-script <path>",
    "Path to python/sequence_infer.py",
    path.resolve(PIPELINE_ROOT, "python", "sequence_infer.py"),
  )
  .option(
    "--model <path>",
    "Path to sequence_classifier.pt",
    path.resolve(PIPELINE_ROOT, "models", "sequence_classifier.pt"),
  )
  .option(
    "--config <path>",
    "Path to sequence_config.json",
    path.resolve(PIPELINE_ROOT, "models", "sequence_config.json"),
  )
  .option(
    "--low-pass-window <samples>",
    "Moving average window to apply before inference",
    (value) => parseInt(value, 10),
    1,
  )
  .option("--auto-idle", "Enable heuristic idle detection", false)
  .option("--idle-label <name>", "Label name to emit when auto idle triggers", "idle")
  .option("--idle-pressure-std <value>", "Pressure std threshold for auto idle", (value) => parseFloat(value), 5.0)
  .option("--idle-pressure-mean <value>", "Abs mean pressure threshold for auto idle", (value) => parseFloat(value), 15.0)
  .option("--idle-accel-std <value>", "Accel std threshold for auto idle", (value) => parseFloat(value), 0.02)
  .option("--idle-gyro-std <value>", "Gyro std threshold for auto idle", (value) => parseFloat(value), 0.02)
  .option("--port <path>", "Serial port override (defaults to SERIAL_PORT/.env)")
  .option("--quiet", "Suppress interim console logs", false);

const options = program.parse(process.argv).opts();

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
      throw new Error("센서에서 값을 읽어오지 못했습니다. 연결 상태를 확인하세요.");
    }
    await delay(50);
  }
}

async function calibrateBaseline(readPressure, samples, sampleDelayMs) {
  console.log(`\n압력 기준을 측정합니다. ${samples}개의 샘플 동안 베개를 건드리지 마세요.`);
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

function runPythonInference({
  pythonCmd,
  scriptPath,
  modelPath,
  configPath,
  payload,
  lowPassWindow,
  autoIdleOptions,
}) {
  return new Promise((resolve, reject) => {
    const args = [scriptPath, "--model", modelPath, "--config", configPath];
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
    // Echo Python stderr to help debug (e.g., auto-idle stats) while still capturing for errors.
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

const SERIAL_PORT = options.port?.trim() || process.env.SERIAL_PORT?.trim();
const boardOptions = { repl: false };
if (SERIAL_PORT) {
  console.log(`포트 지정: ${SERIAL_PORT}`);
  boardOptions.port = SERIAL_PORT;
}

const board = new Board(boardOptions);
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }
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
  console.log("\n사용자 중단 요청을 받았습니다. 연결을 정리합니다.");
  shutdown(0);
});

board.on("error", (err) => {
  console.error("보드 오류:", err);
  shutdown(1);
});

board.on("ready", async () => {
  console.log("Johnny-Five 보드 연결 완료. 센서를 준비합니다...");
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
    console.log("\n사용자 턴을 녹화하려면 Enter를 누르세요. (종료: Ctrl+C)");

    while (true) {
      await waitForLine("새 턴을 시작하려면 Enter를 누르세요.");
      console.log("녹화를 시작했습니다. 사용자의 음성과 동작을 수행하세요. 끝나면 다시 Enter를 누르세요.");

      let stopRequested = false;
      const frames = [];
      const stopPromise = waitForLine("턴을 종료하려면 Enter를 누르세요.").then(() => {
        stopRequested = true;
      });

      while (!stopRequested) {
        if (latestPressure != null && latestAccel && latestGyro) {
          const frame = [
            latestPressure - baseline,
            latestAccel.x,
            latestAccel.y,
            latestAccel.z,
            latestGyro.x,
            latestGyro.y,
            latestGyro.z,
          ];
          frames.push(frame);
          if (!options.quiet && frames.length % Math.max(1, Math.floor(1000 / options.sampleMs)) === 0) {
            console.log(
              `샘플 ${frames.length}개 수집 중... ΔP=${frame[0].toFixed(2)} ax=${frame[1].toFixed(2)} ay=${frame[2].toFixed(2)} az=${frame[3].toFixed(2)} gx=${frame[4].toFixed(2)} gy=${frame[5].toFixed(2)} gz=${frame[6].toFixed(2)}`,
            );
          }
        }
        await delay(options.sampleMs);
      }
      await stopPromise;

      if (!frames.length) {
        console.warn("수집된 샘플이 없습니다. 다시 시도하세요.");
        continue;
      }
      const payload = {
        label: "unknown",
        sample_ms: options.sampleMs,
        feature_names: FEATURE_NAMES,
        features: frames,
      };

      console.log("PyTorch 추론을 실행합니다...");
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
        });
        const inferenceElapsed = performance.now() - inferenceStart;
        try {
          const parsed = JSON.parse(output);
          console.log(
            `예측 결과: ${parsed.label} (${(parsed.probability * 100).toFixed(1)}%) | 추론 ${inferenceElapsed.toFixed(1)}ms`,
          );
        } catch (parseErr) {
          console.log(`Python 출력 (추론 ${inferenceElapsed.toFixed(1)}ms):`, output);
        }
      } catch (inferErr) {
        console.error("추론 중 오류:", inferErr);
      }
    }
  } catch (err) {
    console.error("시퀀스 추론 중 오류:", err);
    shutdown(1);
  }
});
