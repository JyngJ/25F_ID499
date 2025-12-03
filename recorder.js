import fs from "fs";
import { buildRecordCommand, runCommand } from "./utils.js"; // Import helpers
/**
 * Records audio using the 'rec' command (from SoX) with VAD based on options.
 * @param {string} outputFile - Path to save the WAV file.
 * @param {object} options - Recording options. Expected to contain maxDuration, startThreshold, endThreshold, minSilenceDuration.
 * @returns {Promise<void>}
 */


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
  return new Promise(async (resolve, reject) => {
    // VAD parameters from options (derived from config.js in voice_chat.js/loop)
    // Thresholds are floats like 0.01, so convert to % for sox
    const startThresholdVolume = options.startThreshold * 100;
    const endThresholdVolume = options.endThreshold * 100;

    // minSilenceDuration is in ms, so convert to seconds for sox
    const minSilenceDurationSec = options.minSilenceDuration / 1000;
    const startThresholdDurationSec = options.startThresholdDuration / 1000;

    // Max duration for rec command (in seconds)
    // options.maxDuration is in ms, convert to seconds. Ensure minimum 1s.
    const maxRecDuration = options.maxDuration
      ? Math.max(1, options.maxDuration / 1000)
      : 10; // Default to 10s if not set

    // SoX silence effect:
    // silence 1 <duration> <threshold[d|%]> 1 <duration> <threshold[d|%]>
    // '1' before durations are count parameters.
    const soxSilenceEffect = `silence 1 ${startThresholdDurationSec} ${startThresholdVolume}% 1 ${minSilenceDurationSec} ${endThresholdVolume}%`;

    // console.log(
    //   `\n🎙  녹음 시작 (최대 ${maxRecDuration}초, VAD 활성화 - 시작: ${startThresholdVolume}% ${startThresholdDurationSec}s / 종료: ${endThresholdVolume}% ${minSilenceDurationSec}s)...`
    // );

    console.log(
      `\n🎙  Threshold를 넘는 음성이 입력되면 자동으로 녹음 시작, 약 1초간 침묵이 유지되면 녹음이 중단됩니다. (최대 녹음시간: ${maxRecDuration}초)`
    );
    try {
      const recordCmd = buildRecordCommand(outputFile, soxSilenceEffect, maxRecDuration);
      // Platform-aware record command: SoX on Windows, rec elsewhere. Both share VAD options.
      await runCommand(recordCmd);
      console.log("✅ 녹음 완료:", outputFile);
      resolve();
    } catch (err) {
      console.error("❌ 녹음 중 오류:", err);
      reject(err);
    }
  });
}
