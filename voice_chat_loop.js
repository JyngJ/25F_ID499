// voice_chat_loop.js
// 센서 없이 계속 대화하는 PillowMate 루프 버전

import path from 'path';
import { createTranscription, textToSpeech } from './audio.js';
import { askPillowMate } from './gpt_chat.js';
import { recordAudio } from './recorder.js';
import 'dotenv/config';
import { buildPlaybackCommand, runCommand, getDirname, sleep, checkDependency } from './utils.js'; // Import updated utils
import { config } from './config.js';
import fs from 'fs';

// --------------------------------------------------
const __dirname = getDirname(import.meta.url); // Use getDirname

const INPUT_AUDIO_PATH  = path.join(__dirname, 'assets', 'input.wav');
const OUTPUT_AUDIO_PATH = path.join(__dirname, 'assets', 'reply.mp3');

let conversationHistory = []; // System prompt is now handled by askPillowMate


// --------------------------------------------------
// ✅ 한 번의 “대화 사이클”만 담당하는 함수
// --------------------------------------------------
async function handleConversationTurn() {
  // 이전 input.wav 파일 삭제
  if (fs.existsSync(INPUT_AUDIO_PATH)) {
    fs.unlinkSync(INPUT_AUDIO_PATH);
  }
  // 녹음
  await recordAudio(INPUT_AUDIO_PATH, {
    startThreshold: parseFloat(config.vad.start_threshold_volume) / 100.0,
    endThreshold: parseFloat(config.vad.end_threshold_volume) / 100.0,
    startThresholdDuration: parseFloat(config.vad.start_threshold_duration),
    minSilenceDuration: parseFloat(config.vad.end_threshold_duration), // Removed * 1000
    maxDuration: parseFloat(config.vad.max_recording_time) // Removed * 1000
  });

  // STT
  console.log('Transcribing...');
  const userText = await createTranscription(INPUT_AUDIO_PATH, 'ko');
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
  await runCommand(buildPlaybackCommand(OUTPUT_AUDIO_PATH));
}


// --------------------------------------------------
// ✅ 계속 반복되는 메인 루프
// --------------------------------------------------
async function mainLoop() {
  console.log('🛏 PillowMate 시작됨. Ctrl + C 로 종료');

  // 의존성 확인
  await checkDependency(process.platform === 'win32' ? 'sox' : 'rec', 'brew install sox (macOS) / conda install -c conda-forge sox');


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
