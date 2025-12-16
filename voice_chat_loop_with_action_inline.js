import path from "path";
import fs from "fs";
import { createTranscription, textToSpeech } from "./audio.js";
import { askPillowMate, gptModel } from "./gpt_chat.js";
import { recordAudio, registerLedAdapter } from "./recorder.js";
import { updateSensorDisplay, attachStatusDisplay } from "./status_display.js";
import {
  buildPlaybackCommand,
  runCommand,
  getDirname,
  sleep,
  checkDependency,
} from "./utils.js";
import { config } from "./config.js";
import { InlineActionRecognizer } from "./ActionRecognitionModule/node/action_recognizer_inline.js";
import { neoPixel } from "./neopixel_controller.js";
import five from "johnny-five";

const __dirname = getDirname(import.meta.url);
const INPUT_AUDIO_PATH = path.join(__dirname, "assets", "input.wav");
const OUTPUT_AUDIO_PATH = path.join(__dirname, "assets", "reply.mp3");
const MIN_AUDIO_SECONDS = 1; // Whisper는 0.1s 미만 거절. 0.2s 미만이면 다시 듣기로 전환.

const ACTION_MODULE_DIR = path.join(__dirname, "ActionRecognitionModule");

const ACTION_MODEL_BASENAME = "251210pillowmate_full_many";

// Single shared Johnny-Five board for both sensors and NeoPixel.
const sharedBoardPort =
  process.env.SERIAL_PORT?.trim() ||
  process.env.BOARD_PORT?.trim() ||
  undefined;
const sharedBoard = new five.Board({
  port: sharedBoardPort,
  repl: false,
  debug: false,
  timeout: 30000,
});
const sharedBoardReady = new Promise((resolve, reject) => {
  sharedBoard.on("ready", () => resolve(sharedBoard));
  sharedBoard.on("error", (err) => {
    console.error("Shared board init failed", err);
    reject(err);
  });
});
neoPixel.setBoard(sharedBoard);

const ACTION_OPTIONS = {
  modelPath: path.join(
    ACTION_MODULE_DIR,
    "models",
    `${ACTION_MODEL_BASENAME}.pt`
  ),
  configPath: path.join(
    ACTION_MODULE_DIR,
    "models",
    `${ACTION_MODEL_BASENAME}.json`
  ),
  lowPassWindow: 5,
  autoIdle: {
    enabled: true,
    label: "idle",
    pressureStd: 8,
    pressureMean: 15,
    accelStd: 1,
    gyroStd: 10,
  },
  pythonDevice: "cpu",
  streamSensors: true,
  moduleRoot: ACTION_MODULE_DIR,
  onSensorFrame: handleSensorFrame,
  board: sharedBoard,
};

let sensorDisplayActive = false;
let conversationHistory = [];
let actionRecognizer = null;

function setSensorDisplayActive(active) {
  sensorDisplayActive = active;
  if (!active) {
    updateSensorDisplay("sensors: idle");
  }
}

class ConsoleLedAdapter {
  setState({ brightness }) {
    // Dummy adapter so recorder LED calls do not throw.
    return brightness;
  }
}

function getWavDurationSeconds(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    fs.closeSync(fd);
    const dataSize = header.readUInt32LE(40);
    const sampleRate = header.readUInt32LE(24);
    const channels = header.readUInt16LE(22);
    const bitsPerSample = header.readUInt16LE(34);
    const bytesPerSample = (bitsPerSample / 8) * channels || 1;
    if (!sampleRate) return 0;
    return dataSize / (sampleRate * bytesPerSample);
  } catch (e) {
    return 0;
  }
}

function handleSensorFrame(data) {
  if (!sensorDisplayActive) return;
  const dp = data.dp ?? 0;
  const accelMag = Math.sqrt(
    (data.ax ?? 0) ** 2 + (data.ay ?? 0) ** 2 + (data.az ?? 0) ** 2
  );
  const gyroMag = Math.sqrt(
    (data.gx ?? 0) ** 2 + (data.gy ?? 0) ** 2 + (data.gz ?? 0) ** 2
  );
  const line = `pressure ${dp.toFixed(1)} | accel ${accelMag.toFixed(2)} | gyro ${gyroMag.toFixed(2)}`;
  updateSensorDisplay(line);
}

function createActionRecognizer() {
  if (actionRecognizer) {
    actionRecognizer.dispose();
  }
  actionRecognizer = new InlineActionRecognizer(ACTION_OPTIONS);
  return actionRecognizer;
}

async function resetActionRecognizer() {
  createActionRecognizer();
  await actionRecognizer.ensureReady();
}

async function playStartMessage() {
  // Seed the model to produce a start-context greeting instead of a fixed prompt.
  const seedUser = {
    role: "user",
    content:
      "Session start. voice_text: (none yet). action_label: idle. Please begin.",
  };
  const startResponse = await askPillowMate([seedUser]);
  const replyText = startResponse.text;
  const emotion = startResponse.emotion ?? "neutral";
  const contextLabel = startResponse.context_label ?? "start";

  conversationHistory.push(seedUser);
  conversationHistory.push({ role: "assistant", content: replyText });

  console.log("PillowMate (start):", replyText);
  console.log("Emotion:", emotion);
  console.log("Context:", contextLabel);

  await neoPixel.showEmotion(emotion);
  await textToSpeech(replyText, OUTPUT_AUDIO_PATH);
  await runCommand(buildPlaybackCommand(OUTPUT_AUDIO_PATH));
  await neoPixel.off();
}

