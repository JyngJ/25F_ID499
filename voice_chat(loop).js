// voice_chat.js
// 센서 없이 계속 대화하는 PillowMate 루프 버전

import path from 'path';
import { createTranscription, textToSpeech } from './audio.js';
import { askPillowMate } from './gpt_chat.js';
import 'dotenv/config';
import { runCommand, getDirname, sleep } from './utils.js'; // Import utilities

// --------------------------------------------------
const __dirname = getDirname(import.meta.url); // Use getDirname

const INPUT_FILE  = path.join(__dirname, 'assets', 'input.mp3');
const OUTPUT_FILE = path.join(__dirname, 'assets', 'reply.mp3');

const INITIAL_PROMPT = 'How was your day?';

let conversationHistory = []; // System prompt is now handled by askPillowMate


// --------------------------------------------------
async function recordInput() {
  console.log('🎙 3초 녹음 시작...');
  const cmd = `ffmpeg -y -f avfoundation -i ":0" -t 3 -ac 1 -ar 16000 "${INPUT_FILE}"`;
  await runCommand(cmd);
  console.log('✅ 녹음 완료');
}


// --------------------------------------------------
// ✅ 한 번의 “대화 사이클”만 담당하는 함수
// --------------------------------------------------
async function handleConversationTurn() {
  // 녹음
  await recordInput();

  // STT
  const userText = await createTranscription(INPUT_FILE, 'ko');
  console.log('👤 User:', userText);

  // 유저 말 메모장에 추가
  conversationHistory.push({ role: 'user', content: userText });

  // GPT에게 '지금까지 대화 전체'를 보냄
  const replyText = await askPillowMate(conversationHistory);

  // GPT 답변도 메모장에 추가
  conversationHistory.push({ role: 'assistant', content: replyText });

  console.log('🧠 PillowMate:', replyText);

  // TTS
  await textToSpeech(replyText, OUTPUT_FILE);

  // 재생
  await runCommand(`afplay "${OUTPUT_FILE}"`);
}


// --------------------------------------------------
// ✅ 계속 반복되는 메인 루프
// --------------------------------------------------
async function mainLoop() {
  console.log('🛏 PillowMate 시작됨. Ctrl + C 로 종료');

  // Initial prompt from PillowMate
  conversationHistory.push({ role: 'assistant', content: INITIAL_PROMPT });
  await textToSpeech(INITIAL_PROMPT, OUTPUT_FILE);
  console.log('PillowMate:', INITIAL_PROMPT);
  await runCommand(`afplay "${OUTPUT_FILE}"`);


  while (true) {
    console.log('\n----- 새로운 대화 시작 -----');

    try {
      await handleConversationTurn();
    } catch (err) {
      console.error('❌ 대화 중 오류:', err);
    }

    console.log('⏳ 3초 휴식 후 다시 시작...');
    await sleep(3000);
  }
}

mainLoop();
