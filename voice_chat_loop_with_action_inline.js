import path from "path";
import fs from "fs";
import { createTranscription, textToSpeech } from "./audio.js";
import { askPillowMate } from "./gpt_chat.js";
import { recordAudio, registerLedAdapter } from "./recorder.js";
import { updateSensorDisplay, attachStatusDisplay } from "./status_display.js";
import { buildPlaybackCommand, runCommand, getDirname, sleep, checkDependency } from "./utils.js";
import { config } from "./config.js";
import { InlineActionRecognizer } from "./ActionRecognitionModule/node/action_recognizer_inline.js";

const __dirname = getDirname(import.meta.url);
const INPUT_AUDIO_PATH = path.join(__dirname, "assets", "input.wav");
const OUTPUT_AUDIO_PATH = path.join(__dirname, "assets", "reply.mp3");
const INITIAL_PROMPT = config.initial_prompt;

const ACTION_MODULE_DIR = path.join(__dirname, "ActionRecognitionModule");
const ACTION_OPTIONS = {
  modelPath: path.join(ACTION_MODULE_DIR, "models", "sequence_classifier_20251201_more.pt"),
  configPath: path.join(ACTION_MODULE_DIR, "models", "sequence_config_20251201_more.json"),
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

function handleSensorFrame(data) {
  if (!sensorDisplayActive) return;
  const dp = data.dp ?? 0;
  const accelMag = Math.sqrt((data.ax ?? 0) ** 2 + (data.ay ?? 0) ** 2 + (data.az ?? 0) ** 2);
  const gyroMag = Math.sqrt((data.gx ?? 0) ** 2 + (data.gy ?? 0) ** 2 + (data.gz ?? 0) ** 2);
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

async function handleConversationTurn() {
  if (fs.existsSync(INPUT_AUDIO_PATH)) {
    fs.unlinkSync(INPUT_AUDIO_PATH);
  }

  await actionRecognizer.startTurn();
  setSensorDisplayActive(false);

  try {
    await recordAudio(INPUT_AUDIO_PATH, {
      startThreshold: parseFloat(config.vad.start_threshold_volume) / 100.0,
      endThreshold: parseFloat(config.vad.end_threshold_volume) / 100.0,
      startThresholdDuration: parseFloat(config.vad.start_threshold_duration),
      minSilenceDuration: parseFloat(config.vad.end_threshold_duration),
      maxDuration: parseFloat(config.vad.max_recording_time),
      onSpeechStart: () => setSensorDisplayActive(true),
    });
  } catch (err) {
    await resetActionRecognizer();
    throw err;
  }

  const actionPromise = actionRecognizer
    .stopAndGetAction()
    .catch(() => ({ label: "idle", probability: 0, raw: "timeout" }));

  console.log("Transcribing...");
  const userText = await createTranscription(INPUT_AUDIO_PATH, "ko");
  console.log("User:", userText);

  const actionResult = await actionPromise;
  setSensorDisplayActive(false);
  console.log(
    `Detected action: ${actionResult.label} (${(actionResult.probability * 100).toFixed(1)}%)`,
  );

  const userAugmentedText = `${userText}\n\n[Detected action: ${actionResult.label} (${
    (actionResult.probability * 100).toFixed(1)
  }%)]`;
  conversationHistory.push({ role: "user", content: userAugmentedText });

  const gptResponse = await askPillowMate(conversationHistory);
  const replyText = gptResponse.text;
  const action = gptResponse.action;
  const ledPattern = gptResponse.led_pattern;

  conversationHistory.push({ role: "assistant", content: replyText });

  console.log("PillowMate:", replyText);
  console.log("Action:", action);
  console.log("LED Pattern:", ledPattern);

  await textToSpeech(replyText, OUTPUT_AUDIO_PATH);
  await runCommand(buildPlaybackCommand(OUTPUT_AUDIO_PATH));
}

async function mainLoop() {
  console.log("PillowMate + Action Recognition (inline). Press Ctrl+C to stop.");
  await checkDependency(
    process.platform === "win32" ? "sox" : "rec",
    "brew install sox (macOS) / conda install -c conda-forge sox",
  );

  createActionRecognizer();
  attachStatusDisplay();
  registerLedAdapter(new ConsoleLedAdapter());
  setSensorDisplayActive(false);
  await actionRecognizer.ensureReady();

  try {
    await textToSpeech(INITIAL_PROMPT, OUTPUT_AUDIO_PATH);
  } catch (e) {
    console.log("TTS Skip:", e.message);
  }

  conversationHistory.push({ role: "assistant", content: INITIAL_PROMPT });
  console.log("PillowMate:", INITIAL_PROMPT);
  await runCommand(buildPlaybackCommand(OUTPUT_AUDIO_PATH));

  while (true) {
    console.log("\n----- Start a new turn -----");
    try {
      await handleConversationTurn();
    } catch (err) {
      console.error("Turn failed:", err);
      await resetActionRecognizer();
    }
    console.log("Cooling down before next turn...");
    await sleep(3000);
  }
}

mainLoop().catch((err) => {
  console.error(err);
  process.exit(1);
});
