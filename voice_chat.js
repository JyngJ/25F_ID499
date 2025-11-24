// voice_chat.js
// 전체 파이프라인:
// STEP 0) PillowMate 질문 TTS → 재생
// STEP 1) ffmpeg로 3초 녹음 → assets/input.mp3
// STEP 2) Whisper(STT) → 텍스트
// STEP 3) GPT → 답변 텍스트
// STEP 4) TTS → assets/reply.mp3
// STEP 5) afplay로 재생

import path from 'path';
import { createTranscription, textToSpeech } from './audio.js';
import { askPillowMate } from './gpt_chat.js';
import 'dotenv/config';
import { runCommand, getDirname } from './utils.js'; // Import runCommand and getDirname

// --------------------------------------------------
const __dirname = getDirname(import.meta.url); // Use getDirname

const INPUT_FILE  = path.join(__dirname, 'assets', 'input.mp3');
const OUTPUT_FILE = path.join(__dirname, 'assets', 'reply.mp3');

const INITIAL_PROMPT = 'How was your day?';

// --------------------------------------------------
async function recordInput() {
  console.log('🎙 STEP 1) 3초 녹음 시작');

  const cmd = `ffmpeg -y -f avfoundation -i ":0" -t 3 -ac 1 -ar 16000 "${INPUT_FILE}"`;
  await runCommand(cmd);

  console.log('녹음 완료:', INPUT_FILE);
}

// --------------------------------------------------
async function main() {
  try {
    // ================================
    // STEP 0) PillowMate의 최초 질문
    // ================================
    // console.log('STEP 0) PillowMate 질문 생성');
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
    // console.log('STEP 2) Whisper 변환 중...');
    const userText = await createTranscription(INPUT_FILE, 'ko');
    console.log('User:', userText);

    // ================================
    // STEP 3) GPT
    // ================================
    // console.log('STEP 3) GPT 요청 중...');
    const replyText = await askPillowMate([{ role: 'user', content: userText }]);
    console.log('PillowMate:', replyText);

    // ================================
    // STEP 4) TTS
    // ================================
    // console.log('STEP 4) TTS 생성 중...');
    await textToSpeech(replyText, OUTPUT_FILE);
    console.log('reply.mp3 생성 완료');

    // ================================
    // STEP 5) 재생
    // ================================
    await runCommand(`afplay "${OUTPUT_FILE}"`); // Use runCommand
    console.log('STEP 5) 답변 재생 중...');

  } catch (err) {
    console.error('❌ 오류:', err);
  }
}

main();
