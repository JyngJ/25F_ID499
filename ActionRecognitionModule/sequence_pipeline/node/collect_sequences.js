#!/usr/bin/env node

/**
 * Variable-length sequence data collector for PillowMate action recognition.
 *
 * Records Johnny-Five sensor streams (pressure + IMU) from an Arduino running
 * StandardFirmata and saves each labeled turn as a JSON file that contains the
 * entire sequence of samples. Unlike the fixed-duration collector, users start
 * and stop each recording manually so sequences can match arbitrary voice turns.
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import five from "johnny-five";
import { Command } from "commander";

const { Board, Sensor, IMU } = five;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PIPELINE_ROOT = path.resolve(__dirname, "..");
const MODULE_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT_DIR = path.resolve(PIPELINE_ROOT, "data", "raw");

dotenv.config({ path: path.join(MODULE_ROOT, ".env") });

const DEFAULT_LABELS = ["idle", "hug", "shake", "rest_head", "tap"];
const FEATURE_NAMES = ["pressure_delta", "ax", "ay", "az", "gx", "gy", "gz"];

const program = new Command();
program
  .description("Collect variable-length sequences for PillowMate activity recognition.")
  .option("--labels <labels...>", "Labels to record", DEFAULT_LABELS)
  .option("--trials <count>", "How many turns per label", (value) => parseInt(value, 10), 3)
  .option("--sample-ms <ms>", "Sensor sampling interval", (value) => parseInt(value, 10), 20)
  .option("--pressure-pin <pin>", "Analog pin for the pressure sensor", "A0")
  .option("--imu-controller <name>", "Johnny-Five IMU controller", "MPU6050")
  .option("--baseline-samples <count>", "Samples for baseline calibration", (value) => parseInt(value, 10), 200)
  .option("--record-seconds <seconds>", "Automatic recording length per trial (0 = manual stop mode)", (value) => parseFloat(value), 30)
  .option("--output <dir>", "Directory for JSON sequences", DEFAULT_OUTPUT_DIR)
  .option("--quiet", "Suppress per-sample console logs", false)
  .option("--port <path>", "Serial port override (else uses SERIAL_PORT/.env)");

const options = program.parse(process.argv).opts();
const outputDir = path.isAbsolute(options.output)
  ? options.output
  : path.resolve(process.cwd(), options.output);

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
      throw new Error("센서 초기화에 실패했습니다. 배선을 확인하거나 기기를 다시 연결하세요.");
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

function formatSequencePayload({ label, sampleMs, frames, startedAt, metadata }) {
  return {
    label,
    sample_ms: sampleMs,
    feature_names: FEATURE_NAMES,
    started_at: startedAt,
    frame_count: frames.length,
    features: frames,
    metadata,
  };
}

async function writeSequence({ payload, baseDir }) {
  if (!payload.features.length) {
    throw new Error("녹화된 샘플이 없습니다. 라벨을 다시 시도하세요.");
  }
  await fs.promises.mkdir(baseDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  const filename = `sequence_${payload.label}_${timestamp}.json`;
  const filepath = path.join(baseDir, filename);
  await fs.promises.writeFile(filepath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n${payload.frame_count}개의 프레임을 ${filepath}에 저장했습니다.`);
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
  console.log("\n사용자 중단 요청을 받았습니다. 정리 중...");
  shutdown(0);
});

board.on("error", (err) => {
  console.error("보드 오류:", err);
  shutdown(1);
});

board.on("ready", async () => {
  console.log("Johnny-Five 보드 준비 완료. 센서를 구성합니다...");
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

    const getSnapshot = () => {
      if (latestPressure == null || latestAccel == null || latestGyro == null) {
        return null;
      }
      return {
        pressure: latestPressure - baseline,
        accel: { ...latestAccel },
        gyro: { ...latestGyro },
      };
    };

    const autoRecordSeconds = Math.max(0, options.recordSeconds);

    for (const label of options.labels) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        console.log(`\n=== '${label}' 라벨 ${trial}/${options.trials}회차 ===`);
        console.log("1) 베개 및 음성 환경을 준비하세요.");
        await waitForLine("2) 녹화를 시작하려면 Enter 키를 누르세요.");
        if (autoRecordSeconds > 0) {
          console.log(`녹화를 시작했습니다. ${autoRecordSeconds}초 동안 행동을 유지해 주세요.`);
        } else {
          console.log("녹화를 시작했습니다. 행동을 수행하고, 끝나면 다시 Enter를 누르세요.");
        }

        let stopRequested = false;
        const frames = [];
        const startedAt = Date.now();
        let stopPromise;
        if (autoRecordSeconds > 0) {
          const deadline = startedAt + autoRecordSeconds * 1000;
          stopPromise = (async () => {
            while (Date.now() < deadline) {
              await delay(options.sampleMs);
            }
            stopRequested = true;
          })();
        } else {
          stopPromise = waitForLine("녹화를 종료하려면 Enter를 누르세요.").then(() => {
            stopRequested = true;
          });
        }

        while (!stopRequested) {
          const snapshot = getSnapshot();
          if (snapshot) {
            const frame = [
              snapshot.pressure,
              snapshot.accel.x,
              snapshot.accel.y,
              snapshot.accel.z,
              snapshot.gyro.x,
              snapshot.gyro.y,
              snapshot.gyro.z,
            ];
            frames.push(frame);
            if (!options.quiet && frames.length % Math.max(1, Math.floor(1000 / options.sampleMs)) === 0) {
              console.log(
                `${label.padEnd(10)} | ΔP=${frame[0].toFixed(2)} ax=${frame[1].toFixed(2)} ay=${frame[2].toFixed(2)} az=${frame[3].toFixed(2)}`,
              );
            }
          }
          await delay(options.sampleMs);
        }
        await stopPromise;
        const payload = formatSequencePayload({
          label,
          sampleMs: options.sampleMs,
          frames,
          startedAt,
          metadata: {
            trial,
            baseline,
          },
        });
        await writeSequence({ payload, baseDir: outputDir });
      }
    }
    console.log("\n모든 라벨 녹화를 마쳤습니다.");
    shutdown(0);
  } catch (err) {
    console.error("시퀀스 수집 중 오류가 발생했습니다:", err);
    shutdown(1);
  }
});
