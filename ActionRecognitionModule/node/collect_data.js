#!/usr/bin/env node

/**
 * Johnny-Five based data collector for the PillowMate Action Recognition Module.
 *
 * The script talks to an Arduino-compatible board running StandardFirmata,
 * streams the Velostat pressure sensor (analog) + MPU6050 IMU, and writes a
 * labeled CSV that is compatible with python/train_model.py.
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import five from "johnny-five";
import { Command } from "commander";
import dotenv from "dotenv";

const { Board, Sensor, IMU } = five;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(MODULE_ROOT, ".env") });

const DEFAULT_LABELS = ["idle", "tap", "rest_head", "hug", "shake"];
const DEFAULT_OUTPUT_DIR = path.resolve(MODULE_ROOT, "data", "raw");
const CSV_HEADER = [
  "timestamp_ms",
  "pressure",
  "ax",
  "ay",
  "az",
  "gx",
  "gy",
  "gz",
  "label",
];

const program = new Command();
program
  .description("Collect labeled PillowMate interaction data via Johnny-Five.")
  .option("--labels <labels...>", "Recording labels", DEFAULT_LABELS)
  .option("--duration <seconds>", "Recording length per trial (s)", (value) => parseFloat(value), 5)
  .option("--trials <count>", "Number of repetitions per label", (value) => parseInt(value, 10), 3)
  .option("--sample-ms <ms>", "Sampling interval in milliseconds", (value) => parseInt(value, 10), 20)
  .option("--pressure-pin <pin>", "Analog pin used for the Velostat sensor", "A0")
  .option("--imu-controller <name>", "Johnny-Five IMU controller name", "MPU6050")
  .option(
    "--baseline-samples <count>",
    "Samples used to estimate the resting pressure baseline",
    (value) => parseInt(value, 10),
    200,
  )
  .option("--output <dir>", "Where to store the CSV output", DEFAULT_OUTPUT_DIR)
  .option("--quiet", "Suppress live sensor echo while recording", false);

const options = program.parse(process.argv).opts();
const outputDir = path.isAbsolute(options.output)
  ? options.output
  : path.resolve(process.cwd(), options.output);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const SERIAL_PORT = process.env.SERIAL_PORT?.trim();
const boardOptions = { repl: false };
if (SERIAL_PORT) {
  console.log(`SERIAL_PORT 환경 변수 감지: ${SERIAL_PORT}`);
  boardOptions.port = SERIAL_PORT;
}

const board = new Board(boardOptions);
let isShuttingDown = false;

function ask(question) {
  return new Promise((resolve) => rl.question(question, () => resolve(undefined)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(conditionFn, timeoutMs = 8000) {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("센서 초기화에 실패했습니다. 배선을 확인하거나 기기를 다시 연결하세요.");
    }
    await delay(50);
  }
}

async function calibrateBaseline(getPressure, samples, sampleDelayMs) {
  console.log(`\n압력 기준을 측정합니다. 베개에 힘을 가하지 말고 ${samples}개의 샘플을 기다려 주세요.`);
  let collected = 0;
  let sum = 0;
  while (collected < samples) {
    const value = getPressure();
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

async function recordTrial({
  label,
  trialIndex,
  durationSeconds,
  sampleMs,
  getSnapshot,
  baseline,
  quiet,
}) {
  console.log(`\n'${label}' ${trialIndex}회차를 ${durationSeconds}초 동안 기록합니다.`);
  await ask("준비가 되면 Enter 키를 누르세요.");

  const rows = [];
  const deadline = Date.now() + durationSeconds * 1000;
  while (Date.now() < deadline) {
    const snapshot = getSnapshot();
    if (!snapshot) {
      await delay(sampleMs);
      continue;
    }
    const row = [
      Date.now(),
      snapshot.pressure - baseline,
      snapshot.accel.x,
      snapshot.accel.y,
      snapshot.accel.z,
      snapshot.gyro.x,
      snapshot.gyro.y,
      snapshot.gyro.z,
      label,
    ];
    rows.push(row);
    if (!quiet) {
      console.log(
        `${label.padEnd(10)} | ΔP=${(row[1]).toFixed(2)} ax=${row[2].toFixed(3)} ay=${row[3].toFixed(3)} az=${row[4].toFixed(
          3,
        )}`,
      );
    }
    await delay(sampleMs);
  }
  return rows;
}

function formatCsv(rows) {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      row
        .map((value, idx) => {
          if (idx === row.length - 1) {
            return value;
          }
          if (typeof value === "number" && !Number.isInteger(value)) {
            return value.toFixed(6);
          }
          return String(value);
        })
        .join(","),
    );
  }
  return lines.join("\n");
}

async function writeCsv(rows) {
  if (!rows.length) {
    throw new Error("수집된 샘플이 없습니다. 하드웨어 연결과 라벨링 절차를 다시 확인하세요.");
  }
  await fs.promises.mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  const filename = `action_module_${timestamp}.csv`;
  const filepath = path.join(outputDir, filename);
  await fs.promises.writeFile(filepath, formatCsv(rows), "utf8");
  console.log(`\n${rows.length}개의 샘플을 ${filepath}에 저장했습니다.`);
}

function shutdown(code = 0) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
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
  console.log("Johnny-Five 보드가 준비되었습니다. 센서를 세팅합니다...");
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
    await waitFor(() => latestPressure !== null && latestAccel !== null && latestGyro !== null);
    const baseline = await calibrateBaseline(() => latestPressure, options.baselineSamples, options.sampleMs);

    const getSnapshot = () => {
      if (latestPressure == null || latestAccel == null || latestGyro == null) {
        return null;
      }
      return {
        pressure: latestPressure,
        accel: { ...latestAccel },
        gyro: { ...latestGyro },
      };
    };

    const allRows = [];
    for (const label of options.labels) {
      for (let trial = 1; trial <= options.trials; trial += 1) {
        const rows = await recordTrial({
          label,
          trialIndex: trial,
          durationSeconds: options.duration,
          sampleMs: options.sampleMs,
          getSnapshot,
          baseline,
          quiet: options.quiet,
        });
        allRows.push(...rows);
      }
    }

    await writeCsv(allRows);
    console.log("데이터 수집이 완료되었습니다.");
    shutdown(0);
  } catch (err) {
    console.error("데이터 수집 중 오류가 발생했습니다:", err);
    shutdown(1);
  }
});
