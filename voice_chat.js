// voice_chat.js
// 전체 파이프라인:
// STEP 0) PillowMate 질문 TTS → 재생
// STEP 1) SoX(rec)를 이용한 실시간 녹음 → assets/input.wav
// STEP 2) Whisper(STT) → 텍스트
// STEP 3) GPT → 답변 텍스트 + 행동/LED 제안
// STEP 4) TTS → assets/reply.mp3
// STEP 5) afplay로 재생

import path from 'path';
import { createTranscription, textToSpeech } from './audio.js';
import { askPillowMate } from './gpt_chat.js';
import 'dotenv/config';
import { runCommand, getDirname } from './utils.js'; // Import runCommand and getDirname
import { config } from './config.js';

// --------------------------------------------------
const __dirname = getDirname(import.meta.url); // Use getDirname

const INPUT_AUDIO_PATH  = path.join(__dirname, 'assets', 'input.wav'); // Changed to WAV
const OUTPUT_AUDIO_PATH = path.join(__dirname, 'assets', 'reply.mp3');

const INITIAL_PROMPT = config.initial_prompt;

// --------------------------------------------------
async function recordInput() {
  console.log('🎙 STEP 1) 음성 감지 및 녹음 시작 (SoX VAD)...');
  // SoX (rec) 명령어를 사용하여 음성 활동 감지 및 녹음
  // silence 1 [start_threshold_duration] [start_threshold_volume]% : [start_threshold_duration]초 동안 [start_threshold_volume]% 볼륨 이상의 소리가 감지되면 녹음 시작
  // 1 [end_threshold_duration] [end_threshold_volume]%        : [end_threshold_duration]초 동안 [end_threshold_volume]% 볼륨 미만의 소리가 감지되면 녹음 종료
  const recordCmd = `rec "${INPUT_AUDIO_PATH}" rate 16000 channels 1 silence 1 ${config.vad.start_threshold_duration} ${config.vad.start_threshold_volume} 1 ${config.vad.end_threshold_duration} ${config.vad.end_threshold_volume}`;
  await runCommand(recordCmd);
  console.log('✅ 녹음 완료:', INPUT_AUDIO_PATH);
}

// --------------------------------------------------
async function main() {
  try {
    // ================================
    // STEP 0) PillowMate의 최초 질문
    // ================================
    await textToSpeech(INITIAL_PROMPT, OUTPUT_AUDIO_PATH);

    console.log('PillowMate:', INITIAL_PROMPT);
    await runCommand(`afplay "${OUTPUT_AUDIO_PATH}"`);

    // ================================
    // STEP 1) 녹음
    // ================================
    await recordInput();

    // ================================
    // STEP 2) STT
    // ================================
    const userText = await createTranscription(INPUT_AUDIO_PATH, 'ko'); // Changed to WAV
    console.log('User:', userText);

    // ================================
    // STEP 3) GPT
    // ================================
    const gptResponse = await askPillowMate([{ role: 'user', content: userText }]);
    const replyText = gptResponse.text;
    const action = gptResponse.action;
    const ledPattern = gptResponse.led_pattern;

    console.log('PillowMate:', replyText);
    console.log('Action:', action);
    console.log('LED Pattern:', ledPattern);


    // ================================
    // STEP 4) TTS
    // ================================
    await textToSpeech(replyText, OUTPUT_AUDIO_PATH);
    console.log('reply.mp3 생성 완료');

    // ================================
    // STEP 5) 재생
    // ================================
    await runCommand(`afplay "${OUTPUT_AUDIO_PATH}"`);
    console.log('STEP 5) 답변 재생 중...');

  } catch (err) {
    console.error('❌ 오류:', err);
  }
}

main();
