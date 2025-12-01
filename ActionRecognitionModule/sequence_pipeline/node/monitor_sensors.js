#!/usr/bin/env node

/**
 * Realtime sensor monitor for PillowMate hardware.
 *
 * Streams raw pressure (with baseline subtraction) and IMU values, printing
 * them to stdout as a rolling table plus a simple ASCII bar for the pressure
 * delta so you can quickly inspect sensor behaviour while debugging.
 */

import five from "johnny-five";
import { Command } from "commander";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const { Board, Sensor, IMU } = five;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_ROOT = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(MODULE_ROOT, ".env") });

const program = new Command();
program
  .description("Display realtime pressure/IMU readings for PillowMate sensors.")
  .option("--pressure-pin <pin>", "Analog pin for the pressure sensor", "A0")
  .option("--imu-controller <name>", "Johnny-Five IMU controller", "MPU6050")
  .option("--sample-ms <ms>", "Sampling interval in milliseconds", (value) => parseInt(value, 10), 20)
  .option("--baseline-samples <count>", "Samples used to estimate the resting pressure baseline", (value) => parseInt(value, 10), 200)
  .option("--port <path>", "Serial port override (defaults to SERIAL_PORT/.env)");

const options = program.parse(process.argv).opts();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function calibrateBaseline(readPressure, samples, sampleDelayMs) {
  console.log(`압력 기준을 측정합니다. ${samples}개의 샘플 동안 베개를 건드리지 말아 주세요.`);
  let sum = 0;
  let count = 0;
  while (count < samples) {
    const value = readPressure();
    if (value != null) {
      sum += value;
      count += 1;
    }
    await sleep(sampleDelayMs);
  }
  const baseline = sum / samples;
  console.log(`기준 압력: ${baseline.toFixed(2)}`);
  return baseline;
}

function formatBar(value, width = 30, scale = 1) {
  const clamped = Math.max(-scale, Math.min(scale, value));
  const proportion = (clamped + scale) / (2 * scale);
  const filled = Math.round(proportion * width);
  return "█".repeat(filled).padEnd(width, " ");
}

const boardOptions = { repl: false };
const envPort = options.port?.trim() || process.env.SERIAL_PORT?.trim();
if (envPort) {
  console.log(`포트 지정: ${envPort}`);
  boardOptions.port = envPort;
}

const board = new Board(boardOptions);

board.on("error", (err) => {
  console.error("보드 오류:", err);
  process.exit(1);
});

board.on("ready", async () => {
  console.log("보드 연결 완료. 센서를 초기화합니다...");

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

  while (latestPressure == null || latestAccel == null || latestGyro == null) {
    await sleep(50);
  }

  const baseline = await calibrateBaseline(() => latestPressure, options.baselineSamples, options.sampleMs);
  console.log("실시간 모니터링을 시작합니다. 종료하려면 Ctrl+C를 누르세요.");

  setInterval(() => {
    if (latestPressure == null || !latestAccel || !latestGyro) {
      return;
    }
    const deltaP = latestPressure - baseline;
    const accel = latestAccel;
    const gyro = latestGyro;
    const row = [
      `ΔP=${deltaP.toFixed(2)}`,
      `ax=${accel.x.toFixed(3)}`,
      `ay=${accel.y.toFixed(3)}`,
      `az=${accel.z.toFixed(3)}`,
      `gx=${gyro.x.toFixed(3)}`,
      `gy=${gyro.y.toFixed(3)}`,
      `gz=${gyro.z.toFixed(3)}`,
    ].join("  ");
    const bar = formatBar(deltaP, 40, 50); // visually highlight pressure swings
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(`${row}\n`);
    process.stdout.write(`${bar}\n`);
  }, options.sampleMs);
});
