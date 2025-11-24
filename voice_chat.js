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

// --------------------------------------------------
const __dirname = getDirname(import.meta.url); // Use getDirname

const INPUT_FILE_WAV  = path.join(__dirname, 'assets', 'input.wav'); // Changed to WAV
const OUTPUT_FILE = path.join(__dirname, 'assets', 'reply.mp3');

const INITIAL_PROMPT = 'How was your day?';

// --------------------------------------------------
async function recordInput() {
  console.log('🎙 STEP 1) 음성 감지 및 녹음 시작 (SoX VAD)...');
  // SoX (rec) 명령어를 사용하여 음성 활동 감지 및 녹음
  // silence 1 0.1 3% : 0.1초 동안 3% 볼륨 이상의 소리가 감지되면 녹음 시작
  // 1 2.0 3%        : 2.0초 동안 3% 볼륨 미만의 소리가 감지되면 녹음 종료
  const recordCmd = `rec "${INPUT_FILE_WAV}" rate 16000 channels 1 silence 1 0.1 3% 1 5.0 3%`;
  await runCommand(recordCmd);
  console.log('✅ 녹음 완료:', INPUT_FILE_WAV);
}

// --------------------------------------------------
async function main() {
  try {
    // ================================
    // STEP 0) PillowMate의 최초 질문
    // ================================
    await textToSpeech(INITIAL_PROMPT, OUTPUT_FILE);

    console.log('PillowMate:', INITIAL_PROMPT);
    await runCommand(`afplay "${OUTPUT_FILE}"`);

    // ================================
    // STEP 1) 녹음
    // ================================
    await recordInput();

    // ================================
    // STEP 2) STT
    // ================================
    const userText = await createTranscription(INPUT_FILE_WAV, 'ko'); // Changed to WAV
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
    await textToSpeech(replyText, OUTPUT_FILE);
    console.log('reply.mp3 생성 완료');

    // ================================
    // STEP 5) 재생
    // ================================
    await runCommand(`afplay "${OUTPUT_FILE}"`);
    console.log('STEP 5) 답변 재생 중...');

  } catch (err) {
    console.error('❌ 오류:', err);
  }
}

main();
