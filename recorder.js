import fs from "fs";
import mic from "mic";
import WaveFilePackage from "wavefile";
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

function renderLevel(level) {
  const clamped = Math.max(0, Math.min(1, level));
  const barLength = 30;
  const filled = Math.round(clamped * barLength);
  process.stdout.write(
    `\r🎙  Input level: [${"█".repeat(filled).padEnd(barLength, " ")}] ${(clamped * 100).toFixed(
      0,
    )}%`,
  );
}

export function recordAudio(outputFile, options = {}) {
  return new Promise((resolve, reject) => {
    const startThreshold = options.startThreshold ?? 0.02;
    const endThreshold = options.endThreshold ?? 0.015;
    const startThresholdDuration = options.startThresholdDuration ?? 300;
    const minSilenceDuration = options.minSilenceDuration ?? 800;
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
    let aboveStartMs = 0;
    let belowEndMs = 0;
    let recordedMs = 0;
    let finished = false;
    let levelTimer = null;

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
      renderLevel(rms);

      const chunkMs = (chunk.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;

      if (!recordingStarted) {
        if (rms >= startThreshold) {
          aboveStartMs += chunkMs;
          if (aboveStartMs >= startThresholdDuration) {
            recordingStarted = true;
            belowEndMs = 0;
            console.log("\n▶️  음성 감지됨. 녹음을 시작합니다.");
          }
        } else {
          aboveStartMs = 0;
        }
      }

      if (recordingStarted) {
        buffers.push(Buffer.from(chunk));
        recordedMs += chunkMs;

        if (rms <= endThreshold) {
          belowEndMs += chunkMs;
          if (belowEndMs >= minSilenceDuration) {
            stopRecording("침묵 감지");
          }
        } else {
          belowEndMs = 0;
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
