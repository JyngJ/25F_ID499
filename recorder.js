import fs from "fs";
import { runCommand } from "./utils.js"; // Import runCommand
/**
 * Records audio using the 'rec' command (from SoX) with VAD based on options.
 * @param {string} outputFile - Path to save the WAV file.
 * @param {object} options - Recording options. Expected to contain maxDuration, startThreshold, endThreshold, minSilenceDuration.
 * @returns {Promise<void>}
 */
export function recordAudio(outputFile, options = {}) {
  return new Promise(async (resolve, reject) => {
    // VAD parameters from options (derived from config.js in voice_chat.js/loop)
    // Thresholds are floats like 0.01, so convert to % for sox
    const startThresholdVolume = options.startThreshold * 100;
    const endThresholdVolume = options.endThreshold * 100;

    // minSilenceDuration is in ms, so convert to seconds for sox
    const minSilenceDurationSec = options.minSilenceDuration;
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
      `\n🎙  Threshold를 넘는 음성이 입력되면 자동으로 녹음 시작, 약 1초간 침묵이 유지되면 녹음이 중단됩니다.`
    );
    try {
      // Use SoX 'rec' command:
      // -q: quiet output
      // -c 1 -r 16000 -b 16: 1 channel, 16kHz, 16-bit signed (standard for speech)
      // ${soxSilenceEffect}: apply VAD
      // trim 0 ${maxRecDuration}: ensures recording stops after maxRecDuration if VAD doesn't stop it first.
      await runCommand(
        `rec -q -c 1 -r 16000 -b 16 "${outputFile}" ${soxSilenceEffect} trim 0 ${maxRecDuration}`
      );
      console.log("✅ 녹음 완료:", outputFile);
      resolve();
    } catch (err) {
      console.error("❌ 녹음 중 오류:", err);
      reject(err);
    }
  });
}
