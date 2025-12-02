import fs from "fs";
import mic from "mic";
import WaveFilePackage from "wavefile";
import { updateMicDisplay, attachStatusDisplay } from "./status_display.js";
const { WaveFile } = WaveFilePackage;

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BIT_DEPTH = 16;
const BYTES_PER_SAMPLE = (BIT_DEPTH / 8) * CHANNELS;

function computeRms(buffer) {
  if (!buffer || buffer.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  const sampleCount = buffer.length / BYTES_PER_SAMPLE;
  for (let i = 0; i < buffer.length; i += 2) {
    const sample = buffer.readInt16LE(i);
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return rms / 32768;
}

function renderLevel(level, { active = true } = {}) {
  if (!active) {
    updateMicDisplay("🎧 음성 입력 대기 중...");
    return;
  }
  const clamped = Math.max(0, Math.min(1, level));
  const barLength = 30;
  const filled = Math.round(clamped * barLength);
  updateLedForLevel(clamped);
  const micLine = `🎙 Input [${"█".repeat(filled).padEnd(barLength, " ")}] ${(
    clamped * 100
  ).toFixed(0)}%`;
  updateMicDisplay(micLine);
}

let ledAdapter = null;
let lastLedLevel = 0;

export function registerLedAdapter(adapter) {
  ledAdapter = adapter;
}

function updateLedForLevel(level) {
  // 최근 입력값과 결합해 LED 밝기 변화가 부드럽게 이어지도록 한다.
  const eased = lastLedLevel * 0.7 + level * 0.3;
  lastLedLevel = eased;
  const brightness = Math.round(Math.min(1, Math.max(0, eased)) * 255);
  // 간단한 컬러 맵: 낮은 입력은 파란빛, 중간 입력은 녹색/청록, 높은 입력은 주황빛으로 표현
  const color =
    brightness < 85
      ? [0, 0, brightness]
      : brightness < 170
        ? [0, brightness, brightness / 2]
        : [brightness, 50, 0];
  const payload = { brightness, color };
  if (ledAdapter && typeof ledAdapter.setState === "function") {
    // 실제 LED 어댑터가 주입된 경우, 해당 장치에 상태 전달
    ledAdapter.setState(payload);
  } else {
    return;
  }
}

export function recordAudio(outputFile, options = {}) {
  return new Promise((resolve, reject) => {
    attachStatusDisplay();
    const startThreshold = options.startThreshold ?? 0.02;
    const endThreshold = options.endThreshold ?? 0.015;
    const startThresholdDurationMs = options.startThresholdDuration ?? 300;
    const minSilenceDurationMs = options.minSilenceDuration ?? 800;
    const maxDuration = options.maxDuration ?? 10000;

    console.log(
      "\n🎙  Threshold를 넘는 음성이 입력되면 자동으로 녹음이 시작되고, 침묵이 일정 시간 유지되면 종료됩니다.",
    );

    const micInstance = mic({
      rate: String(SAMPLE_RATE),
      channels: String(CHANNELS),
      bitwidth: String(BIT_DEPTH),
      encoding: "signed-integer",
      endian: "little",
      device: options.device,
      fileType: "raw",
    });

    const micInputStream = micInstance.getAudioStream();

    const buffers = [];
    let recordingStarted = false;
    let aboveStartSec = 0;
    let belowEndSec = 0;
    let recordedMs = 0;
    let finished = false;
    let levelTimer = null;
    let visualizeLevel = false;
    const onSpeechStart = options.onSpeechStart;

    const stopRecording = (reason) => {
      if (finished) return;
      finished = true;
      micInstance.stop();
      if (levelTimer) {
        clearInterval(levelTimer);
        levelTimer = null;
      }
      process.stdout.write("\n");

      if (buffers.length === 0) {
        reject(new Error("음성 구간을 감지하지 못했습니다."));
        return;
      }

      const pcmBuffer = Buffer.concat(buffers);
      const wav = new WaveFile();
      wav.fromScratch(CHANNELS, SAMPLE_RATE, "16", pcmBuffer);
      fs.writeFile(outputFile, Buffer.from(wav.toBuffer()), (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log(`✅ 녹음 완료: ${outputFile} (${reason})`);
        resolve();
      });
    };

    micInputStream.on("data", (chunk) => {
      const rms = computeRms(chunk);
      renderLevel(rms, { active: visualizeLevel });

      const chunkMs = (chunk.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
      const chunkSec = chunkMs / 1000;

      if (!recordingStarted) {
        if (rms >= startThreshold) {
          aboveStartSec += chunkSec;
          if (aboveStartSec >= startThresholdDurationMs / 1000) {
            recordingStarted = true;
            visualizeLevel = true;
            belowEndSec = 0;
            console.log("\n▶️  음성 감지됨. 녹음을 시작합니다.");
            if (typeof onSpeechStart === "function") {
              onSpeechStart();
            }
          }
        } else {
          aboveStartSec = 0;
        }
      }

      if (recordingStarted) {
        buffers.push(Buffer.from(chunk));
        recordedMs += chunkMs;

        if (rms <= endThreshold) {
          belowEndSec += chunkSec;
          if (belowEndSec >= minSilenceDurationMs / 1000) {
            stopRecording("침묵 감지");
          }
        } else {
          belowEndSec = 0;
        }

        if (recordedMs >= maxDuration) {
          stopRecording("최대 녹음 시간 도달");
        }
      }
    });

    micInputStream.on("error", (err) => {
      if (finished) return;
      finished = true;
      micInstance.stop();
      reject(err);
    });

    micInputStream.on("startComplete", () => {
      levelTimer = setInterval(() => {}, 200);
    });

    micInputStream.on("stopComplete", () => {
      if (!finished) {
        stopRecording("중단됨");
      }
    });

    micInstance.start();

    setTimeout(() => {
      if (!finished) {
        stopRecording("녹음 타임아웃");
      }
    }, maxDuration + 2000);
  });
}
