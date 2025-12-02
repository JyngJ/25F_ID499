// voice_chat_loop_with_action.js
// LLM 대화와 센서 기반 행동 인식을 동시에 다루는 루프

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { createTranscription, textToSpeech } from "./audio.js";
import { askPillowMate } from "./gpt_chat.js";
import { recordAudio, registerLedAdapter } from "./recorder.js";
import { updateSensorDisplay, attachStatusDisplay } from "./status_display.js";
import { buildPlaybackCommand, runCommand, getDirname, sleep, checkDependency } from "./utils.js";
import { config } from "./config.js";

const __dirname = getDirname(import.meta.url);
const INPUT_AUDIO_PATH = path.join(__dirname, "assets", "input.wav");
const OUTPUT_AUDIO_PATH = path.join(__dirname, "assets", "reply.mp3");
const INITIAL_PROMPT = config.initial_prompt;

const ACTION_MODULE_DIR = path.join(__dirname, "ActionRecognitionModule");
const ACTION_NODE_SCRIPT = path.join("node", "run_sequence_inference.js");
const ACTION_MODEL_PATH = "models/sequence_classifier_20251201_more.pt";
const ACTION_CONFIG_PATH = "models/sequence_config_20251201_more.json";

const ACTION_OPTIONS = {
  model: ACTION_MODEL_PATH,
  config: ACTION_CONFIG_PATH,
  lowPassWindow: 5,
  autoIdleArgs: [
    "--auto-idle",
    "--idle-label",
    "idle",
    "--idle-pressure-std",
    "8",
    "--idle-pressure-mean",
    "15",
    "--idle-accel-std",
    "1",
    "--idle-gyro-std",
    "10",
  ],
  pythonDevice: "cpu",
  streamSensors: true,
};

const ACTION_VERBOSE_LOGS = process.env.ACTION_VERBOSE_LOGS === "1";

let sensorDisplayActive = false;

function setSensorDisplayActive(active) {
  sensorDisplayActive = active;
  if (!active) {
    updateSensorDisplay("🧭 센서 대기 중...");
  }
}

class ConsoleLedAdapter {
  setState({ brightness }) {
    // 하드웨어 LED가 없는 경우를 대비한 더미 어댑터. 콘솔 출력은 생략.
    return brightness;
  }
}

/**
 * ActionRecognizer
 * - run_sequence_inference.js를 백그라운드로 실행해 센서 기반 행동 라벨을 얻는다.
 * - startTurn() 호출 시 센서 수집을 시작하고, stopAndGetAction()으로 예측 결과를 받는다.
 */
class ActionRecognizer {
  constructor(options) {
    this.cwd = options.cwd;
    this.args = [
      ACTION_NODE_SCRIPT,
      "--model",
      options.model,
      "--config",
      options.config,
      "--low-pass-window",
      String(options.lowPassWindow),
      "--python-device",
      options.pythonDevice,
      "--quiet",
      ...options.autoIdleArgs,
    ];
    if (options.streamSensors) {
      this.args.push("--stream-sensors");
    }
    this.child = spawn("node", this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.buffer = "";
    this.ready = false;
    this.canStart = false;
    this.pendingResolve = null;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      process.stderr.write(`[action log] ${chunk}`);
    });
    this.child.on("exit", (code, signal) => {
      console.log(`🛑 Action recognizer exited (code=${code}, signal=${signal})`);
    });

    process.on("exit", () => this.dispose());
    process.on("SIGINT", () => {
      this.dispose();
      process.exit(0);
    });
  }

  dispose() {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }

  handleData(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (ACTION_VERBOSE_LOGS) {
        console.log(`[action] ${line}`);
      }
      this.processLine(line.trim());
    }
  }

  processLine(line) {
    if (!line) return;
    if (!this.ready && line.includes("사용자 턴을 녹화하려면 Enter")) {
      this.ready = true;
      this.canStart = true;
      this.resolveReady?.();
      return;
    }
    if (line.startsWith("[sensor]")) {
      if (sensorDisplayActive) {
        const data = parseSensorLine(line);
        renderSensorMeters(data);
      }
      return;
    }
    if (line.includes("새 턴을 시작하려면 Enter")) {
      this.canStart = true;
      return;
    }
    if (this.pendingResolve && line.includes("예측 결과:")) {
      const parsed = this.parsePrediction(line);
      const resolver = this.pendingResolve;
      this.pendingResolve = null;
      this.canStart = false;
      resolver(parsed);
      return;
    }
  }

  parsePrediction(line) {
    const regex = /예측 결과:\s+([^(]+)\(([\d.]+)%\)/;
    const match = line.match(regex);
    if (!match) {
      return { label: "unknown", probability: 0, raw: line };
    }
    return {
      label: match[1].trim(),
      probability: Number(match[2]) / 100,
      raw: line,
    };
  }

  async ensureReady() {
    await this.readyPromise;
  }

  async startTurn() {
    await this.ensureReady();
    if (!this.canStart) {
      throw new Error("Action recognizer is not ready to start a turn.");
    }
    this.canStart = false;
    this.child.stdin.write("\n");
  }

  async stopAndGetAction() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          this.canStart = true;
          reject(new Error("Action recognition timed out."));
        }
      }, 15000);
      this.pendingResolve = (result) => {
        clearTimeout(timeout);
        this.canStart = true;
        resolve(result);
      };
      this.child.stdin.write("\n");
    });
  }
}