async function handleConversationTurn() {
  if (fs.existsSync(INPUT_AUDIO_PATH)) {
    fs.unlinkSync(INPUT_AUDIO_PATH);
  }

  await actionRecognizer.startTurn();
  setSensorDisplayActive(false);

  try {
    await neoPixel.showListening();
    await recordAudio(INPUT_AUDIO_PATH, {
      startThreshold: parseFloat(config.vad.start_threshold_volume) / 100.0,
      endThreshold: parseFloat(config.vad.end_threshold_volume) / 100.0,
      startThresholdDuration: parseFloat(config.vad.start_threshold_duration),
      minSilenceDuration: parseFloat(config.vad.end_threshold_duration),
      maxDuration: parseFloat(config.vad.max_recording_time),
      onSpeechStart: () => setSensorDisplayActive(true),
    });
  } catch (err) {
    await neoPixel.off();
    await resetActionRecognizer();
    throw err;
  }

  await neoPixel.showProcessing();
  const recordedDuration = getWavDurationSeconds(INPUT_AUDIO_PATH);
  const actionPromise = actionRecognizer
    .stopAndGetAction()
    .catch(() => ({ label: "idle", probability: 0, raw: "timeout" }));

  if (recordedDuration < MIN_AUDIO_SECONDS) {
    console.log(
      `🕑 녹음 길이 ${(recordedDuration * 1000).toFixed(0)}ms (너무 짧음). 다시 듣기 모드로 전환합니다.`
    );
    await actionPromise; // 센서 프로세스 상태 복구
    setSensorDisplayActive(false);
    await neoPixel.off();
    return;
  }

  console.log("Transcribing...");
  const userText = await createTranscription(INPUT_AUDIO_PATH, "ko");
  console.log("User:", userText);

  const actionResult = await actionPromise;
  setSensorDisplayActive(false);
  console.log(
    `Detected action: ${actionResult.label} (${(actionResult.probability * 100).toFixed(1)}%)`
  );

  const userAugmentedText = `${userText}\n\n[Detected action: ${actionResult.label} (${(
    actionResult.probability * 100
  ).toFixed(1)}%)]`;
  conversationHistory.push({ role: "user", content: userAugmentedText });

  const gptResponse = await askPillowMate(conversationHistory);
  if (
    !gptResponse ||
    typeof gptResponse.text !== "string" ||
    !gptResponse.text.trim()
  ) {
    console.warn("LLM returned no text. Raw response:", gptResponse);
  }
  const replyText =
    typeof gptResponse?.text === "string" && gptResponse.text.trim().length > 0
      ? gptResponse.text
      : "미안해, 방금 제대로 답을 만들지 못했어. 한 번만 더 말해줄래?";
  const emotion = gptResponse?.emotion ?? "neutral";
  const contextLabel = gptResponse?.context_label ?? "chat";

  conversationHistory.push({ role: "assistant", content: replyText });

  console.log("PillowMate:", replyText);
  console.log("Emotion:", emotion);
  console.log("Context:", contextLabel);

  await textToSpeech(replyText, OUTPUT_AUDIO_PATH);
  try {
    await neoPixel.showEmotion(emotion);
    await runCommand(buildPlaybackCommand(OUTPUT_AUDIO_PATH));
  } finally {
    if (contextLabel === "wrap_up") {
      console.log("Wrap-up detected; keeping NeoPixel on for 5s before turning off.");
      await sleep(5000);
    }
    await neoPixel.off();
  }
  return contextLabel;
}

async function mainLoop() {
  console.log(
    "PillowMate + Action Recognition (inline). Press Ctrl+C to stop."
  );
  await checkDependency(
    process.platform === "win32" ? "sox" : "rec",
    "brew install sox (macOS) / conda install -c conda-forge sox"
  );

  createActionRecognizer();
  attachStatusDisplay();
  registerLedAdapter(new ConsoleLedAdapter());
  setSensorDisplayActive(false);
  await sharedBoardReady.catch((err) => {
    console.error("Shared board failed to initialize:", err);
    process.exit(1);
  });
  await actionRecognizer.ensureReady();
  await neoPixel.ensureReady();
  await neoPixel.off();
  console.log(`LLM model: ${gptModel}`);

  await playStartMessage();

  while (true) {
    console.log("\n----- Start a new turn -----");
    try {
      const contextLabel = await handleConversationTurn();
      if (contextLabel === "wrap_up") {
        console.log("Wrap-up reached. Ending session.");
        break;
      }
    } catch (err) {
      console.error("Turn failed:", err);
      await resetActionRecognizer();
      await neoPixel.off();
    }
    console.log("Cooling down before next turn... (1s)");
    await sleep(1000);
  }

  // Clean up before exit
  if (actionRecognizer) {
    actionRecognizer.dispose();
  }
  process.exit(0);
}

mainLoop().catch((err) => {
  console.error(err);
  process.exit(1);
});
