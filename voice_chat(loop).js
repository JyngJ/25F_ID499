// voice_chat.js
// 센서 없이 계속 대화하는 PillowMate 루프 버전

import path from 'path';
import { createTranscription, textToSpeech } from './audio.js';
import { askPillowMate } from './gpt_chat.js';
import 'dotenv/config';
import { runCommand, getDirname, sleep } from './utils.js'; // Import runCommand and getDirname

// --------------------------------------------------
const __dirname = getDirname(import.meta.url); // Use getDirname

const INPUT_AUDIO_PATH  = path.join(__dirname, 'assets', 'input.wav'); // Changed to WAV
const OUTPUT_AUDIO_PATH = path.join(__dirname, 'assets', 'reply.mp3');

const INITIAL_PROMPT = 'How was your day?';

let conversationHistory = []; // System prompt is now handled by askPillowMate

// --------------------------------------------------
async function recordInput() {
  console.log('🎙 음성 감지 및 녹음 시작 (SoX VAD)...');
  // SoX (rec) 명령어를 사용하여 음성 활동 감지 및 녹음
  // silence 1 0.1 3% : 0.1초 동안 3% 볼륨 이상의 소리가 감지되면 녹음 시작
  // 1 2.0 3%        : 2.0초 동안 3% 볼륨 미만의 소리가 감지되면 녹음 종료
  const recordCmd = `rec "${INPUT_AUDIO_PATH}" rate 16000 channels 1 silence 1 0.1 3% 1 5.0 3%`;
  await runCommand(recordCmd);
  console.log('✅ 녹음 완료:', INPUT_AUDIO_PATH);
}


// --------------------------------------------------
// ✅ 한 번의 “대화 사이클”만 담당하는 함수
// --------------------------------------------------
async function handleConversationTurn() {
  // 녹음
  await recordInput();

  // STT
  const userText = await createTranscription(INPUT_AUDIO_PATH, 'ko'); // Changed to WAV
  console.log('👤 User:', userText);

  // 유저 말 메모장에 추가
  conversationHistory.push({ role: 'user', content: userText });

  // GPT에게 '지금까지 대화 전체'를 보냄
  const gptResponse = await askPillowMate(conversationHistory);
  const replyText = gptResponse.text;
  const action = gptResponse.action;
  const ledPattern = gptResponse.led_pattern;

  // GPT 답변도 메모장에 추가 (text만)
  conversationHistory.push({ role: 'assistant', content: replyText });

  console.log('🧠 PillowMate:', replyText);
  console.log('Action:', action);
  console.log('LED Pattern:', ledPattern);


  // TTS
  await textToSpeech(replyText, OUTPUT_AUDIO_PATH);
  await runCommand(`afplay "${OUTPUT_AUDIO_PATH}"`);
}


// --------------------------------------------------
// ✅ 계속 반복되는 메인 루프
// --------------------------------------------------
async function mainLoop() {
  console.log('🛏 PillowMate 시작됨. Ctrl + C 로 종료');

  // Initial prompt from PillowMate
  const initialGptResponse = await askPillowMate([{ role: 'user', content: INITIAL_PROMPT }]); // Initial prompt from PillowMate
  const initialReplyText = initialGptResponse.text;
  const initialAction = initialGptResponse.action;
  const initialLedPattern = initialGptResponse.led_pattern;
  
  conversationHistory.push({ role: 'assistant', content: initialReplyText });
  await textToSpeech(initialReplyText, OUTPUT_AUDIO_PATH);
  console.log('PillowMate:', initialReplyText);
  console.log('Action:', initialAction);
  console.log('LED Pattern:', initialLedPattern);
  await runCommand(`afplay "${OUTPUT_AUDIO_PATH}"`);


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