function parseSensorLine(line) {
  const payload = {};
  line
    .replace("[sensor]", "")
    .trim()
    .split(/\s+/)
    .forEach((part) => {
      const [key, value] = part.split("=");
      if (key) {
        payload[key] = Number(value);
      }
    });
  return payload;
}

function meterBar(value, max, width = 12) {
  const ratio = Math.max(0, Math.min(1, Math.abs(value) / max));
  const filled = Math.round(ratio * width);
  return `${"█".repeat(filled).padEnd(width, " ")}`;
}

function renderSensorMeters(data) {
  const dp = data.dp ?? 0;
  const accelMag = Math.sqrt((data.ax ?? 0) ** 2 + (data.ay ?? 0) ** 2 + (data.az ?? 0) ** 2);
  const gyroMag = Math.sqrt((data.gx ?? 0) ** 2 + (data.gy ?? 0) ** 2 + (data.gz ?? 0) ** 2);
  const line = `🧭 ΔP ${dp.toFixed(1)}  ACC ${accelMag.toFixed(2)}  GYRO ${gyroMag.toFixed(2)}`;
  updateSensorDisplay(`🧭 ${line}`);
}

let actionRecognizer = null;

function createActionRecognizer() {
  if (actionRecognizer) {
    actionRecognizer.dispose();
  }
  actionRecognizer = new ActionRecognizer({
    cwd: ACTION_MODULE_DIR,
    model: ACTION_OPTIONS.model,
    config: ACTION_OPTIONS.config,
    lowPassWindow: ACTION_OPTIONS.lowPassWindow,
    autoIdleArgs: ACTION_OPTIONS.autoIdleArgs,
    pythonDevice: ACTION_OPTIONS.pythonDevice,
    streamSensors: ACTION_OPTIONS.streamSensors,
  });
  return actionRecognizer;
}

async function resetActionRecognizer() {
  createActionRecognizer();
  await actionRecognizer.ensureReady();
}

let conversationHistory = [];

/**
 * 사용자 한 턴을 처리한다.
 * 1) 센서 수집을 시작하고 녹음을 진행
 * 2) STT 결과와 행동 라벨을 GPT 입력에 포함
 * 3) LLM 응답과 TTS 재생
 */
async function handleConversationTurn() {
  if (fs.existsSync(INPUT_AUDIO_PATH)) {
    fs.unlinkSync(INPUT_AUDIO_PATH);
  }

  console.log("\n🎯 행동 인식 센서를 활성화합니다. 사용자 발화를 기다리는 중...");
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
    // 녹음 실패 시 액션 인식기 상태를 초기화하고 재시도할 수 있게 오류 전파
    await resetActionRecognizer();
    throw err;
  }

  const actionPromise = actionRecognizer
    .stopAndGetAction()
    .catch(() => ({ label: "idle", probability: 0, raw: "timeout" }));

  console.log("Transcribing...");
  const userText = await createTranscription(INPUT_AUDIO_PATH, "ko");
  console.log("👤 User:", userText);

  const actionResult = await actionPromise;
  setSensorDisplayActive(false);
  console.log(
    `📟 Detected action: ${actionResult.label} (${(actionResult.probability * 100).toFixed(1)}%)`,
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

  console.log("🧠 PillowMate:", replyText);
  console.log("Action:", action);
  console.log("LED Pattern:", ledPattern);

  await textToSpeech(replyText, OUTPUT_AUDIO_PATH);
  await runCommand(buildPlaybackCommand(OUTPUT_AUDIO_PATH));
}

async function mainLoop() {
  console.log("🛏 PillowMate + Action Recognition 시작됨. Ctrl + C 로 종료");
  await checkDependency(
    process.platform === "win32" ? "sox" : "rec",
    "brew install sox (macOS) / conda install -c conda-forge sox",
  );

  // 액션 인식기 초기화
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
    console.log("\n----- 새로운 대화 시작 -----");
    try {
      await handleConversationTurn();
    } catch (err) {
      console.error("❌ 대화 중 오류:", err);
      // 액션 인식기 준비 오류가 반복될 때 재기동
      await resetActionRecognizer();
    }
    console.log("⏳ 3초 휴식 후 다시 시작...");
    await sleep(3000);
  }
}

mainLoop().catch((err) => {
  console.error(err);
  process.exit(1);
});
